use std::sync::atomic::{AtomicU64, Ordering};

use draggy_core::installer::NetDownloader;
use draggy_engine::binary_manager::{BinaryError, Downloader};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Serves `status` and `body` to every request on a free local port, and returns the base URL.
async fn serve(status: &'static str, body: Vec<u8>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let body = body.clone();
            tokio::spawn(async move {
                let mut request = [0_u8; 2048];
                let _ = socket.read(&mut request).await;
                let head = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(head.as_bytes()).await;
                let _ = socket.write_all(&body).await;
                let _ = socket.shutdown().await;
                // Wait for the client to close, so unread bytes do not turn the close into a reset.
                let mut rest = Vec::new();
                let _ = socket.read_to_end(&mut rest).await;
            });
        }
    });
    url
}

#[tokio::test]
async fn a_download_writes_the_body_and_counts_every_byte() {
    let body: Vec<u8> = (0..40_000_u32).map(|n| (n % 251) as u8).collect();
    let url = serve("200 OK", body.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("nested").join("engine.tar.gz");
    let counted = AtomicU64::new(0);

    NetDownloader::new()
        .unwrap()
        .download(&format!("{url}/engine.tar.gz"), &dest, &|bytes| {
            counted.fetch_add(bytes, Ordering::SeqCst);
        })
        .await
        .unwrap();

    assert_eq!(std::fs::read(&dest).unwrap(), body);
    assert_eq!(counted.load(Ordering::SeqCst), body.len() as u64);
}

#[tokio::test]
async fn a_failing_status_is_a_transfer_error_and_leaves_no_file() {
    let url = serve("404 Not Found", b"nope".to_vec()).await;
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("engine.tar.gz");

    let error = NetDownloader::new()
        .unwrap()
        .download(&url, &dest, &|_| {})
        .await
        .unwrap_err();

    assert!(matches!(error, BinaryError::Transfer(message) if message.contains("404")));
    assert!(!dest.exists());
}

#[tokio::test]
async fn get_text_returns_the_body() {
    let url = serve("200 OK", b"{\"tag_name\":\"b1\"}".to_vec()).await;
    let text = NetDownloader::new()
        .unwrap()
        .get_text(&url, Some("application/json"))
        .await
        .unwrap();
    assert_eq!(text, "{\"tag_name\":\"b1\"}");
}
