use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use t3_runtime_protocol::{OutputMode, RuntimeEvent};
use t3_runtime_sidecar::{RunError, RunInput, run_process};
use tokio::sync::{mpsc, oneshot};

#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{HANDLE, STILL_ACTIVE};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

fn fixture() -> String {
    env!("CARGO_BIN_EXE_runtime-fixture").into()
}

fn drain_events(receiver: &mut mpsc::Receiver<RuntimeEvent>) -> Vec<RuntimeEvent> {
    let mut events = Vec::new();
    while let Ok(event) = receiver.try_recv() {
        events.push(event);
    }
    events
}

#[cfg(windows)]
fn process_is_alive(process_id: u32) -> bool {
    let raw_process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if raw_process.is_null() {
        return false;
    }
    let process = unsafe { OwnedHandle::from_raw_handle(raw_process as RawHandle) };
    let mut exit_code = 0_u32;
    (unsafe { GetExitCodeProcess(process.as_raw_handle() as HANDLE, &mut exit_code) }) != 0
        && exit_code == STILL_ACTIVE as u32
}

#[cfg(windows)]
async fn wait_for_tree_pids(pid_file: &Path, expected: usize) -> Vec<u32> {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let process_ids = std::fs::read_to_string(pid_file)
                .unwrap_or_default()
                .lines()
                .filter_map(|line| line.parse().ok())
                .collect::<Vec<_>>();
            if process_ids.len() >= expected {
                return process_ids;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("fixture process tree becomes ready")
}

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create(label: &str) -> Self {
        let unique = format!(
            "{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        );
        let path = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&path).expect("create test directory");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(windows)]
fn localhost_admin_share(path: &Path) -> Option<PathBuf> {
    let absolute = path.canonicalize().ok()?;
    let text = absolute.to_str()?;
    let text = text.strip_prefix(r"\\?\").unwrap_or(text);
    let (drive, suffix) = text.split_once(":\\")?;
    if drive.len() != 1 {
        return None;
    }
    Some(PathBuf::from(format!(
        r"\\localhost\{}$\{}",
        drive.to_ascii_uppercase(),
        suffix
    )))
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

#[tokio::test]
async fn runs_an_executable_from_a_unicode_path_with_spaces_and_deep_cwd() {
    let root = TestDirectory::create("sleepers code 项目");
    let deep_cwd = root
        .path()
        .join("repository with spaces")
        .join("深いディレクトリ")
        .join("segment-012345678901234567890123456789")
        .join("nested-012345678901234567890123456789");
    std::fs::create_dir_all(&deep_cwd).expect("create deep cwd");
    let source = PathBuf::from(fixture());
    let extension = source
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    let copied_fixture = root.path().join(format!("fixture 睡眠{extension}"));
    std::fs::copy(&source, &copied_fixture).expect("copy fixture into unicode path");

    let (events_tx, mut events_rx) = mpsc::channel(16);
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    run_process(
        RunInput {
            request_id: "unicode-path".into(),
            command: copied_fixture.to_string_lossy().into_owned(),
            args: vec![
                "--print-cwd".into(),
                "--print-env".into(),
                "SLEEPERS_RUNTIME_TEST".into(),
            ],
            cwd: Some(deep_cwd.to_string_lossy().into_owned()),
            env: Some(BTreeMap::from([(
                "SLEEPERS_RUNTIME_TEST".into(),
                "välue-值".into(),
            )])),
            stdin: None,
            timeout: Duration::from_secs(5),
            max_output_bytes: 4096,
            output_mode: OutputMode::Error,
            truncated_marker: String::new(),
        },
        events_tx,
        cancel_rx,
    )
    .await
    .expect("unicode path process succeeds");

    let completed = drain_events(&mut events_rx)
        .into_iter()
        .find_map(|event| match event {
            RuntimeEvent::ProcessCompleted { stdout, .. } => Some(stdout),
            _ => None,
        })
        .expect("completion event");
    assert!(completed.contains(&format!("cwd={}", deep_cwd.display())));
    assert!(completed.contains("env=välue-值"));
}

#[tokio::test]
async fn accepts_a_relative_working_directory() {
    let current = std::env::current_dir().expect("current directory");
    let root = current
        .join("target")
        .join(format!("relative-runtime-test-{}", std::process::id()));
    let _cleanup = TestDirectory(root.clone());
    std::fs::create_dir_all(&root).expect("create relative cwd");
    let relative = root
        .strip_prefix(&current)
        .expect("path is relative to cwd");
    let (events_tx, mut events_rx) = mpsc::channel(16);
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    run_process(
        RunInput {
            request_id: "relative-cwd".into(),
            command: fixture(),
            args: vec!["--print-cwd".into()],
            cwd: Some(relative.to_string_lossy().into_owned()),
            env: None,
            stdin: None,
            timeout: Duration::from_secs(5),
            max_output_bytes: 4096,
            output_mode: OutputMode::Error,
            truncated_marker: String::new(),
        },
        events_tx,
        cancel_rx,
    )
    .await
    .expect("relative cwd process succeeds");
    assert!(drain_events(&mut events_rx).into_iter().any(|event| matches!(
        event,
        RuntimeEvent::ProcessCompleted { stdout, .. } if stdout.contains(&format!("cwd={}", root.display()))
    )));
}

#[cfg(windows)]
#[tokio::test]
async fn supports_a_simulated_non_ascii_windows_user_profile() {
    let root = TestDirectory::create("sleepers-runtime-profile");
    let profile = root
        .path()
        .join("Users")
        .join("J\u{00f6}rg-\u{9879}\u{76ee}");
    let repository = profile.join("sleepers code");
    std::fs::create_dir_all(&repository).expect("create simulated profile repository");
    let (events_tx, mut events_rx) = mpsc::channel(16);
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    run_process(
        RunInput {
            request_id: "unicode-profile".into(),
            command: fixture(),
            args: vec![
                "--print-cwd".into(),
                "--print-env".into(),
                "USERPROFILE".into(),
            ],
            cwd: Some(repository.to_string_lossy().into_owned()),
            env: Some(BTreeMap::from([(
                "USERPROFILE".into(),
                profile.to_string_lossy().into_owned(),
            )])),
            stdin: None,
            timeout: Duration::from_secs(5),
            max_output_bytes: 4096,
            output_mode: OutputMode::Error,
            truncated_marker: String::new(),
        },
        events_tx,
        cancel_rx,
    )
    .await
    .expect("simulated unicode profile process succeeds");

    let completed = drain_events(&mut events_rx)
        .into_iter()
        .find_map(|event| match event {
            RuntimeEvent::ProcessCompleted { stdout, .. } => Some(stdout),
            _ => None,
        })
        .expect("completion event");
    assert!(completed.contains(&format!("cwd={}", repository.display())));
    assert!(completed.contains(&format!("env={}", profile.display())));
}

#[cfg(windows)]
#[tokio::test]
async fn runs_from_a_local_unc_working_directory() {
    let local_cwd = std::env::current_dir().expect("read current directory");
    let Some(unc_cwd) = localhost_admin_share(&local_cwd) else {
        eprintln!("local drive cannot be represented as an administrative UNC share");
        return;
    };
    let Some(unc_fixture) = localhost_admin_share(Path::new(&fixture())) else {
        eprintln!("fixture cannot be represented as an administrative UNC share");
        return;
    };
    if !unc_cwd.exists() || !unc_fixture.exists() {
        eprintln!("localhost administrative shares are unavailable on this host");
        return;
    }

    let (events_tx, mut events_rx) = mpsc::channel(16);
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    run_process(
        RunInput {
            request_id: "local-unc".into(),
            command: unc_fixture.to_string_lossy().into_owned(),
            args: vec!["--print-cwd".into()],
            cwd: Some(unc_cwd.to_string_lossy().into_owned()),
            env: None,
            stdin: None,
            timeout: Duration::from_secs(5),
            max_output_bytes: 4096,
            output_mode: OutputMode::Error,
            truncated_marker: String::new(),
        },
        events_tx,
        cancel_rx,
    )
    .await
    .expect("local UNC process succeeds");

    let reported_cwd = drain_events(&mut events_rx)
        .into_iter()
        .find_map(|event| match event {
            RuntimeEvent::ProcessCompleted { stdout, .. } => stdout
                .lines()
                .find_map(|line| line.strip_prefix("cwd=").map(PathBuf::from)),
            _ => None,
        })
        .expect("fixture reports cwd");
    assert_eq!(
        reported_cwd
            .canonicalize()
            .expect("canonicalize reported cwd"),
        unc_cwd.canonicalize().expect("canonicalize UNC cwd")
    );
}

#[tokio::test]
async fn rejects_a_directory_as_an_executable() {
    let root = TestDirectory::create("sleepers-runtime-not-executable");
    let (events_tx, _events_rx) = mpsc::channel(4);
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    let error = run_process(
        RunInput {
            request_id: "not-executable".into(),
            command: root.path().to_string_lossy().into_owned(),
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
    .expect_err("directory execution fails");
    assert!(matches!(error, RunError::Spawn(_)));
}

#[cfg(windows)]
#[tokio::test]
async fn cancellation_terminates_the_entire_windows_process_tree() {
    let root = TestDirectory::create("sleepers-runtime-tree");
    let pid_file = root.path().join("tree-pids.txt");
    let (events_tx, mut events_rx) = mpsc::channel(16);
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let task = tokio::spawn(run_process(
        RunInput {
            request_id: "tree-cancellation".into(),
            command: fixture(),
            args: vec![
                "--tree-depth".into(),
                "2".into(),
                "--pid-file".into(),
                pid_file.to_string_lossy().into_owned(),
            ],
            cwd: None,
            env: None,
            stdin: None,
            timeout: Duration::from_secs(10),
            max_output_bytes: 4096,
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
    let process_ids = wait_for_tree_pids(&pid_file, 3).await;
    assert!(
        process_ids
            .iter()
            .all(|process_id| process_is_alive(*process_id))
    );
    let cancellation_started = std::time::Instant::now();
    cancel_tx.send(()).expect("send tree cancellation");
    task.await
        .expect("join tree task")
        .expect("tree cancellation is a result");
    let cancellation_latency = cancellation_started.elapsed();

    assert!(
        cancellation_latency < Duration::from_secs(2),
        "tree cancellation took {cancellation_latency:?}"
    );
    assert!(
        process_ids
            .iter()
            .all(|process_id| !process_is_alive(*process_id))
    );
    assert!(matches!(
        events_rx.recv().await,
        Some(RuntimeEvent::ProcessCompleted {
            cancelled: true,
            ..
        })
    ));
}

#[cfg(windows)]
#[tokio::test]
async fn timeout_terminates_the_entire_windows_process_tree() {
    let root = TestDirectory::create("sleepers-runtime-timeout-tree");
    let pid_file = root.path().join("tree-pids.txt");
    let (events_tx, mut events_rx) = mpsc::channel(16);
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    let task = tokio::spawn(run_process(
        RunInput {
            request_id: "tree-timeout".into(),
            command: fixture(),
            args: vec![
                "--tree-depth".into(),
                "2".into(),
                "--pid-file".into(),
                pid_file.to_string_lossy().into_owned(),
            ],
            cwd: None,
            env: None,
            stdin: None,
            timeout: Duration::from_millis(750),
            max_output_bytes: 4096,
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
    let process_ids = wait_for_tree_pids(&pid_file, 3).await;
    task.await
        .expect("join timed out tree task")
        .expect("tree timeout is a result");

    assert!(
        process_ids
            .iter()
            .all(|process_id| !process_is_alive(*process_id))
    );
    assert!(matches!(
        events_rx.recv().await,
        Some(RuntimeEvent::ProcessCompleted {
            timed_out: true,
            ..
        })
    ));
}

#[cfg(windows)]
#[tokio::test]
async fn parent_crash_terminates_remaining_windows_descendants() {
    let root = TestDirectory::create("sleepers-runtime-crash-tree");
    let pid_file = root.path().join("tree-pids.txt");
    let ready_file = root.path().join("tree-ready.txt");
    let (events_tx, mut events_rx) = mpsc::channel(16);
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    run_process(
        RunInput {
            request_id: "tree-parent-crash".into(),
            command: fixture(),
            args: vec![
                "--tree-depth".into(),
                "2".into(),
                "--pid-file".into(),
                pid_file.to_string_lossy().into_owned(),
                "--ready-file".into(),
                ready_file.to_string_lossy().into_owned(),
                "--tree-root-exit-code".into(),
                "7".into(),
            ],
            cwd: None,
            env: None,
            stdin: None,
            timeout: Duration::from_secs(5),
            max_output_bytes: 4096,
            output_mode: OutputMode::Error,
            truncated_marker: String::new(),
        },
        events_tx,
        cancel_rx,
    )
    .await
    .expect("parent crash remains a process result");

    let process_ids = wait_for_tree_pids(&pid_file, 3).await;
    assert!(
        process_ids
            .iter()
            .all(|process_id| !process_is_alive(*process_id))
    );
    assert!(
        drain_events(&mut events_rx)
            .into_iter()
            .any(|event| matches!(
                event,
                RuntimeEvent::ProcessCompleted {
                    exit_code: Some(7),
                    ..
                }
            ))
    );
}
