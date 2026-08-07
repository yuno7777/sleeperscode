#![cfg(windows)]

use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use t3_runtime_protocol::{OutputMode, PROTOCOL_VERSION, RuntimeEvent, RuntimeRequest};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use windows_sys::Win32::Foundation::{HANDLE, STILL_ACTIVE};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).expect("create test directory");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct RunningTree {
    child: Child,
    stdin: ChildStdin,
    process_ids: Vec<u32>,
    _directory: TestDirectory,
}

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

async fn wait_for_tree_pids(pid_file: &Path) -> Vec<u32> {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let process_ids = std::fs::read_to_string(pid_file)
                .unwrap_or_default()
                .lines()
                .filter_map(|line| line.parse().ok())
                .collect::<Vec<_>>();
            if process_ids.len() >= 3 {
                return process_ids;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("fixture process tree becomes ready")
}

async fn wait_for_processes_to_exit(process_ids: &[u32]) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while process_ids
            .iter()
            .any(|process_id| process_is_alive(*process_id))
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("all fixture descendants exit");
}

async fn start_tree(label: &str) -> RunningTree {
    let directory = TestDirectory::create(label);
    let pid_file = directory.0.join("tree-pids.txt");
    let mut child = Command::new(env!("CARGO_BIN_EXE_t3-runtime-sidecar"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn runtime sidecar");
    let mut stdin = child.stdin.take().expect("sidecar stdin");
    let stdout = child.stdout.take().expect("sidecar stdout");
    let mut lines = BufReader::new(stdout).lines();
    let hello = lines
        .next_line()
        .await
        .expect("read hello")
        .expect("hello line");
    assert!(matches!(
        serde_json::from_str::<RuntimeEvent>(&hello).expect("decode hello"),
        RuntimeEvent::Hello { .. }
    ));

    let request = RuntimeRequest::Run {
        version: PROTOCOL_VERSION,
        request_id: "sidecar-tree".into(),
        command: env!("CARGO_BIN_EXE_runtime-fixture").into(),
        args: vec![
            "--tree-depth".into(),
            "2".into(),
            "--pid-file".into(),
            pid_file.to_string_lossy().into_owned(),
        ],
        cwd: None,
        env: None,
        stdin: None,
        timeout_ms: 30_000,
        max_output_bytes: 4096,
        output_mode: OutputMode::Error,
        truncated_marker: String::new(),
    };
    stdin
        .write_all(format!("{}\n", serde_json::to_string(&request).unwrap()).as_bytes())
        .await
        .expect("write run request");
    loop {
        let line = lines
            .next_line()
            .await
            .expect("read sidecar event")
            .expect("sidecar stays available");
        if matches!(
            serde_json::from_str::<RuntimeEvent>(&line).expect("decode sidecar event"),
            RuntimeEvent::ProcessStarted { .. }
        ) {
            break;
        }
    }
    let process_ids = wait_for_tree_pids(&pid_file).await;
    assert!(
        process_ids
            .iter()
            .all(|process_id| process_is_alive(*process_id))
    );

    RunningTree {
        child,
        stdin,
        process_ids,
        _directory: directory,
    }
}

#[tokio::test]
async fn graceful_sidecar_shutdown_terminates_owned_descendants() {
    let mut running = start_tree("sleepers-sidecar-shutdown").await;
    let shutdown = RuntimeRequest::Shutdown {
        version: PROTOCOL_VERSION,
    };
    running
        .stdin
        .write_all(format!("{}\n", serde_json::to_string(&shutdown).unwrap()).as_bytes())
        .await
        .expect("write shutdown request");
    drop(running.stdin);
    let status = tokio::time::timeout(Duration::from_secs(5), running.child.wait())
        .await
        .expect("sidecar exits within shutdown deadline")
        .expect("wait for sidecar");
    assert!(status.success());
    wait_for_processes_to_exit(&running.process_ids).await;
}

#[tokio::test]
async fn abrupt_sidecar_exit_closes_jobs_and_terminates_descendants() {
    let mut running = start_tree("sleepers-sidecar-crash").await;
    running.child.kill().await.expect("kill sidecar");
    let _ = running.child.wait().await;
    wait_for_processes_to_exit(&running.process_ids).await;
}
