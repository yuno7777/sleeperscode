use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OutputMode {
    Error,
    Truncate,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimeRequest {
    Run {
        version: u32,
        request_id: String,
        command: String,
        #[serde(default)]
        args: Vec<String>,
        cwd: Option<String>,
        env: Option<BTreeMap<String, String>>,
        stdin: Option<String>,
        timeout_ms: u64,
        max_output_bytes: usize,
        output_mode: OutputMode,
        #[serde(default)]
        truncated_marker: String,
    },
    Cancel {
        version: u32,
        request_id: String,
    },
    Shutdown {
        version: u32,
    },
}

impl RuntimeRequest {
    pub fn version(&self) -> u32 {
        match self {
            Self::Run { version, .. }
            | Self::Cancel { version, .. }
            | Self::Shutdown { version } => *version,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub finite_processes: bool,
    pub concurrent_processes: bool,
    pub cancellation: bool,
    pub streaming_processes: bool,
    pub shell_commands: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimeEvent {
    Hello {
        version: u32,
        runtime_version: String,
        sidecar_pid: u32,
        platform: String,
        arch: String,
        capabilities: RuntimeCapabilities,
    },
    ProcessStarted {
        version: u32,
        request_id: String,
        pid: u32,
    },
    ProcessCompleted {
        version: u32,
        request_id: String,
        exit_code: Option<i32>,
        timed_out: bool,
        cancelled: bool,
        stdout: String,
        stderr: String,
        stdout_truncated: bool,
        stderr_truncated: bool,
    },
    Error {
        version: u32,
        request_id: Option<String>,
        code: String,
        message: String,
        recoverable: bool,
        debug_detail: Option<String>,
        stream: Option<String>,
        max_output_bytes: Option<usize>,
        observed_output_bytes: Option<usize>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trips_as_camel_case_ndjson_payload() {
        let request = RuntimeRequest::Run {
            version: PROTOCOL_VERSION,
            request_id: "request-1".into(),
            command: "program.exe".into(),
            args: vec!["--flag".into()],
            cwd: Some(r"C:\workspace with spaces".into()),
            env: Some(BTreeMap::from([("T3_TEST".into(), "yes".into())])),
            stdin: Some("hello".into()),
            timeout_ms: 1_000,
            max_output_bytes: 4_096,
            output_mode: OutputMode::Truncate,
            truncated_marker: "...".into(),
        };

        let encoded = serde_json::to_string(&request).expect("serialize request");
        assert!(encoded.contains(r#""type":"run""#));
        assert!(encoded.contains(r#""requestId":"request-1""#));
        assert_eq!(
            serde_json::from_str::<RuntimeRequest>(&encoded).expect("deserialize request"),
            request
        );
    }

    #[test]
    fn event_round_trips_with_structured_error_fields() {
        let event = RuntimeEvent::Error {
            version: PROTOCOL_VERSION,
            request_id: Some("request-2".into()),
            code: "PROCESS_SPAWN_FAILED".into(),
            message: "Could not start the process.".into(),
            recoverable: true,
            debug_detail: Some("not found".into()),
            stream: None,
            max_output_bytes: None,
            observed_output_bytes: None,
        };

        let encoded = serde_json::to_string(&event).expect("serialize event");
        assert_eq!(
            serde_json::from_str::<RuntimeEvent>(&encoded).expect("deserialize event"),
            event
        );
    }
}
