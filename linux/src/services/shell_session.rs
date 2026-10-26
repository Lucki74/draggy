use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use super::shell_detection::{ShellInfo, default_shell};

#[derive(Clone, Debug)]
pub struct SessionMessage {
    pub session_id: String,
    pub text: String,
}

pub struct ShellSession {
    pub id: String,
    pub shell: ShellInfo,
    pub is_running: Arc<Mutex<bool>>,
    child: Arc<Mutex<Option<Child>>>,
    stdin_tx: Arc<Mutex<Option<std::process::ChildStdin>>>,
}

impl ShellSession {
    pub fn new(id: String, shell: Option<ShellInfo>) -> Self {
        let shell = shell.unwrap_or_else(default_shell);
        Self {
            id,
            shell,
            is_running: Arc::new(Mutex::new(false)),
            child: Arc::new(Mutex::new(None)),
            stdin_tx: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start<F>(&self, on_output: F) -> Result<(), String>
    where
        F: Fn(String) + Send + 'static,
    {
        let mut child = Command::new(&self.shell.path)
            .arg("-l")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn {}: {}", self.shell.path, e))?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        *self.stdin_tx.lock().unwrap() = stdin;
        *self.child.lock().unwrap() = Some(child);
        *self.is_running.lock().unwrap() = true;

        let running_flag = Arc::clone(&self.is_running);
        let on_out = Arc::new(on_output);
        let on_err = Arc::clone(&on_out);

        if let Some(mut out) = stdout {
            let running = Arc::clone(&running_flag);
            thread::spawn(move || {
                let mut buf = [0u8; 1024];
                while *running.lock().unwrap() {
                    match out.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let s = String::from_utf8_lossy(&buf[..n]).to_string();
                            on_out(s);
                        }
                        Err(_) => break,
                    }
                }
                *running.lock().unwrap() = false;
            });
        }

        if let Some(mut err) = stderr {
            thread::spawn(move || {
                let mut buf = [0u8; 1024];
                while let Ok(n) = err.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let s = String::from_utf8_lossy(&buf[..n]).to_string();
                    on_err(s);
                }
            });
        }

        Ok(())
    }

    pub fn write_input(&self, text: &str) -> Result<(), String> {
        let mut guard = self.stdin_tx.lock().unwrap();
        if let Some(ref mut stdin) = *guard {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("Write failed: {}", e))?;
            stdin.flush().map_err(|e| format!("Flush failed: {}", e))?;
            Ok(())
        } else {
            Err("Stdin not available".to_string())
        }
    }

    pub fn terminate(&self) {
        *self.is_running.lock().unwrap() = false;
        let mut child_guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *child_guard {
            let _ = child.kill();
        }
        *child_guard = None;
    }
}

impl Drop for ShellSession {
    fn drop(&mut self) {
        self.terminate();
    }
}
