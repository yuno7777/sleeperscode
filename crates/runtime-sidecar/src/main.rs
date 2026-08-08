use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine;
use t3_runtime_protocol::{
    PROTOCOL_VERSION, RuntimeCapabilities, RuntimeControl, RuntimeEvent, RuntimeRequest,
    STREAM_CHUNK_MAX_BYTES,
};
use t3_runtime_sidecar::{
    RunInput, StreamingCommand, StreamingInput, error_event, run_process, run_streaming_process,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{Mutex, Semaphore, mpsc, oneshot};
use tracing_subscriber::EnvFilter;

const EVENT_QUEUE_CAPACITY: usize = 64;
const SESSION_INPUT_QUEUE_CAPACITY: usize = 32;
const MAX_CONCURRENT_PROCESSES: usize = 32;

enum ActiveProcess {
    Finite(oneshot::Sender<()>),
    Streaming {
        commands: mpsc::Sender<StreamingCommand>,
        stop: oneshot::Sender<()>,
    },
}

async fn emit(events: &mpsc::Sender<RuntimeEvent>, event: RuntimeEvent) {
    if events.send(event).await.is_err() {
        tracing::debug!("runtime event receiver closed");
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn")),
        )
        .with_writer(std::io::stderr)
        .init();

    let (event_tx, mut event_rx) = mpsc::channel::<RuntimeEvent>(EVENT_QUEUE_CAPACITY);
    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::BufWriter::new(tokio::io::stdout());
        while let Some(event) = event_rx.recv().await {
            match serde_json::to_vec(&event) {
                Ok(encoded) => {
                    if stdout.write_all(&encoded).await.is_err()
                        || stdout.write_all(b"\n").await.is_err()
                        || stdout.flush().await.is_err()
                    {
                        break;
                    }
                }
                Err(error) => tracing::error!(?error, "failed to serialize runtime event"),
            }
        }
    });

    emit(
        &event_tx,
        RuntimeEvent::Hello {
            version: PROTOCOL_VERSION,
            runtime_version: env!("CARGO_PKG_VERSION").into(),
            sidecar_pid: std::process::id(),
            platform: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
            capabilities: RuntimeCapabilities {
                finite_processes: true,
                concurrent_processes: true,
                cancellation: true,
                streaming_processes: true,
                shell_commands: false,
            },
        },
    )
    .await;

    let active = Arc::new(Mutex::new(HashMap::<String, ActiveProcess>::new()));
    let permits = Arc::new(Semaphore::new(MAX_CONCURRENT_PROCESSES));
    let mut lines = BufReader::new(tokio::io::stdin()).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let request = match serde_json::from_str::<RuntimeRequest>(&line) {
            Ok(request) => request,
            Err(error) => {
                emit(
                    &event_tx,
                    RuntimeEvent::Error {
                        version: PROTOCOL_VERSION,
                        request_id: None,
                        code: "INVALID_REQUEST".into(),
                        message: "The runtime request was not valid JSON for this protocol.".into(),
                        recoverable: true,
                        debug_detail: cfg!(debug_assertions).then(|| error.to_string()),
                        stream: None,
                        max_output_bytes: None,
                        observed_output_bytes: None,
                    },
                )
                .await;
                continue;
            }
        };
        if request.version() != PROTOCOL_VERSION {
            emit(
                &event_tx,
                RuntimeEvent::Error {
                    version: PROTOCOL_VERSION,
                    request_id: None,
                    code: "PROTOCOL_VERSION_MISMATCH".into(),
                    message: format!(
                        "Runtime protocol {} is required; received {}.",
                        PROTOCOL_VERSION,
                        request.version()
                    ),
                    recoverable: false,
                    debug_detail: None,
                    stream: None,
                    max_output_bytes: None,
                    observed_output_bytes: None,
                },
            )
            .await;
            continue;
        }

        match request {
            RuntimeRequest::Run {
                request_id,
                command,
                args,
                cwd,
                env,
                stdin,
                timeout_ms,
                max_output_bytes,
                output_mode,
                truncated_marker,
                ..
            } => {
                let permit = match permits.clone().try_acquire_owned() {
                    Ok(permit) => permit,
                    Err(_) => {
                        emit(
                            &event_tx,
                            RuntimeEvent::Error {
                                version: PROTOCOL_VERSION,
                                request_id: Some(request_id),
                                code: "RUNTIME_BUSY".into(),
                                message: "The native runtime process limit has been reached."
                                    .into(),
                                recoverable: true,
                                debug_detail: None,
                                stream: None,
                                max_output_bytes: None,
                                observed_output_bytes: None,
                            },
                        )
                        .await;
                        continue;
                    }
                };
                let mut active_guard = active.lock().await;
                if active_guard.contains_key(&request_id) {
                    drop(active_guard);
                    emit(
                        &event_tx,
                        RuntimeEvent::Error {
                            version: PROTOCOL_VERSION,
                            request_id: Some(request_id),
                            code: "DUPLICATE_REQUEST_ID".into(),
                            message: "The runtime request identifier is already active.".into(),
                            recoverable: true,
                            debug_detail: None,
                            stream: None,
                            max_output_bytes: None,
                            observed_output_bytes: None,
                        },
                    )
                    .await;
                    continue;
                }
                let (cancel_tx, cancel_rx) = oneshot::channel();
                active_guard.insert(request_id.clone(), ActiveProcess::Finite(cancel_tx));
                drop(active_guard);

                let task_events = event_tx.clone();
                let task_active = active.clone();
                tokio::spawn(async move {
                    let _permit = permit;
                    let input = RunInput {
                        request_id: request_id.clone(),
                        command,
                        args,
                        cwd,
                        env,
                        stdin,
                        timeout: std::time::Duration::from_millis(timeout_ms.max(1)),
                        max_output_bytes,
                        output_mode,
                        truncated_marker,
                    };
                    if let Err(error) = run_process(input, task_events.clone(), cancel_rx).await {
                        emit(&task_events, error_event(Some(request_id.clone()), &error)).await;
                    }
                    task_active.lock().await.remove(&request_id);
                });
            }
            RuntimeRequest::Start {
                request_id,
                command,
                args,
                cwd,
                env,
                ..
            } => {
                let permit = match permits.clone().try_acquire_owned() {
                    Ok(permit) => permit,
                    Err(_) => {
                        emit(
                            &event_tx,
                            RuntimeEvent::Error {
                                version: PROTOCOL_VERSION,
                                request_id: Some(request_id),
                                code: "RUNTIME_BUSY".into(),
                                message: "The native runtime process limit has been reached."
                                    .into(),
                                recoverable: true,
                                debug_detail: None,
                                stream: None,
                                max_output_bytes: None,
                                observed_output_bytes: None,
                            },
                        )
                        .await;
                        continue;
                    }
                };
                let mut active_guard = active.lock().await;
                if active_guard.contains_key(&request_id) {
                    drop(active_guard);
                    emit(
                        &event_tx,
                        RuntimeEvent::Error {
                            version: PROTOCOL_VERSION,
                            request_id: Some(request_id),
                            code: "DUPLICATE_REQUEST_ID".into(),
                            message: "The runtime request identifier is already active.".into(),
                            recoverable: true,
                            debug_detail: None,
                            stream: None,
                            max_output_bytes: None,
                            observed_output_bytes: None,
                        },
                    )
                    .await;
                    continue;
                }
                let (command_tx, command_rx) = mpsc::channel(SESSION_INPUT_QUEUE_CAPACITY);
                let (stop_tx, stop_rx) = oneshot::channel();
                active_guard.insert(
                    request_id.clone(),
                    ActiveProcess::Streaming {
                        commands: command_tx,
                        stop: stop_tx,
                    },
                );
                drop(active_guard);

                let task_events = event_tx.clone();
                let task_active = active.clone();
                tokio::spawn(async move {
                    let _permit = permit;
                    let input = StreamingInput {
                        request_id: request_id.clone(),
                        command,
                        args,
                        cwd,
                        env,
                    };
                    if let Err(error) =
                        run_streaming_process(input, task_events.clone(), command_rx, stop_rx).await
                    {
                        emit(&task_events, error_event(Some(request_id.clone()), &error)).await;
                    }
                    task_active.lock().await.remove(&request_id);
                });
            }
            RuntimeRequest::Write {
                request_id,
                session_id,
                data_base64,
                ..
            } => {
                let bytes = match base64::engine::general_purpose::STANDARD.decode(&data_base64) {
                    Ok(bytes) if bytes.len() <= STREAM_CHUNK_MAX_BYTES => bytes,
                    Ok(bytes) => {
                        emit(
                            &event_tx,
                            RuntimeEvent::Error {
                                version: PROTOCOL_VERSION,
                                request_id: Some(request_id),
                                code: "STREAM_CHUNK_TOO_LARGE".into(),
                                message: "The streaming input chunk exceeded the byte limit."
                                    .into(),
                                recoverable: true,
                                debug_detail: None,
                                stream: None,
                                max_output_bytes: Some(STREAM_CHUNK_MAX_BYTES),
                                observed_output_bytes: Some(bytes.len()),
                            },
                        )
                        .await;
                        continue;
                    }
                    Err(error) => {
                        emit(
                            &event_tx,
                            RuntimeEvent::Error {
                                version: PROTOCOL_VERSION,
                                request_id: Some(request_id),
                                code: "INVALID_STREAM_CHUNK".into(),
                                message: "The streaming input chunk was not valid base64.".into(),
                                recoverable: true,
                                debug_detail: cfg!(debug_assertions).then(|| error.to_string()),
                                stream: None,
                                max_output_bytes: Some(STREAM_CHUNK_MAX_BYTES),
                                observed_output_bytes: None,
                            },
                        )
                        .await;
                        continue;
                    }
                };
                let commands = active.lock().await.get(&session_id).and_then(|process| {
                    if let ActiveProcess::Streaming { commands, .. } = process {
                        Some(commands.clone())
                    } else {
                        None
                    }
                });
                let Some(commands) = commands else {
                    emit(
                        &event_tx,
                        RuntimeEvent::Error {
                            version: PROTOCOL_VERSION,
                            request_id: Some(request_id),
                            code: "PROCESS_NOT_FOUND".into(),
                            message: "No streaming process matched the request identifier.".into(),
                            recoverable: true,
                            debug_detail: None,
                            stream: None,
                            max_output_bytes: None,
                            observed_output_bytes: None,
                        },
                    )
                    .await;
                    continue;
                };
                if let Err(error) = commands.try_send(StreamingCommand::Write(bytes)) {
                    let (code, message) = match error {
                        mpsc::error::TrySendError::Full(_) => (
                            "PROCESS_INPUT_QUEUE_FULL",
                            "The streaming process input queue is full.",
                        ),
                        mpsc::error::TrySendError::Closed(_) => (
                            "PROCESS_NOT_FOUND",
                            "The streaming process is no longer running.",
                        ),
                    };
                    emit(
                        &event_tx,
                        RuntimeEvent::Error {
                            version: PROTOCOL_VERSION,
                            request_id: Some(request_id),
                            code: code.into(),
                            message: message.into(),
                            recoverable: true,
                            debug_detail: None,
                            stream: None,
                            max_output_bytes: None,
                            observed_output_bytes: None,
                        },
                    )
                    .await;
                } else {
                    emit(
                        &event_tx,
                        RuntimeEvent::ControlAccepted {
                            version: PROTOCOL_VERSION,
                            request_id,
                            session_id,
                            control: RuntimeControl::Write,
                        },
                    )
                    .await;
                }
            }
            RuntimeRequest::CloseStdin {
                request_id,
                session_id,
                ..
            } => {
                let commands = active.lock().await.get(&session_id).and_then(|process| {
                    if let ActiveProcess::Streaming { commands, .. } = process {
                        Some(commands.clone())
                    } else {
                        None
                    }
                });
                match commands {
                    Some(commands) => {
                        if let Err(error) = commands.try_send(StreamingCommand::CloseStdin) {
                            let (code, message) = match error {
                                mpsc::error::TrySendError::Full(_) => (
                                    "PROCESS_INPUT_QUEUE_FULL",
                                    "The streaming process input queue is full.",
                                ),
                                mpsc::error::TrySendError::Closed(_) => (
                                    "PROCESS_NOT_FOUND",
                                    "The streaming process is no longer running.",
                                ),
                            };
                            emit(
                                &event_tx,
                                RuntimeEvent::Error {
                                    version: PROTOCOL_VERSION,
                                    request_id: Some(request_id),
                                    code: code.into(),
                                    message: message.into(),
                                    recoverable: true,
                                    debug_detail: None,
                                    stream: None,
                                    max_output_bytes: None,
                                    observed_output_bytes: None,
                                },
                            )
                            .await;
                        } else {
                            emit(
                                &event_tx,
                                RuntimeEvent::ControlAccepted {
                                    version: PROTOCOL_VERSION,
                                    request_id,
                                    session_id,
                                    control: RuntimeControl::CloseStdin,
                                },
                            )
                            .await;
                        }
                    }
                    None => {
                        emit(
                            &event_tx,
                            RuntimeEvent::Error {
                                version: PROTOCOL_VERSION,
                                request_id: Some(request_id),
                                code: "PROCESS_NOT_FOUND".into(),
                                message: "No streaming process matched the request identifier."
                                    .into(),
                                recoverable: true,
                                debug_detail: None,
                                stream: None,
                                max_output_bytes: None,
                                observed_output_bytes: None,
                            },
                        )
                        .await;
                    }
                }
            }
            RuntimeRequest::Stop {
                request_id,
                session_id,
                ..
            } => {
                let process = active.lock().await.remove(&session_id);
                match process {
                    Some(ActiveProcess::Streaming { stop, .. }) => {
                        let _ = stop.send(());
                        emit(
                            &event_tx,
                            RuntimeEvent::ControlAccepted {
                                version: PROTOCOL_VERSION,
                                request_id,
                                session_id,
                                control: RuntimeControl::Stop,
                            },
                        )
                        .await;
                    }
                    Some(process @ ActiveProcess::Finite(_)) => {
                        active.lock().await.insert(session_id, process);
                        emit(
                            &event_tx,
                            RuntimeEvent::Error {
                                version: PROTOCOL_VERSION,
                                request_id: Some(request_id),
                                code: "PROCESS_NOT_FOUND".into(),
                                message: "No streaming process matched the request identifier."
                                    .into(),
                                recoverable: true,
                                debug_detail: None,
                                stream: None,
                                max_output_bytes: None,
                                observed_output_bytes: None,
                            },
                        )
                        .await;
                    }
                    None => {
                        emit(
                            &event_tx,
                            RuntimeEvent::Error {
                                version: PROTOCOL_VERSION,
                                request_id: Some(request_id),
                                code: "PROCESS_NOT_FOUND".into(),
                                message: "No streaming process matched the request identifier."
                                    .into(),
                                recoverable: true,
                                debug_detail: None,
                                stream: None,
                                max_output_bytes: None,
                                observed_output_bytes: None,
                            },
                        )
                        .await;
                    }
                }
            }
            RuntimeRequest::Cancel { request_id, .. } => {
                if let Some(process) = active.lock().await.remove(&request_id) {
                    match process {
                        ActiveProcess::Finite(cancel) => {
                            let _ = cancel.send(());
                        }
                        ActiveProcess::Streaming { stop, .. } => {
                            let _ = stop.send(());
                        }
                    }
                } else {
                    emit(
                        &event_tx,
                        RuntimeEvent::Error {
                            version: PROTOCOL_VERSION,
                            request_id: Some(request_id),
                            code: "PROCESS_NOT_FOUND".into(),
                            message: "No active process matched the request identifier.".into(),
                            recoverable: true,
                            debug_detail: None,
                            stream: None,
                            max_output_bytes: None,
                            observed_output_bytes: None,
                        },
                    )
                    .await;
                }
            }
            RuntimeRequest::Shutdown { .. } => break,
        }
    }

    let cancellations = active
        .lock()
        .await
        .drain()
        .map(|(_, cancel)| cancel)
        .collect::<Vec<_>>();
    for process in cancellations {
        match process {
            ActiveProcess::Finite(cancel) => {
                let _ = cancel.send(());
            }
            ActiveProcess::Streaming { stop, .. } => {
                let _ = stop.send(());
            }
        }
    }
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        permits.acquire_many(MAX_CONCURRENT_PROCESSES as u32),
    )
    .await;
    drop(event_tx);
    let _ = writer.await;
}
