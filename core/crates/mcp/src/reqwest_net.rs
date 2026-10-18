//! The production [`Http`] seam, backed by reqwest. Errors never carry the request URL, so a query cannot reach the log.

use std::future::Future;
use std::time::Duration;

use crate::net::{Http, Method, NetError, Request, Response};

/// Sends MCP and registry requests over one shared connection pool.
#[derive(Clone)]
pub struct ReqwestHttp {
    client: reqwest::Client,
}

impl ReqwestHttp {
    /// Builds the client. The only failure is the TLS backend refusing to start.
    pub fn new() -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .user_agent(concat!("Draggy/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| error.without_url().to_string())?;
        Ok(Self { client })
    }
}

impl Http for ReqwestHttp {
    fn send(&self, request: Request) -> impl Future<Output = Result<Response, NetError>> + Send {
        let client = self.client.clone();
        async move {
            let method = match request.method {
                Method::Get => reqwest::Method::GET,
                Method::Post => reqwest::Method::POST,
                Method::Delete => reqwest::Method::DELETE,
            };
            let mut builder = client
                .request(method, &request.url)
                .timeout(request.timeout);
            for (name, value) in &request.headers {
                builder = builder.header(name.as_str(), value.as_str());
            }
            if let Some(body) = request.body {
                builder = builder.body(body);
            }
            let response = builder.send().await.map_err(map_error)?;
            let status = response.status().as_u16();
            let headers = response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    Some((name.as_str().to_owned(), value.to_str().ok()?.to_owned()))
                })
                .collect();
            let body = response.text().await.map_err(map_error)?;
            Ok(Response {
                status,
                headers,
                body,
            })
        }
    }
}

fn map_error(error: reqwest::Error) -> NetError {
    if error.is_timeout() {
        NetError::Timeout
    } else {
        NetError::Failed(error.without_url().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Serves one canned response on a loopback port and returns the port.
    async fn serve_once(reply: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buffer = [0_u8; 4096];
                let _ = socket.read(&mut buffer).await;
                let _ = socket.write_all(reply.as_bytes()).await;
            }
        });
        port
    }

    fn get(url: String) -> Request {
        Request {
            method: Method::Get,
            url,
            headers: vec![("accept".to_owned(), "text/plain".to_owned())],
            body: None,
            timeout: Duration::from_secs(5),
        }
    }

    #[tokio::test]
    async fn returns_status_headers_and_body() {
        let port = serve_once("HTTP/1.1 201 Created\r\nX-Probe: yes\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            .await;
        let http = ReqwestHttp::new().expect("client");
        let response = http
            .send(get(format!("http://127.0.0.1:{port}/x")))
            .await
            .expect("response");
        assert_eq!(response.status, 201);
        assert!(response.ok());
        assert_eq!(response.header("x-probe"), Some("yes"));
        assert_eq!(response.body, "ok");
    }

    #[tokio::test]
    async fn refused_connection_is_a_failure_without_the_url() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);
        let http = ReqwestHttp::new().expect("client");
        let error = http
            .send(get(format!("http://127.0.0.1:{port}/secret-token")))
            .await
            .expect_err("refused");
        match error {
            NetError::Failed(text) => assert!(!text.contains("secret-token")),
            NetError::Timeout => panic!("expected a failure, not a timeout"),
        }
    }
}
