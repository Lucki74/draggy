//! What a page logged to its console and which requests it made, kept in memory only so the agent can
//! debug a web app. Nothing here reaches disk or the logs. Query strings are dropped from URLs.

use std::collections::VecDeque;

use serde_json::{Value, json};

/// The most lines and requests kept; the oldest go first.
pub const MAX: usize = 200;

struct Line {
    level: &'static str,
    text: String,
}

struct Request {
    id: String,
    method: String,
    url: String,
    status: Option<i64>,
    failed: Option<String>,
}

#[derive(Default)]
pub struct Trace {
    console: VecDeque<Line>,
    requests: VecDeque<Request>,
}

/// A request address without its query or fragment.
pub fn plain_url(url: &str) -> String {
    let cut = url.find(['?', '#']).unwrap_or(url.len());
    url[..cut].chars().take(200).collect()
}

fn arg_text(arg: &Value) -> String {
    if let Some(value) = arg.get("value") {
        return match value {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        };
    }
    arg.get("description")
        .or_else(|| arg.get("type"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn level_of(kind: &str) -> &'static str {
    match kind {
        "info" => "info",
        "debug" => "debug",
        "warning" => "warn",
        "error" | "assert" => "error",
        _ => "log",
    }
}

fn clip(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

impl Trace {
    fn push_line(&mut self, line: Line) {
        self.console.push_back(line);
        if self.console.len() > MAX {
            self.console.pop_front();
        }
    }

    /// Takes one CDP event, as the page reports it.
    pub fn handle(&mut self, method: &str, params: &Value) {
        match method {
            "Runtime.consoleAPICalled" => {
                let kind = params.get("type").and_then(Value::as_str).unwrap_or("log");
                let text = params
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|args| args.iter().map(arg_text).collect::<Vec<_>>().join(" "))
                    .unwrap_or_default();
                self.push_line(Line {
                    level: level_of(kind),
                    text: clip(&text, 500),
                });
            }
            "Runtime.exceptionThrown" => {
                let details = params.get("exceptionDetails").unwrap_or(&Value::Null);
                let text = details
                    .pointer("/exception/description")
                    .or_else(|| details.get("text"))
                    .and_then(Value::as_str)
                    .unwrap_or("exception");
                self.push_line(Line {
                    level: "error",
                    text: clip(text, 500),
                });
            }
            "Network.requestWillBeSent" => {
                let id = str_at(params, "requestId");
                let request = params.get("request").unwrap_or(&Value::Null);
                let fresh = Request {
                    id: id.clone(),
                    method: request
                        .get("method")
                        .and_then(Value::as_str)
                        .unwrap_or("GET")
                        .to_owned(),
                    url: plain_url(request.get("url").and_then(Value::as_str).unwrap_or("")),
                    status: None,
                    failed: None,
                };
                match self.requests.iter_mut().find(|r| r.id == id) {
                    Some(slot) => *slot = fresh,
                    None => self.requests.push_back(fresh),
                }
                if self.requests.len() > MAX {
                    self.requests.pop_front();
                }
            }
            "Network.responseReceived" => {
                let id = str_at(params, "requestId");
                let status = params.pointer("/response/status").and_then(Value::as_i64);
                if let Some(entry) = self.requests.iter_mut().find(|r| r.id == id) {
                    entry.status = status;
                }
            }
            "Network.loadingFailed" => {
                let id = str_at(params, "requestId");
                let error = params
                    .get("errorText")
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                    .unwrap_or("failed");
                if let Some(entry) = self.requests.iter_mut().find(|r| r.id == id) {
                    entry.failed = Some(clip(error, 80));
                }
            }
            _ => {}
        }
    }

    pub fn console(&self, limit: usize) -> Value {
        let skip = self.console.len().saturating_sub(limit);
        Value::Array(
            self.console
                .iter()
                .skip(skip)
                .map(|line| json!({ "level": line.level, "text": line.text }))
                .collect(),
        )
    }

    pub fn network(&self, limit: usize, only_failed: bool) -> Value {
        let shown: Vec<&Request> = self
            .requests
            .iter()
            .filter(|r| !only_failed || r.failed.is_some() || r.status.is_some_and(|s| s >= 400))
            .collect();
        let skip = shown.len().saturating_sub(limit);
        Value::Array(
            shown
                .into_iter()
                .skip(skip)
                .map(|r| {
                    let mut row = json!({ "method": r.method, "url": r.url, "status": r.status });
                    if let Some(error) = &r.failed {
                        row["failed"] = json!(error);
                    }
                    row
                })
                .collect(),
        )
    }
}

fn str_at(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_and_fragment_are_dropped() {
        assert_eq!(plain_url("https://a.test/p?token=1#x"), "https://a.test/p");
        assert_eq!(plain_url("https://a.test/p"), "https://a.test/p");
    }

    #[test]
    fn console_keeps_the_newest_lines_with_levels() {
        let mut trace = Trace::default();
        for i in 0..(MAX + 5) {
            trace.handle(
                "Runtime.consoleAPICalled",
                &json!({ "type": "warning", "args": [{ "value": format!("line {i}") }] }),
            );
        }
        let lines = trace.console(3);
        assert_eq!(lines.as_array().map(Vec::len), Some(3));
        assert_eq!(
            lines[2],
            json!({ "level": "warn", "text": format!("line {}", MAX + 4) })
        );
    }

    #[test]
    fn only_failed_requests_show_errors_and_bad_statuses() {
        let mut trace = Trace::default();
        let sent = |id: &str| json!({ "requestId": id, "request": { "method": "GET", "url": "https://a.test/?k=v" } });
        trace.handle("Network.requestWillBeSent", &sent("1"));
        trace.handle(
            "Network.responseReceived",
            &json!({ "requestId": "1", "response": { "status": 200 } }),
        );
        trace.handle("Network.requestWillBeSent", &sent("2"));
        trace.handle(
            "Network.responseReceived",
            &json!({ "requestId": "2", "response": { "status": 404 } }),
        );
        assert_eq!(trace.network(50, false).as_array().map(Vec::len), Some(2));
        let failed = trace.network(50, true);
        assert_eq!(
            failed,
            json!([{ "method": "GET", "url": "https://a.test/", "status": 404 }])
        );
    }
}
