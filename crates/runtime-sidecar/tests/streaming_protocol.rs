use std::process::Stdio;

use base64::Engine;
use t3_runtime_protocol::{
    PROTOCOL_VERSION, RuntimeEvent, RuntimeRequest, RuntimeStream, STREAM_CHUNK_MAX_BYTES,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

struct Sidecar {
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
}

impl Sidecar {
    async fn start() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_t3-runtime-sidecar"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn runtime sidecar");
        let stdin = child.stdin.take().expect("sidecar stdin");
        let stdout = child.stdout.take().expect("sidecar stdout");
        let mut sidecar = Self {
            child,
            stdin,
            lines: BufReader::new(stdout).lines(),
        };
        let hello = sidecar.next_event().await;
        assert!(matches!(
            hello,
            RuntimeEvent::Hello {
                capabilities,
                ..
            } if capabilities.streaming_processes
        ));
        sidecar
    }

    async fn send(&mut self, request: RuntimeRequest) {
        let encoded = serde_json::to_string(&request).expect("encode runtime request");
        self.stdin
            .write_all(format!("{encoded}\n").as_bytes())
            .await
            .expect("send runtime request");
    }

    async fn next_event(&mut self) -> RuntimeEvent {
        let line = self
            .lines
            .next_line()
            .await
            .expect("read sidecar event")
            .expect("sidecar remains available");
        serde_json::from_str(&line).expect("decode sidecar event")
    }

    async fn shutdown(mut self) {
        self.send(RuntimeRequest::Shutdown {
            version: PROTOCOL_VERSION,
        })
        .await;
        drop(self.stdin);
        assert!(self.child.wait().await.expect("wait for sidecar").success());
    }
}

#[tokio::test]
async fn streams_bytes_through_the_ndjson_protocol() {
    let mut sidecar = Sidecar::start().await;
    sidecar
        .send(RuntimeRequest::Start {
            version: PROTOCOL_VERSION,
            request_id: "protocol-stream".into(),
            command: env!("CARGO_BIN_EXE_runtime-fixture").into(),
            args: vec!["--echo-stdin".into()],
            cwd: None,
            env: None,
        })
        .await;
    assert!(matches!(
        sidecar.next_event().await,
        RuntimeEvent::ProcessStarted { request_id, .. } if request_id == "protocol-stream"
    ));

    let expected = vec![0, 1, 2, 0xf0, 0x9f, 0x99, 0x82, 0xfe, 0xff];
    sidecar
        .send(RuntimeRequest::Write {
            version: PROTOCOL_VERSION,
            request_id: "protocol-stream".into(),
            data_base64: base64::engine::general_purpose::STANDARD.encode(&expected),
        })
        .await;
    sidecar
        .send(RuntimeRequest::CloseStdin {
            version: PROTOCOL_VERSION,
            request_id: "protocol-stream".into(),
        })
        .await;

    let mut actual = Vec::new();
    let mut exited = false;
    while !exited {
        match sidecar.next_event().await {
            RuntimeEvent::ProcessOutput {
                stream: RuntimeStream::Stdout,
                data_base64,
                ..
            } => actual.extend(
                base64::engine::general_purpose::STANDARD
                    .decode(data_base64)
                    .expect("decode streamed bytes"),
            ),
            RuntimeEvent::ProcessExited {
                exit_code, stopped, ..
            } => {
                assert_eq!(exit_code, Some(0));
                assert!(!stopped);
                exited = true;
            }
            event => panic!("unexpected streaming event: {event:?}"),
        }
    }
    assert_eq!(actual, expected);
    sidecar.shutdown().await;
}

#[tokio::test]
async fn rejects_invalid_base64_without_crashing_the_sidecar() {
    let mut sidecar = Sidecar::start().await;
    sidecar
        .send(RuntimeRequest::Write {
            version: PROTOCOL_VERSION,
            request_id: "invalid-stream".into(),
            data_base64: "not base64".into(),
        })
        .await;
    assert!(matches!(
        sidecar.next_event().await,
        RuntimeEvent::Error {
            request_id: Some(request_id),
            code,
            recoverable: true,
            ..
        } if request_id == "invalid-stream" && code == "INVALID_STREAM_CHUNK"
    ));
    sidecar.shutdown().await;
}

#[tokio::test]
async fn stops_a_streaming_process_through_the_protocol() {
    let mut sidecar = Sidecar::start().await;
    sidecar
        .send(RuntimeRequest::Start {
            version: PROTOCOL_VERSION,
            request_id: "protocol-stop".into(),
            command: env!("CARGO_BIN_EXE_runtime-fixture").into(),
            args: vec!["--sleep-ms".into(), "30000".into()],
            cwd: None,
            env: None,
        })
        .await;
    assert!(matches!(
        sidecar.next_event().await,
        RuntimeEvent::ProcessStarted { request_id, .. } if request_id == "protocol-stop"
    ));
    sidecar
        .send(RuntimeRequest::Stop {
            version: PROTOCOL_VERSION,
            request_id: "protocol-stop".into(),
        })
        .await;
    assert!(matches!(
        sidecar.next_event().await,
        RuntimeEvent::ProcessExited {
            request_id,
            exit_code: None,
            stopped: true,
            ..
        } if request_id == "protocol-stop"
    ));
    sidecar.shutdown().await;
}

#[tokio::test]
async fn reports_input_backpressure_without_blocking_stop() {
    let mut sidecar = Sidecar::start().await;
    sidecar
        .send(RuntimeRequest::Start {
            version: PROTOCOL_VERSION,
            request_id: "protocol-backpressure".into(),
            command: env!("CARGO_BIN_EXE_runtime-fixture").into(),
            args: vec!["--sleep-ms".into(), "30000".into()],
            cwd: None,
            env: None,
        })
        .await;
    assert!(matches!(
        sidecar.next_event().await,
        RuntimeEvent::ProcessStarted { request_id, .. } if request_id == "protocol-backpressure"
    ));

    let chunk =
        base64::engine::general_purpose::STANDARD.encode(vec![b'x'; STREAM_CHUNK_MAX_BYTES]);
    for _ in 0..40 {
        sidecar
            .send(RuntimeRequest::Write {
                version: PROTOCOL_VERSION,
                request_id: "protocol-backpressure".into(),
                data_base64: chunk.clone(),
            })
            .await;
    }
    sidecar
        .send(RuntimeRequest::Stop {
            version: PROTOCOL_VERSION,
            request_id: "protocol-backpressure".into(),
        })
        .await;

    let mut saw_backpressure = false;
    loop {
        match sidecar.next_event().await {
            RuntimeEvent::Error { code, .. } if code == "PROCESS_INPUT_QUEUE_FULL" => {
                saw_backpressure = true;
            }
            RuntimeEvent::ProcessExited { stopped: true, .. } => break,
            event => panic!("unexpected backpressure event: {event:?}"),
        }
    }
    assert!(saw_backpressure);
    sidecar.shutdown().await;
}
