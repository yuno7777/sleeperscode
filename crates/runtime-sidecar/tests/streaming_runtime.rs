use std::collections::BTreeMap;

use base64::Engine;
use t3_runtime_protocol::{RuntimeEvent, RuntimeStream};
use t3_runtime_sidecar::{StreamingCommand, StreamingInput, run_streaming_process};
use tokio::sync::mpsc;

fn fixture() -> String {
    env!("CARGO_BIN_EXE_runtime-fixture").into()
}

fn input(args: &[&str]) -> StreamingInput {
    StreamingInput {
        request_id: "streaming-test".into(),
        command: fixture(),
        args: args.iter().map(|arg| (*arg).into()).collect(),
        cwd: Some(
            std::env::current_dir()
                .expect("read current directory")
                .to_string_lossy()
                .into_owned(),
        ),
        env: Some(BTreeMap::from([("T3_STREAMING_TEST".into(), "1".into())])),
    }
}

#[tokio::test]
async fn streams_exact_stdin_and_stdout_bytes() {
    let (events_tx, mut events_rx) = mpsc::channel(16);
    let (commands_tx, commands_rx) = mpsc::channel(4);
    let run = tokio::spawn(run_streaming_process(
        input(&["--echo-stdin"]),
        events_tx,
        commands_rx,
    ));

    let expected = vec![0, 1, 2, 0xf0, 0x9f, 0x99, 0x82, 0xfe, 0xff];
    commands_tx
        .send(StreamingCommand::Write(expected.clone()))
        .await
        .expect("enqueue stdin");
    commands_tx
        .send(StreamingCommand::CloseStdin)
        .await
        .expect("close stdin");
    run.await
        .expect("join streaming process")
        .expect("stream succeeds");

    let mut actual = Vec::new();
    let mut sequences = Vec::new();
    let mut exited = None;
    while let Ok(event) = events_rx.try_recv() {
        match event {
            RuntimeEvent::ProcessOutput {
                stream: RuntimeStream::Stdout,
                sequence,
                data_base64,
                ..
            } => {
                sequences.push(sequence);
                actual.extend(
                    base64::engine::general_purpose::STANDARD
                        .decode(data_base64)
                        .expect("decode output"),
                );
            }
            RuntimeEvent::ProcessExited {
                exit_code, stopped, ..
            } => exited = Some((exit_code, stopped)),
            _ => {}
        }
    }

    assert_eq!(actual, expected);
    assert_eq!(sequences, (0..sequences.len()).collect::<Vec<_>>());
    assert_eq!(exited, Some((Some(0), false)));
}

#[tokio::test]
async fn stop_terminates_a_streaming_process() {
    let (events_tx, mut events_rx) = mpsc::channel(16);
    let (commands_tx, commands_rx) = mpsc::channel(4);
    let run = tokio::spawn(run_streaming_process(
        input(&["--sleep-ms", "30000"]),
        events_tx,
        commands_rx,
    ));

    let started = events_rx.recv().await.expect("receive process start");
    assert!(matches!(started, RuntimeEvent::ProcessStarted { pid, .. } if pid > 0));
    commands_tx
        .send(StreamingCommand::Stop)
        .await
        .expect("request stop");
    run.await
        .expect("join streaming process")
        .expect("stop succeeds");

    let exited = events_rx.recv().await.expect("receive process exit");
    assert!(matches!(
        exited,
        RuntimeEvent::ProcessExited {
            exit_code: None,
            stopped: true,
            ..
        }
    ));
}
