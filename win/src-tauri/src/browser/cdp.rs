//! The Chrome DevTools Protocol surface the browser pane needs. The WebView2 implementation sits in
//! `cdp_webview2`; tests drive the same code through `FakeCdp`.

use std::fmt;
use std::future::Future;

use serde_json::Value;
use tokio::sync::broadcast;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CdpError(pub String);

impl fmt::Display for CdpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

pub trait Cdp: Send + Sync {
    /// Sends one protocol command to the page and resolves with its `result` object.
    fn call(
        &self,
        method: &str,
        params: Value,
    ) -> impl Future<Output = Result<Value, CdpError>> + Send;

    /// Events for one protocol event name, such as `Page.loadEventFired`. The first subscriber
    /// turns the event on in the page; each receiver gets every event after it subscribed.
    fn subscribe(&self, event: &str) -> broadcast::Receiver<Value>;
}

#[cfg(test)]
pub(crate) mod fake {
    use std::collections::{HashMap, VecDeque};
    use std::sync::Mutex;

    use super::*;

    /// Scripted answers per method. A method with one queued answer keeps returning it.
    #[derive(Default)]
    pub struct FakeCdp {
        answers: Mutex<HashMap<String, VecDeque<Result<Value, CdpError>>>>,
        calls: Mutex<Vec<(String, Value)>>,
        events: Mutex<HashMap<String, broadcast::Sender<Value>>>,
    }

    impl FakeCdp {
        pub fn answer(&self, method: &str, value: Value) -> &Self {
            self.push(method, Ok(value))
        }

        pub fn fail(&self, method: &str, message: &str) -> &Self {
            self.push(method, Err(CdpError(message.to_owned())))
        }

        fn push(&self, method: &str, answer: Result<Value, CdpError>) -> &Self {
            let mut answers = self.answers.lock().unwrap();
            answers
                .entry(method.to_owned())
                .or_default()
                .push_back(answer);
            self
        }

        pub fn methods(&self) -> Vec<String> {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .map(|(m, _)| m.clone())
                .collect()
        }

        pub fn params_of(&self, method: &str) -> Vec<Value> {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .filter(|(m, _)| m == method)
                .map(|(_, p)| p.clone())
                .collect()
        }
    }

    impl Cdp for FakeCdp {
        async fn call(&self, method: &str, params: Value) -> Result<Value, CdpError> {
            self.calls.lock().unwrap().push((method.to_owned(), params));
            let mut answers = self.answers.lock().unwrap();
            let Some(queue) = answers.get_mut(method) else {
                return Ok(Value::Null);
            };
            if queue.len() > 1 {
                queue.pop_front().unwrap()
            } else {
                queue.front().cloned().unwrap_or(Ok(Value::Null))
            }
        }

        fn subscribe(&self, event: &str) -> broadcast::Receiver<Value> {
            let mut events = self.events.lock().unwrap();
            events
                .entry(event.to_owned())
                .or_insert_with(|| broadcast::channel(16).0)
                .subscribe()
        }
    }
}
