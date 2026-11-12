//! The loopback address a browser sign-in is sent back to. Port of mcpOauth.cjs `listenForCode`.

use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use base64::Engine;
use draggy_mcp::ports::BoxFuture;
use draggy_mcp::signin::{Callback, Redirect};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

/// How long a sign-in may wait for the browser to come back.
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

type Answer = Result<Callback, String>;

/// Serves one redirect on 127.0.0.1 and hands back its code. Closing it stops the listener.
#[derive(Default)]
pub struct LoopbackRedirect {
    answer: Mutex<Option<oneshot::Receiver<Answer>>>,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl Redirect for LoopbackRedirect {
    fn listen(&self) -> BoxFuture<'_, Result<String, String>> {
        Box::pin(async move {
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|error| error.to_string())?;
            let port = listener
                .local_addr()
                .map_err(|error| error.to_string())?
                .port();
            let (sender, receiver) = oneshot::channel();
            let task = tokio::spawn(serve(listener, sender));
            *self.answer.lock().unwrap_or_else(PoisonError::into_inner) = Some(receiver);
            *self.task.lock().unwrap_or_else(PoisonError::into_inner) = Some(task);
            Ok(format!("http://127.0.0.1:{port}/callback"))
        })
    }

    fn callback(&self) -> BoxFuture<'_, Answer> {
        Box::pin(async move {
            let receiver = self
                .answer
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .take()
                .ok_or_else(|| "Sign-in was not started.".to_owned())?;
            match tokio::time::timeout(SIGN_IN_TIMEOUT, receiver).await {
                Ok(Ok(answer)) => answer,
                Ok(Err(_)) => Err("Sign-in was refused.".to_owned()),
                Err(_) => Err("Sign-in was not finished in time.".to_owned()),
            }
        })
    }

    fn close(&self) {
        if let Some(task) = self
            .task
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
        {
            task.abort();
        }
    }
}

/// Takes the first request, answers it, and reports what it carried.
async fn serve(listener: TcpListener, sender: oneshot::Sender<Answer>) {
    let answer = match listener.accept().await {
        Ok((stream, _)) => respond(stream).await,
        Err(error) => Err(error.to_string()),
    };
    let _ = sender.send(answer);
}

async fn respond(stream: TcpStream) -> Answer {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let read = reader.read_line(&mut line).await;
    let answer = match read {
        Ok(_) => parse_request_line(&line),
        Err(error) => Err(error.to_string()),
    };
    let body = match &answer {
        Ok(_) => "Signed in. You can close this tab and go back to Draggy.",
        Err(_) => "Draggy did not receive a sign-in code. You can close this tab.",
    };
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let mut stream = reader.into_inner();
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.shutdown().await;
    answer
}

/// Reads `code`, `state` and `error` from a request line such as `GET /callback?code=x HTTP/1.1`.
pub fn parse_request_line(line: &str) -> Answer {
    let target = line.split_whitespace().nth(1).unwrap_or("");
    let query = target.split_once('?').map_or("", |(_, query)| query);
    let params = parse_query(query);
    let get = |key: &str| {
        params
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
            .filter(|value| !value.is_empty())
    };
    match get("code") {
        Some(code) => Ok(Callback {
            code,
            state: get("state"),
        }),
        None => Err(match get("error") {
            Some(error) => format!("Sign-in failed: {error}"),
            None => "Sign-in was refused.".to_owned(),
        }),
    }
}

/// Splits a query string into decoded name and value pairs.
pub fn parse_query(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (percent_decode(name), percent_decode(value))
        })
        .collect()
}

/// Decodes `%XX` escapes and `+` as a space. Malformed escapes are kept as written.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => out.push(b' '),
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
                match hex.and_then(|digits| u8::from_str_radix(digits, 16).ok()) {
                    Some(byte) => {
                        out.push(byte);
                        index += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            other => out.push(other),
        }
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A random token for the sign-in state and PKCE, URL-safe with no padding.
pub fn random_token(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).map_err(|_| "no randomness for the sign-in".to_owned())?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buffer))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_code_and_state_come_back_decoded() {
        let answer = parse_request_line("GET /callback?code=a%2Bb&state=s+1 HTTP/1.1").unwrap();
        assert_eq!(answer.code, "a+b");
        assert_eq!(answer.state.as_deref(), Some("s 1"));
    }

    #[test]
    fn an_error_without_a_code_is_the_refusal() {
        let error = parse_request_line("GET /callback?error=denied HTTP/1.1").unwrap_err();
        assert_eq!(error, "Sign-in failed: denied");
        let error = parse_request_line("GET /callback HTTP/1.1").unwrap_err();
        assert_eq!(error, "Sign-in was refused.");
    }

    #[test]
    fn a_bad_escape_is_kept_as_written() {
        assert_eq!(percent_decode("100%zz"), "100%zz");
        assert_eq!(percent_decode("%41"), "A");
    }

    #[test]
    fn random_tokens_are_url_safe() {
        let token = random_token(32).unwrap();
        assert!(token.len() >= 42);
        assert!(!token.contains(['+', '/', '=']));
    }
}
