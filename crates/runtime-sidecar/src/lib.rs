use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use base64::Engine;
use t3_runtime_protocol::{OutputMode, PROTOCOL_VERSION, RuntimeEvent, RuntimeStream};
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};
use tokio::time;

mod process_tree;
use process_tree::ProcessTree;

const OUTPUT_READ_CHUNK_BYTES: usize = 16 * 1024;

#[derive(Debug)]
pub struct RunInput {
    pub request_id: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<BTreeMap<String, String>>,
    pub stdin: Option<String>,
    pub timeout: Duration,
    pub max_output_bytes: usize,
    pub output_mode: OutputMode,
    pub truncated_marker: String,
}

#[derive(Debug)]
pub struct StreamingInput {
    pub request_id: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<BTreeMap<String, String>>,
}

#[derive(Debug)]
pub enum StreamingCommand {
    Write(Vec<u8>),
    CloseStdin,
}

#[derive(Debug)]
pub struct InheritedProcessInput {
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub child_pid_log_path: Option<PathBuf>,
}

#[derive(Debug, Error)]
pub enum RunError {
    #[error("working directory does not exist or is not a directory: {0}")]
    InvalidWorkingDirectory(String),
    #[error("failed to spawn process: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("failed to wait for process: {0}")]
    Wait(#[source] std::io::Error),
    #[error("failed to read {stream}: {source}")]
    Read {
        stream: &'static str,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to write stdin: {0}")]
    Stdin(#[source] std::io::Error),
    #[error("failed to establish process-tree ownership: {0}")]
    ProcessTree(#[source] std::io::Error),
    #[error("{stream} exceeded the {max_bytes} byte limit after {observed_bytes} bytes")]
    OutputLimit {
        stream: &'static str,
        max_bytes: usize,
        observed_bytes: usize,
    },
}

impl RunError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidWorkingDirectory(_) => "INVALID_WORKING_DIRECTORY",
            Self::Spawn(_) => "PROCESS_SPAWN_FAILED",
            Self::Wait(_) => "PROCESS_WAIT_FAILED",
            Self::Read { .. } => "PROCESS_OUTPUT_READ_FAILED",
            Self::Stdin(_) => "PROCESS_STDIN_FAILED",
            Self::ProcessTree(_) => "PROCESS_TREE_SETUP_FAILED",
            Self::OutputLimit { .. } => "PROCESS_OUTPUT_LIMIT_EXCEEDED",
        }
    }

    pub fn user_message(&self) -> &'static str {
        match self {
            Self::InvalidWorkingDirectory(_) => "The process working directory is invalid.",
            Self::Spawn(_) => "The process could not be started.",
            Self::Wait(_) => "The process exit status could not be read.",
            Self::Read { .. } => "The process output could not be read.",
            Self::Stdin(_) => "Input could not be sent to the process.",
            Self::ProcessTree(_) => "The process tree could not be safely contained.",
            Self::OutputLimit { .. } => "The process produced more output than allowed.",
        }
    }
}

pub async fn run_inherited_process(
    input: InheritedProcessInput,
) -> Result<std::process::ExitStatus, RunError> {
    let mut command = Command::new(&input.command);
    command
        .args(&input.args)
        .envs(&input.env)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);

    let process_tree = ProcessTree::prepare(&mut command).map_err(RunError::ProcessTree)?;
    let mut child = command.spawn().map_err(RunError::Spawn)?;
    if let Err(error) = process_tree.attach_and_start(&child) {
        process_tree.terminate(&mut child).await;
        return Err(RunError::ProcessTree(error));
    }
    if let (Some(path), Some(pid)) = (&input.child_pid_log_path, child.id()) {
        let mut log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(RunError::Wait)?;
        writeln!(log, "{pid}").map_err(RunError::Wait)?;
    }
    let status = child.wait().await.map_err(RunError::Wait)?;
    process_tree.terminate_remaining();
    Ok(status)
}

#[derive(Debug)]
struct CapturedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

impl CapturedOutput {
    fn into_text(mut self, marker: &str) -> (String, bool) {
        if self.truncated && !marker.is_empty() {
            let marker_bytes = marker.as_bytes();
            if marker_bytes.len() >= self.bytes.len() {
                let output_len = self.bytes.len();
                self.bytes.clear();
                self.bytes.extend_from_slice(&marker_bytes[..output_len]);
            } else {
                let keep = self.bytes.len() - marker_bytes.len();
                self.bytes.truncate(keep);
                self.bytes.extend_from_slice(marker_bytes);
            }
        }
        (
            String::from_utf8_lossy(&self.bytes).into_owned(),
            self.truncated,
        )
    }
}

async fn capture_stream(
    mut stream: impl AsyncRead + Unpin,
    stream_name: &'static str,
    max_bytes: usize,
    limit_tx: mpsc::Sender<(&'static str, usize)>,
) -> Result<CapturedOutput, RunError> {
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    let mut observed_bytes = 0usize;
    let mut reported_limit = false;
    let mut chunk = vec![0_u8; OUTPUT_READ_CHUNK_BYTES];

    loop {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|source| RunError::Read {
                stream: stream_name,
                source,
            })?;
        if read == 0 {
            break;
        }
        observed_bytes = observed_bytes.saturating_add(read);
        let remaining = max_bytes.saturating_sub(bytes.len());
        bytes.extend_from_slice(&chunk[..read.min(remaining)]);
        if observed_bytes > max_bytes && !reported_limit {
            reported_limit = true;
            let _ = limit_tx.try_send((stream_name, observed_bytes));
        }
    }

    Ok(CapturedOutput {
        bytes,
        truncated: observed_bytes > max_bytes,
    })
}

async fn forward_stream(
    mut stream: impl AsyncRead + Unpin,
    stream_kind: RuntimeStream,
    request_id: String,
    events: mpsc::Sender<RuntimeEvent>,
    errors: mpsc::Sender<RunError>,
) {
    let stream_name = match stream_kind {
        RuntimeStream::Stdout => "stdout",
        RuntimeStream::Stderr => "stderr",
    };
    let mut chunk = vec![0_u8; OUTPUT_READ_CHUNK_BYTES];
    let mut sequence = 0usize;

    loop {
        let read = match stream.read(&mut chunk).await {
            Ok(read) => read,
            Err(source) => {
                let _ = errors
                    .send(RunError::Read {
                        stream: stream_name,
                        source,
                    })
                    .await;
                return;
            }
        };
        if read == 0 {
            return;
        }
        let data_base64 = base64::engine::general_purpose::STANDARD.encode(&chunk[..read]);
        if events
            .send(RuntimeEvent::ProcessOutput {
                version: PROTOCOL_VERSION,
                request_id: request_id.clone(),
                stream: stream_kind,
                sequence,
                data_base64,
            })
            .await
            .is_err()
        {
            return;
        }
        sequence = sequence.saturating_add(1);
    }
}

pub async fn run_streaming_process(
    input: StreamingInput,
    events: mpsc::Sender<RuntimeEvent>,
    mut commands: mpsc::Receiver<StreamingCommand>,
    mut stop: oneshot::Receiver<()>,
) -> Result<(), RunError> {
    if let Some(cwd) = &input.cwd {
        let metadata =
            std::fs::metadata(cwd).map_err(|_| RunError::InvalidWorkingDirectory(cwd.clone()))?;
        if !metadata.is_dir() {
            return Err(RunError::InvalidWorkingDirectory(cwd.clone()));
        }
    }

    let mut command = Command::new(&input.command);
    command
        .args(&input.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = &input.cwd {
        command.current_dir(cwd);
    }
    if let Some(env) = &input.env {
        command.envs(env);
    }

    let process_tree = ProcessTree::prepare(&mut command).map_err(RunError::ProcessTree)?;
    let mut child = command.spawn().map_err(RunError::Spawn)?;
    if let Err(error) = process_tree.attach_and_start(&child) {
        process_tree.terminate(&mut child).await;
        return Err(RunError::ProcessTree(error));
    }
    let pid = child.id().unwrap_or_default();
    events
        .send(RuntimeEvent::ProcessStarted {
            version: PROTOCOL_VERSION,
            request_id: input.request_id.clone(),
            pid,
        })
        .await
        .ok();

    let stdout = child.stdout.take().expect("stdout configured as piped");
    let stderr = child.stderr.take().expect("stderr configured as piped");
    let mut stdin = child.stdin.take();
    let (error_tx, mut error_rx) = mpsc::channel(2);
    let stdout_task = tokio::spawn(forward_stream(
        stdout,
        RuntimeStream::Stdout,
        input.request_id.clone(),
        events.clone(),
        error_tx.clone(),
    ));
    let stderr_task = tokio::spawn(forward_stream(
        stderr,
        RuntimeStream::Stderr,
        input.request_id.clone(),
        events.clone(),
        error_tx,
    ));

    let (exit_code, stopped) = 'process: loop {
        tokio::select! {
            biased;
            _ = &mut stop => {
                process_tree.terminate(&mut child).await;
                break (None, true);
            }
            status = child.wait() => {
                let status = status.map_err(RunError::Wait)?;
                process_tree.terminate_remaining();
                break (status.code(), false);
            }
            command = commands.recv() => {
                match command {
                    Some(StreamingCommand::Write(bytes)) => {
                        let Some(child_stdin) = stdin.as_mut() else {
                            process_tree.terminate(&mut child).await;
                            return Err(RunError::Stdin(std::io::Error::new(
                                std::io::ErrorKind::BrokenPipe,
                                "stdin is closed",
                            )));
                        };
                        tokio::select! {
                            biased;
                            _ = &mut stop => {
                                process_tree.terminate(&mut child).await;
                                break 'process (None, true);
                            }
                            result = child_stdin.write_all(&bytes) => {
                                if let Err(error) = result {
                                    process_tree.terminate(&mut child).await;
                                    return Err(RunError::Stdin(error));
                                }
                            }
                        }
                    }
                    Some(StreamingCommand::CloseStdin) => {
                        if let Some(mut child_stdin) = stdin.take() {
                            tokio::select! {
                                biased;
                                _ = &mut stop => {
                                    process_tree.terminate(&mut child).await;
                                    break 'process (None, true);
                                }
                                result = child_stdin.shutdown() => {
                                    result.map_err(RunError::Stdin)?;
                                }
                            }
                        }
                    }
                    None => {
                        process_tree.terminate(&mut child).await;
                        break (None, true);
                    }
                }
            }
            Some(error) = error_rx.recv() => {
                process_tree.terminate(&mut child).await;
                return Err(error);
            }
        }
    };

    drop(stdin);
    stdout_task.await.map_err(|error| RunError::Read {
        stream: "stdout",
        source: std::io::Error::other(error),
    })?;
    stderr_task.await.map_err(|error| RunError::Read {
        stream: "stderr",
        source: std::io::Error::other(error),
    })?;
    if let Ok(error) = error_rx.try_recv() {
        return Err(error);
    }

    events
        .send(RuntimeEvent::ProcessExited {
            version: PROTOCOL_VERSION,
            request_id: input.request_id,
            exit_code,
            stopped,
        })
        .await
        .ok();
    Ok(())
}

pub async fn run_process(
    input: RunInput,
    events: mpsc::Sender<RuntimeEvent>,
    mut cancel: oneshot::Receiver<()>,
) -> Result<(), RunError> {
    if let Some(cwd) = &input.cwd {
        let metadata =
            std::fs::metadata(cwd).map_err(|_| RunError::InvalidWorkingDirectory(cwd.clone()))?;
        if !metadata.is_dir() {
            return Err(RunError::InvalidWorkingDirectory(cwd.clone()));
        }
    }

    let mut command = Command::new(&input.command);
    command
        .args(&input.args)
        .stdin(if input.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = &input.cwd {
        command.current_dir(cwd);
    }
    if let Some(env) = &input.env {
        command.envs(env);
    }

    let process_tree = ProcessTree::prepare(&mut command).map_err(RunError::ProcessTree)?;
    let mut child = command.spawn().map_err(RunError::Spawn)?;
    if let Err(error) = process_tree.attach_and_start(&child) {
        process_tree.terminate(&mut child).await;
        return Err(RunError::ProcessTree(error));
    }
    let pid = child.id().unwrap_or_default();
    events
        .send(RuntimeEvent::ProcessStarted {
            version: PROTOCOL_VERSION,
            request_id: input.request_id.clone(),
            pid,
        })
        .await
        .ok();

    let stdout = child.stdout.take().expect("stdout configured as piped");
    let stderr = child.stderr.take().expect("stderr configured as piped");
    let (limit_tx, mut limit_rx) = mpsc::channel(2);
    let stdout_task = tokio::spawn(capture_stream(
        stdout,
        "stdout",
        input.max_output_bytes,
        limit_tx.clone(),
    ));
    let stderr_task = tokio::spawn(capture_stream(
        stderr,
        "stderr",
        input.max_output_bytes,
        limit_tx,
    ));
    let stdin_task = input.stdin.map(|contents| {
        let mut stdin = child.stdin.take().expect("stdin configured as piped");
        tokio::spawn(async move {
            stdin
                .write_all(contents.as_bytes())
                .await
                .map_err(RunError::Stdin)?;
            stdin.shutdown().await.map_err(RunError::Stdin)
        })
    });

    enum Finish {
        Exited(std::process::ExitStatus),
        TimedOut,
        Cancelled,
        OutputLimit(&'static str, usize),
    }

    let finish = tokio::select! {
        status = child.wait() => Finish::Exited(status.map_err(RunError::Wait)?),
        _ = time::sleep(input.timeout) => Finish::TimedOut,
        _ = &mut cancel => Finish::Cancelled,
        Some((stream, observed_bytes)) = limit_rx.recv(), if input.output_mode == OutputMode::Error => {
            Finish::OutputLimit(stream, observed_bytes)
        }
    };

    if matches!(finish, Finish::Exited(_)) {
        process_tree.terminate_remaining();
    } else {
        process_tree.terminate(&mut child).await;
    }
    if let Some(stdin_task) = stdin_task {
        let stdin_result = stdin_task
            .await
            .map_err(|error| RunError::Stdin(std::io::Error::other(error)))?;
        if matches!(finish, Finish::Exited(_)) {
            stdin_result?;
        }
    }
    let stdout = stdout_task.await.map_err(|error| RunError::Read {
        stream: "stdout",
        source: std::io::Error::other(error),
    })??;
    let stderr = stderr_task.await.map_err(|error| RunError::Read {
        stream: "stderr",
        source: std::io::Error::other(error),
    })??;

    if let Finish::OutputLimit(stream, observed_bytes) = finish {
        return Err(RunError::OutputLimit {
            stream,
            max_bytes: input.max_output_bytes,
            observed_bytes,
        });
    }

    let (stdout_text, stdout_truncated) = stdout.into_text(&input.truncated_marker);
    let (stderr_text, stderr_truncated) = stderr.into_text(&input.truncated_marker);
    let (exit_code, timed_out, cancelled) = match finish {
        Finish::Exited(status) => (status.code(), false, false),
        Finish::TimedOut => (None, true, false),
        Finish::Cancelled => (None, false, true),
        Finish::OutputLimit(_, _) => unreachable!(),
    };
    events
        .send(RuntimeEvent::ProcessCompleted {
            version: PROTOCOL_VERSION,
            request_id: input.request_id,
            exit_code,
            timed_out,
            cancelled,
            stdout: stdout_text,
            stderr: stderr_text,
            stdout_truncated,
            stderr_truncated,
        })
        .await
        .ok();
    Ok(())
}

pub fn error_event(request_id: Option<String>, error: &RunError) -> RuntimeEvent {
    let (stream, max_output_bytes, observed_output_bytes) = match error {
        RunError::OutputLimit {
            stream,
            max_bytes,
            observed_bytes,
        } => (
            Some(if *stream == "stdout" {
                RuntimeStream::Stdout
            } else {
                RuntimeStream::Stderr
            }),
            Some(*max_bytes),
            Some(*observed_bytes),
        ),
        _ => (None, None, None),
    };
    RuntimeEvent::Error {
        version: PROTOCOL_VERSION,
        request_id,
        code: error.code().into(),
        message: error.user_message().into(),
        recoverable: true,
        debug_detail: cfg!(debug_assertions).then(|| error.to_string()),
        stream,
        max_output_bytes,
        observed_output_bytes,
    }
}
