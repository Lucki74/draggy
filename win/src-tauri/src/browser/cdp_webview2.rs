//! The pane page's DevTools Protocol through WebView2's own COM calls. No remote debugging port: the
//! calls run on the UI thread, where the controller lives, and their replies come back over a channel.

use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde_json::Value;
use tauri::Webview;
use tauri::webview::PlatformWebview;
use tokio::sync::{broadcast, oneshot};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2DevToolsProtocolEventReceivedEventArgs,
    ICoreWebView2DevToolsProtocolEventReceiver,
};
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, DevToolsProtocolEventReceivedEventHandler,
    take_pwstr,
};
use windows::core::{HSTRING, PWSTR};

use super::cdp::{Cdp, CdpError};

/// A command the page never answers within this long is reported as a failure.
const CALL_TIMEOUT: Duration = Duration::from_secs(30);
const EVENT_BUFFER: usize = 64;

thread_local! {
    /// WebView2 delivers events to a receiver only while it is alive, and it must live on the UI thread.
    static RECEIVERS: RefCell<Vec<ICoreWebView2DevToolsProtocolEventReceiver>> = const { RefCell::new(Vec::new()) };
}

pub struct WebView2Cdp {
    webview: Webview,
    events: Mutex<HashMap<String, broadcast::Sender<Value>>>,
}

impl WebView2Cdp {
    pub fn new(webview: Webview) -> Self {
        Self {
            webview,
            events: Mutex::new(HashMap::new()),
        }
    }
}

/// Runs `work` on the UI thread with the page's core webview. Nothing runs if the webview is gone.
fn on_ui_thread(
    webview: &Webview,
    work: impl FnOnce(ICoreWebView2) + Send + 'static,
) -> Result<(), CdpError> {
    webview
        .with_webview(move |platform: PlatformWebview| {
            let controller = platform.controller();
            if let Ok(core) = unsafe { controller.CoreWebView2() } {
                work(core);
            }
        })
        .map_err(|error| CdpError(error.to_string()))
}

fn parse_reply(json: &str) -> Result<Value, CdpError> {
    if json.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(json).map_err(|error| CdpError(format!("bad protocol reply: {error}")))
}

impl Cdp for WebView2Cdp {
    fn call(
        &self,
        method: &str,
        params: Value,
    ) -> impl Future<Output = Result<Value, CdpError>> + Send {
        let (tx, rx) = oneshot::channel();
        let method = method.to_owned();
        let params = params.to_string();
        let dispatched = on_ui_thread(&self.webview, move |core| {
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |result: windows::core::Result<()>, json: String| {
                    let answer = match result {
                        Ok(()) => parse_reply(&json),
                        Err(error) => Err(CdpError(error.to_string())),
                    };
                    let _ = tx.send(answer);
                    Ok(())
                },
            ));
            // A refused call drops the handler, which drops the sender, so the caller sees the failure.
            let _ = unsafe {
                core.CallDevToolsProtocolMethod(
                    &HSTRING::from(method),
                    &HSTRING::from(params),
                    &handler,
                )
            };
        });
        async move {
            dispatched?;
            match tokio::time::timeout(CALL_TIMEOUT, rx).await {
                Ok(Ok(answer)) => answer,
                Ok(Err(_)) => Err(CdpError("the page did not answer".to_owned())),
                Err(_) => Err(CdpError("the page did not answer in time".to_owned())),
            }
        }
    }

    fn subscribe(&self, event: &str) -> broadcast::Receiver<Value> {
        let mut events = self.events.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(sender) = events.get(event) {
            return sender.subscribe();
        }
        let (sender, receiver) = broadcast::channel(EVENT_BUFFER);
        events.insert(event.to_owned(), sender.clone());
        let name = event.to_owned();
        // A failed registration leaves the event silent; the page itself is unaffected.
        let _ = on_ui_thread(&self.webview, move |core| {
            register_event(&core, &name, sender)
        });
        receiver
    }
}

fn register_event(core: &ICoreWebView2, name: &str, sender: broadcast::Sender<Value>) {
    let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(
        move |_source: Option<ICoreWebView2>,
              args: Option<ICoreWebView2DevToolsProtocolEventReceivedEventArgs>| {
            if let Some(args) = args {
                let mut raw = PWSTR::null();
                if unsafe { args.ParameterObjectAsJson(&mut raw) }.is_ok()
                    && let Ok(value) = parse_reply(&take_pwstr(raw))
                {
                    let _ = sender.send(value);
                }
            }
            Ok(())
        },
    ));
    let mut token = 0i64;
    let registered = unsafe { core.GetDevToolsProtocolEventReceiver(&HSTRING::from(name)) }
        .and_then(|receiver| {
            unsafe { receiver.add_DevToolsProtocolEventReceived(&handler, &mut token) }?;
            RECEIVERS.with(|keep| keep.borrow_mut().push(receiver));
            Ok(())
        });
    let _ = registered;
}
