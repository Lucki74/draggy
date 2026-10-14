//! Asks the model host whether the network is up. Port of electron/connectivity.cjs, with the transition log kept.

use std::time::Duration;

use crate::http::{HttpClient, HttpRequest, Method};

/// Hugging Face is the only host Draggy needs, so it is the one asked. Google is never contacted.
pub const PROBE_URL: &str = "https://huggingface.co/api/models?limit=1";
// TS quirk: the CJS timeout is idle-socket (req.setTimeout). This one caps the whole request, so a slow trickle can outlast it.
const TIMEOUT: Duration = Duration::from_secs(3);

/// Holds the last answer so only changes are logged.
pub struct Connectivity<H> {
    http: H,
    last_online: Option<bool>,
}

impl<H: HttpClient> Connectivity<H> {
    pub fn new(http: H) -> Self {
        Self {
            http,
            last_online: None,
        }
    }

    /// A HEAD request to the probe. Any 2xx or 3xx is online; an error or a timeout is offline.
    pub async fn check(&mut self) -> bool {
        let request = HttpRequest {
            method: Method::Head,
            url: PROBE_URL.to_owned(),
            headers: Vec::new(),
            timeout: TIMEOUT,
            follow_redirects: false,
            page: false,
        };
        let online = match self.http.send(request).await {
            Ok(response) => (200..400).contains(&response.status),
            Err(_) => false,
        };
        match self.last_online {
            Some(previous) if previous != online => {
                if online {
                    tracing::info!(target: "net", "back online");
                } else {
                    tracing::info!(target: "net", "went offline");
                }
            }
            None if !online => tracing::warn!(target: "net", "offline at first check"),
            _ => {}
        }
        self.last_online = Some(online);
        online
    }
}
