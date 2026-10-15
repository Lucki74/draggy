//! The providers' network port on a blocking `reqwest` client. A turn runs on its own thread, so blocking reads are
//! fine there, and cancelling a body drops the connection, which stops the server's generation.

use std::collections::BTreeMap;
use std::io::Read;
use std::time::Duration;

use draggy_providers::http::{
    ByteStream, HttpClient, HttpHead, HttpRequest, HttpResponse, Method, TransportError,
};

pub struct Net {
    client: reqwest::blocking::Client,
}

fn transport(error: &reqwest::Error) -> TransportError {
    TransportError {
        message: if error.is_timeout() {
            "The request timed out.".to_owned()
        } else if error.is_connect() {
            "Could not connect to the model server.".to_owned()
        } else {
            "The request failed.".to_owned()
        },
        cause_message: Some(error.to_string()),
        code: None,
    }
}

impl Net {
    pub fn new() -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self { client })
    }

    fn start(&self, request: &HttpRequest) -> Result<reqwest::blocking::Response, TransportError> {
        let mut builder = match request.method {
            Method::Get => self.client.get(&request.url),
            Method::Post => self.client.post(&request.url),
        };
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = &request.body {
            builder = builder.body(body.clone());
        }
        if let Some(ms) = request.timeout_ms {
            builder = builder.timeout(Duration::from_millis(ms));
        }
        builder.send().map_err(|error| transport(&error))
    }
}

fn headers_of(response: &reqwest::blocking::Response) -> BTreeMap<String, String> {
    response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|text| (name.as_str().to_ascii_lowercase(), text.to_owned()))
        })
        .collect()
}

struct Body(Option<reqwest::blocking::Response>);

impl ByteStream for Body {
    fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, TransportError> {
        let Some(response) = self.0.as_mut() else {
            return Ok(None);
        };
        let mut buffer = vec![0_u8; 8192];
        match response.read(&mut buffer) {
            Ok(0) => {
                self.0 = None;
                Ok(None)
            }
            Ok(count) => {
                buffer.truncate(count);
                Ok(Some(buffer))
            }
            Err(error) => {
                self.0 = None;
                Err(TransportError {
                    message: "The connection was cut off.".to_owned(),
                    cause_message: Some(error.to_string()),
                    code: None,
                })
            }
        }
    }

    fn cancel(&mut self) {
        self.0 = None;
    }
}

impl HttpClient for Net {
    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, TransportError> {
        let response = self.start(request)?;
        let status = response.status().as_u16();
        let headers = headers_of(&response);
        let body = response.text().map_err(|error| transport(&error))?;
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }

    fn open(
        &self,
        request: &HttpRequest,
    ) -> Result<(HttpHead, Box<dyn ByteStream>), TransportError> {
        let response = self.start(request)?;
        let head = HttpHead {
            status: response.status().as_u16(),
            headers: headers_of(&response),
        };
        Ok((head, Box::new(Body(Some(response)))))
    }
}
