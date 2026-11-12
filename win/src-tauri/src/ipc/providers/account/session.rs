//! One Claude Code process driven over its stream-json control protocol, for a sign-in, a listing or a status. The
//! process is killed when the session drops, so a cancel or a timeout leaves nothing running.

use std::collections::BTreeMap;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout};

const STOPPED: &str = "Claude Code stopped.";
const REFUSED: &str = "Claude Code refused the request";
const UNAVAILABLE: &str = "Claude Code did not start.";

pub struct Session {
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    next: u64,
}

impl Session {
    pub fn start(
        binary: &str,
        cwd: &str,
        env: &BTreeMap<String, String>,
        args: &[String],
    ) -> Result<Self, String> {
        let mut child = draggy_tools::spawn::hidden_command(binary, args, |command| {
            command.current_dir(cwd).env_clear().envs(env);
        })
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|_| UNAVAILABLE.to_owned())?;
        let stdin = child.stdin.take().ok_or_else(|| UNAVAILABLE.to_owned())?;
        let stdout = child.stdout.take().ok_or_else(|| UNAVAILABLE.to_owned())?;
        Ok(Self {
            child,
            stdin,
            lines: BufReader::new(stdout).lines(),
            next: 0,
        })
    }

    /// Sends one control request and waits for its answer. The runtime's own requests are refused, as Draggy does.
    pub async fn request(&mut self, subtype: &str, fields: Value) -> Result<Value, String> {
        self.next += 1;
        let id = format!("draggy-{}", self.next);
        let mut body = json!({ "subtype": subtype });
        if let (Some(target), Some(extra)) = (body.as_object_mut(), fields.as_object()) {
            for (key, value) in extra {
                target.insert(key.clone(), value.clone());
            }
        }
        let frame = json!({ "type": "control_request", "request_id": id, "request": body });
        self.write(&frame).await?;
        loop {
            let line = self
                .lines
                .next_line()
                .await
                .map_err(|_| STOPPED.to_owned())?
                .ok_or_else(|| STOPPED.to_owned())?;
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match message.get("type").and_then(Value::as_str) {
                Some("control_response") => {
                    let response = &message["response"];
                    if response["request_id"].as_str() != Some(id.as_str()) {
                        continue;
                    }
                    if response["subtype"].as_str() == Some("success") {
                        return Ok(response["response"].clone());
                    }
                    return Err(response["error"].as_str().unwrap_or(REFUSED).to_owned());
                }
                Some("control_request") => self.refuse(&message).await?,
                _ => {}
            }
        }
    }

    async fn refuse(&mut self, message: &Value) -> Result<(), String> {
        let subtype: String = message["request"]["subtype"]
            .as_str()
            .unwrap_or("request")
            .chars()
            .take(64)
            .collect();
        let frame = json!({
            "type": "control_response",
            "response": {
                "subtype": "error",
                "request_id": message["request_id"],
                "error": format!("{subtype} is not available in Draggy"),
            },
        });
        self.write(&frame).await
    }

    async fn write(&mut self, message: &Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(message).map_err(|_| STOPPED.to_owned())?;
        bytes.push(b'\n');
        self.stdin
            .write_all(&bytes)
            .await
            .map_err(|_| STOPPED.to_owned())?;
        self.stdin.flush().await.map_err(|_| STOPPED.to_owned())
    }

    /// Kills the process and waits a little for it to go, as the reference does.
    pub async fn stop(mut self) {
        let _ = self.child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(5), self.child.wait()).await;
    }
}
