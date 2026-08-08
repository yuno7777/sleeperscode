use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;
use t3_runtime_sidecar::{InheritedProcessInput, run_inherited_process};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherConfig {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
    #[serde(default)]
    initial_delay_ms: u64,
    argv_log_path: Option<PathBuf>,
    child_pid_log_path: Option<PathBuf>,
}

fn config_path() -> PathBuf {
    std::env::current_exe()
        .expect("resolve provider mock launcher path")
        .with_extension("json")
}

#[tokio::main]
async fn main() {
    let config: LauncherConfig = serde_json::from_slice(
        &std::fs::read(config_path()).expect("read provider mock launcher config"),
    )
    .expect("decode provider mock launcher config");
    let forwarded_args = std::env::args().skip(1).collect::<Vec<_>>();
    if let Some(path) = &config.argv_log_path {
        let mut log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .expect("open provider argv log");
        writeln!(log, "{}", forwarded_args.join("\t")).expect("write provider argv log");
    }
    if config.initial_delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(config.initial_delay_ms)).await;
    }

    let status = run_inherited_process(InheritedProcessInput {
        command: config.command,
        args: config.args.into_iter().chain(forwarded_args).collect(),
        env: config.env,
        child_pid_log_path: config.child_pid_log_path,
    })
    .await
    .expect("run provider mock child");
    std::process::exit(status.code().unwrap_or(1));
}
