use std::collections::BTreeMap;
use std::time::Duration;

use t3_runtime_protocol::{OutputMode, RuntimeEvent};
use t3_runtime_sidecar::{RunError, RunInput, run_process};
use tokio::sync::{mpsc, oneshot};

fn fixture() -> String {
    env!("CARGO_BIN_EXE_runtime-fixture").into()
}

async fn run(
    args: &[&str],
    stdin: Option<&str>,
    max_output_bytes: usize,
    mode: OutputMode,
) -> Vec<RuntimeEvent> {
    let (events_tx, mut events_rx) = mpsc::channel(16);
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    run_process(
        RunInput {
            request_id: "test-request".into(),
            command: fixture(),
            args: args.iter().map(|arg| (*arg).into()).collect(),
            cwd: Some(
                std::env::current_dir()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
            ),
            env: Some(BTreeMap::from([("T3_RUNTIME_TEST".into(), "1".into())])),
            stdin: stdin.map(Into::into),
            timeout: Duration::from_secs(5),
            max_output_bytes,
            output_mode: mode,
            truncated_marker: "[...]".into(),
        },
        events_tx,
        cancel_rx,
    )
    .await
    .expect("process run succeeds");
    let mut events = Vec::new();
    while let Ok(event) = events_rx.try_recv() {
        events.push(event);
    }
    events
}

#[tokio::test]
async fn captures_stdout_stderr_and_exit_code() {
    let events = run(
        &[
            "--stdout",
            "hello",
            "--stderr",
            "warning",
            "--exit-code",
            "7",
        ],
        None,
        4096,
        OutputMode::Error,
    )
    .await;
    assert!(matches!(events.first(), Some(RuntimeEvent::ProcessStarted { pid, .. }) if *pid > 0));
    assert!(matches!(
        events.last(),
        Some(RuntimeEvent::ProcessCompleted {
            exit_code: Some(7),
            stdout,
            stderr,
            timed_out: false,
            cancelled: false,
            ..
        }) if stdout == "hello" && stderr == "warning"
    ));
}

#[tokio::test]
async fn forwards_stdin() {
    let events = run(
        &["--echo-stdin"],
        Some("hello from stdin"),
        4096,
        OutputMode::Error,
    )
    .await;
    assert!(matches!(
        events.last(),
        Some(RuntimeEvent::ProcessCompleted { stdout, .. }) if stdout == "hello from stdin"
    ));
}

#[tokio::test]
async fn truncates_without_retaining_unbounded_output() {
    let events = run(
        &["--spam-bytes", "1048576"],
        None,
        1024,
        OutputMode::Truncate,
    )
    .await;
    assert!(matches!(
        events.last(),
        Some(RuntimeEvent::ProcessCompleted { stdout, stdout_truncated: true, .. })
            if stdout.len() <= 1024 && stdout.ends_with("[...]")
    ));
}

#[tokio::test]
async fn errors_as_soon_as_the_output_limit_is_crossed() {
    let (events_tx, _events_rx) = mpsc::channel(16);
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    let error = run_process(
        RunInput {
            request_id: "limit".into(),
            command: fixture(),
            args: vec![
                "--spam-bytes".into(),
                "1048576".into(),
                "--sleep-ms".into(),
                "5000".into(),
            ],
            cwd: None,
            env: None,
            stdin: None,
            timeout: Duration::from_secs(10),
            max_output_bytes: 1024,
            output_mode: OutputMode::Error,
            truncated_marker: String::new(),
        },
        events_tx,
        cancel_rx,
    )
    .await
    .expect_err("output limit should fail");
    assert!(matches!(
        error,
        RunError::OutputLimit {
            stream: "stdout",
            ..
        }
    ));
}

#[tokio::test]
async fn times_out_processes() {
    let (events_tx, mut events_rx) = mpsc::channel(16);
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    run_process(
        RunInput {
            request_id: "timeout".into(),
            command: fixture(),
            args: vec!["--sleep-ms".into(), "5000".into()],
            cwd: None,
            env: None,
            stdin: None,
            timeout: Duration::from_millis(20),
            max_output_bytes: 1024,
            output_mode: OutputMode::Error,
            truncated_marker: String::new(),
        },
        events_tx,
        cancel_rx,
    )
    .await
    .expect("timeout is a result");
    let mut completed = None;
    while let Ok(event) = events_rx.try_recv() {
        if matches!(event, RuntimeEvent::ProcessCompleted { .. }) {
            completed = Some(event);
        }
    }
    assert!(matches!(
        completed,
        Some(RuntimeEvent::ProcessCompleted {
            timed_out: true,
            ..
        })
    ));
}

#[tokio::test]
async fn cancels_an_active_process() {
    let (events_tx, mut events_rx) = mpsc::channel(16);
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let task = tokio::spawn(run_process(
        RunInput {
            request_id: "cancel".into(),
            command: fixture(),
            args: vec!["--sleep-ms".into(), "5000".into()],
            cwd: None,
            env: None,
            stdin: None,
            timeout: Duration::from_secs(10),
            max_output_bytes: 1024,
            output_mode: OutputMode::Error,
            truncated_marker: String::new(),
        },
        events_tx,
        cancel_rx,
    ));
    assert!(matches!(
        events_rx.recv().await,
        Some(RuntimeEvent::ProcessStarted { .. })
    ));
    cancel_tx.send(()).expect("send cancellation");
    task.await
        .expect("join run task")
        .expect("cancellation is a result");
    assert!(matches!(
        events_rx.recv().await,
        Some(RuntimeEvent::ProcessCompleted {
            cancelled: true,
            timed_out: false,
            ..
        })
    ));
}

#[tokio::test]
async fn rejects_failed_executable_and_invalid_working_directory() {
    let (events_tx, _events_rx) = mpsc::channel(4);
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    let spawn_error = run_process(
        RunInput {
            request_id: "missing".into(),
            command: "definitely-not-a-real-t3-runtime-executable".into(),
            args: vec![],
            cwd: None,
            env: None,
            stdin: None,
            timeout: Duration::from_secs(1),
            max_output_bytes: 1024,
            output_mode: OutputMode::Error,
            truncated_marker: String::new(),
        },
        events_tx,
        cancel_rx,
    )
    .await
    .expect_err("missing executable fails");
    assert!(matches!(spawn_error, RunError::Spawn(_)));

    let (events_tx, _events_rx) = mpsc::channel(4);
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    let cwd_error = run_process(
        RunInput {
            request_id: "cwd".into(),
            command: fixture(),
            args: vec![],
            cwd: Some("path-that-does-not-exist-t3-runtime".into()),
            env: None,
            stdin: None,
            timeout: Duration::from_secs(1),
            max_output_bytes: 1024,
            output_mode: OutputMode::Error,
            truncated_marker: String::new(),
        },
        events_tx,
        cancel_rx,
    )
    .await
    .expect_err("invalid cwd fails");
    assert!(matches!(cwd_error, RunError::InvalidWorkingDirectory(_)));
}

#[tokio::test]
async fn runs_multiple_processes_concurrently() {
    let (events_tx, mut events_rx) = mpsc::channel(32);
    let make_input = |request_id: &str, output: &str| RunInput {
        request_id: request_id.into(),
        command: fixture(),
        args: vec![
            "--sleep-ms".into(),
            "500".into(),
            "--stdout".into(),
            output.into(),
        ],
        cwd: None,
        env: None,
        stdin: None,
        timeout: Duration::from_secs(5),
        max_output_bytes: 1024,
        output_mode: OutputMode::Error,
        truncated_marker: String::new(),
    };
    let (_first_cancel_tx, first_cancel_rx) = oneshot::channel();
    let (_second_cancel_tx, second_cancel_rx) = oneshot::channel();
    let first = tokio::spawn(run_process(
        make_input("first", "one"),
        events_tx.clone(),
        first_cancel_rx,
    ));
    let second = tokio::spawn(run_process(
        make_input("second", "two"),
        events_tx,
        second_cancel_rx,
    ));

    let first_event = events_rx.recv().await.expect("first start event");
    let second_event = events_rx.recv().await.expect("second start event");
    assert!(matches!(first_event, RuntimeEvent::ProcessStarted { .. }));
    assert!(matches!(second_event, RuntimeEvent::ProcessStarted { .. }));
    first.await.expect("join first").expect("first succeeds");
    second.await.expect("join second").expect("second succeeds");
}
