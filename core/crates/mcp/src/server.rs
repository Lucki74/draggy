//! The servers Draggy runs: starting each one, calling its tools and stopping it. Processes and HTTP come in through
//! traits, so tests answer with scripts. Calls are serialised by the owner of `Servers`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::catalogue::{Config as CatalogueConfig, Entry, command_for, missing_requirements};
use crate::definition::{
    Definition, RemoteCredentials, ServerConfig, api_key_headers, definition_for,
};
use crate::http::{PROTOCOL_VERSION, Transport, TransportError};
use crate::js::{stringify, to_js_string, trim, truthy, utf16_len, utf16_prefix};
use crate::log::{Level, Log};
use crate::names::{qualified_name, scope_for};
use crate::net::Http;
use crate::ports::Ports;
use crate::process::{Launcher, Process};
use crate::provision::InstallCommand;
use crate::result::{render_tool_result, widget_uri};
use crate::signin::vault_key;
use crate::stdio::Conn;

/// How long a server may take to answer `initialize` and `tools/list`.
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_millis(60_000);

/// How long any single tool call, or widget read, may take.
pub const CALL_TIMEOUT: Duration = Duration::from_millis(120_000);

/// How much markup a widget may be before it is treated as a mistake.
const MAX_WIDGET_CHARS: usize = 256 * 1024;

/// How much of the stderr tail goes into a handshake error.
const DETAIL_CHARS: usize = 400;

/// The client version a stdio server is told about. HTTP servers are told another; both are the reference's.
const STDIO_CLIENT_VERSION: &str = "1.1.6";
const HTTP_CLIENT_VERSION: &str = "2.0.0";

/// How long the client waits on a server: for the handshake, and for any one call. The reference values are the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub handshake: Duration,
    pub call: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            handshake: HANDSHAKE_TIMEOUT,
            call: CALL_TIMEOUT,
        }
    }
}

/// One server as the interface sees it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ServerState {
    pub id: String,
    pub status: &'static str,
    pub error: Option<String>,
    pub tools: Vec<ToolState>,
}

/// One tool, with the name the model sees it by. A tool with no name leaves the key out, as the reference's JSON does.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<Value>,
    pub qualified_name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<Value>,
    pub input_schema: Value,
}

/// Per-call options: the turn the call belongs to, and whether an interface may be read.
#[derive(Debug, Clone, PartialEq)]
pub struct CallOptions {
    pub cid: Option<String>,
    pub widgets: bool,
}

impl Default for CallOptions {
    fn default() -> Self {
        Self {
            cid: None,
            widgets: true,
        }
    }
}

/// The result of one tool call: either the text it answered with, or why it failed.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CallOutcome {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<Widget>,
}

/// An interface a tool pointed at, with the markup read from its server.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Widget {
    pub uri: String,
    pub html: String,
}

impl CallOutcome {
    fn failed(error: String) -> Self {
        Self {
            success: false,
            text: None,
            error: Some(error),
            app: None,
        }
    }

    fn answered(text: String, widget: Option<Widget>) -> Self {
        let text = if !text.is_empty() {
            text
        } else if widget.is_some() {
            "(the tool answered with a widget)".to_owned()
        } else {
            "(the tool returned nothing)".to_owned()
        };

        Self {
            success: true,
            text: Some(text),
            error: None,
            app: widget,
        }
    }
}

/// A failure from either transport. `status` is set only when the server answered with an unhappy status.
#[derive(Debug, Clone, PartialEq)]
struct LinkError {
    message: String,
    status: Option<u16>,
}

impl LinkError {
    fn plain(message: String) -> Self {
        Self {
            message,
            status: None,
        }
    }

    fn from_transport(error: TransportError) -> Self {
        let status = match &error {
            TransportError::Status { status, .. } => Some(*status),
            _ => None,
        };
        Self {
            message: error.to_string(),
            status,
        }
    }
}

/// The way a running server is talked to.
enum Link<H: Http, P: Process> {
    Http(Transport<H, RemoteCredentials<H>>),
    Stdio(Conn<P>),
}

impl<H: Http, P: Process> Link<H, P> {
    fn transport(&self) -> &'static str {
        match self {
            Self::Http(_) => "http",
            Self::Stdio(_) => "stdio",
        }
    }

    fn alive(&self) -> bool {
        match self {
            Self::Http(_) => true,
            Self::Stdio(conn) => conn.is_live(),
        }
    }

    /// HTTP uses its own per-request limit, so `limit` only applies to stdio.
    async fn request(
        &mut self,
        method: &str,
        params: Value,
        limit: Duration,
    ) -> Result<Value, LinkError> {
        match self {
            Self::Http(transport) => transport
                .send(method, Some(params))
                .await
                .map_err(LinkError::from_transport),
            Self::Stdio(conn) => conn
                .request(method, params, limit)
                .await
                .map_err(LinkError::plain),
        }
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), LinkError> {
        match self {
            Self::Http(transport) => transport
                .notify(method, Some(params))
                .await
                .map_err(LinkError::from_transport),
            Self::Stdio(conn) => {
                conn.notify(method, params).await;
                Ok(())
            }
        }
    }

    async fn close(&mut self) {
        match self {
            Self::Http(transport) => transport.close().await,
            Self::Stdio(conn) => conn.stop().await,
        }
    }
}

/// One server in the table. A stdio server that has exited stays here until the next call tidies it away.
struct Live<H: Http, P: Process> {
    id: String,
    status: &'static str,
    error: Option<String>,
    tools: Vec<Value>,
    declares_env: bool,
    link: Link<H, P>,
}

/// Every running server, by id, in the order they started.
pub struct Servers<H: Http, L: Launcher> {
    http: H,
    launcher: L,
    log: Arc<dyn Log>,
    ports: Ports,
    limits: Limits,
    live: Vec<Live<H, L::Process>>,
}

impl<H: Http + Clone, L: Launcher> Servers<H, L> {
    /// The vault, the provisioner and the clock come in through `ports`, so the host decides where secrets and packages live.
    pub fn new(http: H, launcher: L, log: Arc<dyn Log>, ports: Ports) -> Self {
        Self {
            http,
            launcher,
            log,
            ports,
            limits: Limits::default(),
            live: Vec::new(),
        }
    }

    /// Replaces the reference limits, for tests that should not wait on them.
    pub fn with_limits(mut self, limits: Limits) -> Self {
        self.limits = limits;
        self
    }

    /// Every server that is up, with its tools.
    pub fn list(&self) -> Vec<ServerState> {
        self.live
            .iter()
            .filter(|live| live.link.alive())
            .map(state_of)
            .collect()
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.position(id).is_some()
    }

    /// Starts a server and completes its handshake. Never fails: a server that will not run is a message in the interface.
    /// A server already running is returned as it is.
    pub async fn start(&mut self, id: &str, config: &ServerConfig) -> ServerState {
        self.purge();
        if let Some(index) = self.position(id) {
            return self.state_at(index);
        }

        let Some(definition) = definition_for(id, config) else {
            return failed(id, format!("There is no server called \"{id}\"."));
        };

        let requirements = definition.requirements();
        let catalogue_config = config.catalogue_config();
        let missing = missing_requirements(Some(&requirements), &catalogue_config);
        if !missing.is_empty() {
            return failed(id, format!("Not configured yet: {}.", missing.join(", ")));
        }

        if requirements.transport.as_deref() == Some("http") {
            return self.start_remote(id, &definition, config).await;
        }

        self.start_stdio(id, &requirements, &catalogue_config).await
    }

    /// Stops a server, if it is running. Its exit is logged as a stop by the time this returns.
    pub async fn stop(&mut self, id: &str) -> bool {
        self.purge();
        if let Some(index) = self.position(id) {
            let mut live = self.live.remove(index);
            live.link.close().await;
        }
        true
    }

    /// Forgets a remote server's sign-in and stops it. The record goes first, so a stop never leaves a token behind.
    pub async fn sign_out(&mut self, id: &str) -> bool {
        self.ports.vault.remove(&vault_key(id));
        self.stop(id).await
    }

    /// Stops a server and starts it again with the same config.
    pub async fn restart(&mut self, id: &str, config: &ServerConfig) -> ServerState {
        self.stop(id).await;
        self.start(id, config).await
    }

    /// Stops every server, for quitting.
    pub async fn stop_all(&mut self) {
        let all: Vec<Live<H, L::Process>> = self.live.drain(..).collect();
        for mut live in all {
            live.link.close().await;
        }
    }

    /// Calls a tool on a running server and turns its answer into text.
    pub async fn call_tool(
        &mut self,
        server: &str,
        tool: &str,
        args: Value,
        options: &CallOptions,
    ) -> CallOutcome {
        self.purge();
        let scope = scope_for(server);

        let Some(index) = self.position(server) else {
            self.log.line(
                Level::Warn,
                &scope,
                "cannot call tool, server not running",
                with_cid(
                    json!({"server": server, "transport": "none", "toolName": tool}),
                    &options.cid,
                ),
            );
            return CallOutcome::failed(format!("The {server} server is not running."));
        };

        let transport = self.live[index].link.transport();
        let started = Instant::now();
        self.log.line(
            Level::Info,
            &scope,
            "tool call",
            with_cid(
                json!({"server": server, "transport": transport, "toolName": tool, "argHash": arg_hash(&args)}),
                &options.cid,
            ),
        );

        let params =
            json!({"name": tool, "arguments": if truthy(Some(&args)) { args } else { json!({}) }});
        let limit = self.limits.call;
        match self.live[index]
            .link
            .request("tools/call", params, limit)
            .await
        {
            Ok(result) => {
                let text = render_tool_result(&result);
                let duration_ms = elapsed_ms(started);

                // `isError` means the tool failed, as distinct from the call failing. Both are worth reporting.
                if truthy(result.get("isError")) {
                    self.log.line(
                        Level::Warn,
                        &scope,
                        "tool returned an error",
                        with_cid(
                            json!({
                                "server": server,
                                "transport": transport,
                                "toolName": tool,
                                "durMs": duration_ms,
                                "resultChars": utf16_len(&text),
                                "isError": true,
                            }),
                            &options.cid,
                        ),
                    );
                    let error = if text.is_empty() {
                        "The tool reported an error.".to_owned()
                    } else {
                        text
                    };
                    return CallOutcome::failed(error);
                }

                let uri = if options.widgets {
                    widget_uri(&result)
                } else {
                    None
                };
                let widget = match uri {
                    Some(uri) => self
                        .read_widget(index, server, transport, &uri)
                        .await
                        .map(|html| Widget { uri, html }),
                    None => None,
                };

                let result_chars = if text.is_empty() { 0 } else { utf16_len(&text) };
                self.log.line(
                    Level::Info,
                    &scope,
                    "tool finished",
                    with_cid(
                        json!({
                            "server": server,
                            "transport": transport,
                            "toolName": tool,
                            "durMs": duration_ms,
                            "resultChars": result_chars,
                            "isError": false,
                        }),
                        &options.cid,
                    ),
                );
                CallOutcome::answered(text, widget)
            }
            Err(error) => {
                self.log.line(
                    Level::Error,
                    &scope,
                    "tool call threw",
                    with_cid(
                        json!({
                            "server": server,
                            "transport": transport,
                            "toolName": tool,
                            "durMs": elapsed_ms(started),
                            "isError": true,
                            "reason": error.message,
                        }),
                        &options.cid,
                    ),
                );
                CallOutcome::failed(error.message)
            }
        }
    }

    async fn start_remote(
        &mut self,
        id: &str,
        definition: &Definition,
        config: &ServerConfig,
    ) -> ServerState {
        let url = definition.url().unwrap_or_default();
        let credentials = RemoteCredentials::new(
            self.http.clone(),
            self.ports.clone(),
            self.log.clone(),
            id,
            &url,
            api_key_headers(&config.env),
        );
        let transport = Transport::new(self.http.clone(), url, credentials);

        self.live.push(Live {
            id: id.to_owned(),
            status: "starting",
            error: None,
            tools: Vec::new(),
            declares_env: definition.declares_env(),
            link: Link::Http(transport),
        });
        let index = self.live.len() - 1;
        let started = Instant::now();

        match handshake(
            &mut self.live[index].link,
            HTTP_CLIENT_VERSION,
            self.limits.handshake,
        )
        .await
        {
            Ok((hello, tools)) => {
                self.mark_ready(index, tools);
                let summary =
                    handshake_summary("http", id, &hello, self.live[index].tools.len(), started);
                self.log
                    .line(Level::Info, &scope_for(id), "connected", summary);
                self.state_at(index)
            }
            Err(error) => {
                let live = self.live.remove(index);
                let reason = if error.status.is_some() {
                    Value::Null
                } else {
                    json!(error.message)
                };
                self.log.line(
                    Level::Warn,
                    &scope_for(id),
                    "could not reach server",
                    json!({"server": id, "transport": "http", "status": error.status, "reason": reason}),
                );

                // A refusal on a server with no key of its own is most likely a missing sign-in.
                let refused = error.message.contains("401") || error.message.contains("403");
                let message = if refused && !live.declares_env {
                    "That server wants you to sign in first.".to_owned()
                } else {
                    error.message
                };
                failed(id, message)
            }
        }
    }

    async fn start_stdio(
        &mut self,
        id: &str,
        requirements: &Entry,
        config: &CatalogueConfig,
    ) -> ServerState {
        let Some(spec) = command_for(Some(requirements), config) else {
            return failed(id, "Draggy has no command for that server.".to_owned());
        };

        let package = requirements.package.clone().unwrap_or_default();
        let entry = match self.provide(id, &package).await {
            Ok(entry) => entry,
            Err(message) => return failed(id, message),
        };

        // Only the program's name and the number of arguments: paths and env values stay out of the log.
        self.log.line(
            Level::Info,
            &scope_for(id),
            "spawning server",
            json!({
                "server": id,
                "transport": "stdio",
                "command": self.launcher.program_name(),
                "argCount": 1 + spec.args.len(),
            }),
        );

        let mut args = Vec::with_capacity(spec.args.len() + 1);
        args.push(entry);
        args.extend(spec.args.iter().cloned());
        let process = match self.launcher.spawn(&args, &spec.env) {
            Ok(process) => process,
            Err(message) => return failed(id, message),
        };

        self.live.push(Live {
            id: id.to_owned(),
            status: "starting",
            error: None,
            tools: Vec::new(),
            declares_env: requirements.env.as_ref().is_some_and(|env| !env.is_empty()),
            link: Link::Stdio(Conn::spawn(id, process, self.log.clone())),
        });
        let index = self.live.len() - 1;
        let started = Instant::now();

        match handshake(
            &mut self.live[index].link,
            STDIO_CLIENT_VERSION,
            self.limits.handshake,
        )
        .await
        {
            Ok((hello, tools)) => {
                self.mark_ready(index, tools);
                let summary =
                    handshake_summary("stdio", id, &hello, self.live[index].tools.len(), started);
                self.log
                    .line(Level::Info, &scope_for(id), "started", summary);
                self.state_at(index)
            }
            Err(error) => self.fail_handshake(index, id, error).await,
        }
    }

    /// The entry point of a server's package, installing the package first when it is not on disk yet.
    async fn provide(&self, id: &str, package: &str) -> Result<String, String> {
        let provisioner = self.ports.provisioner.as_ref();
        if !provisioner.ready() {
            return Err("Extensions are not ready yet.".to_owned());
        }

        let Some(command) = provisioner.install_command(package) else {
            return Err(
                "npm could not be found on this machine, and extensions are installed with it. Install Node.js and try again.".to_owned(),
            );
        };

        if let Some(entry) = provisioner.entry_point(package) {
            return Ok(entry);
        }

        let scope = scope_for(id);
        let fields = install_fields(&command);
        self.log.line(
            Level::Info,
            &scope,
            "installing server package",
            with_install(
                json!({"server": id, "transport": "stdio", "package": package}),
                &fields,
            ),
        );
        let started = Instant::now();

        if let Err(detail) = provisioner.install(&command).await {
            self.log.line(
                Level::Warn,
                &scope,
                "server package install failed",
                with_install(
                    json!({"server": id, "transport": "stdio", "package": package, "durMs": elapsed_ms(started), "detail": detail}),
                    &fields,
                ),
            );
            return Err(if detail.is_empty() {
                format!("{package} could not be installed.")
            } else {
                format!("{package} could not be installed: {detail}.")
            });
        }

        let Some(entry) = provisioner.entry_point(package) else {
            return Err(format!(
                "{package} installed but does not say which file to run."
            ));
        };

        self.log.line(
            Level::Info,
            &scope,
            "installed server package",
            with_install(
                json!({"server": id, "transport": "stdio", "package": package, "durMs": elapsed_ms(started)}),
                &fields,
            ),
        );
        Ok(entry)
    }

    /// The stdio handshake failed: stderr is usually the only account of why, so its tail goes into the error.
    async fn fail_handshake(&mut self, index: usize, id: &str, error: LinkError) -> ServerState {
        let mut live = self.live.remove(index);
        let mut detail = String::new();

        if let Link::Stdio(conn) = &live.link {
            detail = stderr_tail(&conn.stderr_text());
            conn.detach();
            if !conn.exit_logged() {
                self.log.line(
                    Level::Error,
                    "proc.mcp",
                    "server failed the handshake",
                    json!({
                        "server": id,
                        "transport": "stdio",
                        "reason": error.message,
                        "stderr": conn.stderr_dump(),
                    }),
                );
            }
        }

        if let Link::Stdio(conn) = &mut live.link {
            conn.join().await;
        }

        let message = if detail.is_empty() {
            error.message
        } else {
            format!("{}: {detail}", error.message)
        };
        failed(id, message)
    }

    async fn read_widget(
        &mut self,
        index: usize,
        server: &str,
        transport: &str,
        uri: &str,
    ) -> Option<String> {
        let resource = match self.live[index]
            .link
            .request("resources/read", json!({"uri": uri}), self.limits.call)
            .await
        {
            Ok(resource) => resource,
            Err(error) => {
                self.log.line(
                    Level::Warn,
                    &scope_for(server),
                    "could not read widget",
                    json!({"server": server, "transport": transport, "reason": error.message}),
                );
                return None;
            }
        };

        // Prefer the part that says it is HTML; fall back to the first with any text, since not every server sets a mime type.
        let empty = Vec::new();
        let contents = resource
            .get("contents")
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        let with_text: Vec<&Value> = contents
            .iter()
            .filter(|one| {
                one.get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| !trim(text).is_empty())
            })
            .collect();
        let html = with_text
            .iter()
            .find(|one| mime_of(one).contains("html"))
            .or(with_text.first())
            .copied()?;

        let markup = to_js_string(html.get("text").unwrap_or(&Value::Null));
        let chars = utf16_len(&markup);
        if chars > MAX_WIDGET_CHARS {
            self.log.line(
                Level::Warn,
                &scope_for(server),
                "widget too large to show",
                json!({"server": server, "transport": transport, "chars": chars}),
            );
            return None;
        }

        Some(markup)
    }

    fn mark_ready(&mut self, index: usize, tools: Vec<Value>) {
        let live = &mut self.live[index];
        live.status = "ready";
        live.tools = tools;
    }

    /// Drops servers whose process has exited, so the next start of the same id is not refused.
    fn purge(&mut self) {
        self.live.retain(|live| live.link.alive());
    }

    fn position(&self, id: &str) -> Option<usize> {
        self.live
            .iter()
            .position(|live| live.id == id && live.link.alive())
    }

    fn state_at(&self, index: usize) -> ServerState {
        state_of(&self.live[index])
    }
}

/// `initialize`, then the `initialized` notification, then `tools/list`. Any failure ends the handshake.
async fn handshake<H: Http, P: Process>(
    link: &mut Link<H, P>,
    client_version: &str,
    limit: Duration,
) -> Result<(Value, Vec<Value>), LinkError> {
    let hello = link
        .request(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "Draggy", "version": client_version},
            }),
            limit,
        )
        .await?;

    link.notify("notifications/initialized", json!({})).await?;

    let listed = link.request("tools/list", json!({}), limit).await?;
    let tools = listed
        .get("tools")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    Ok((hello, tools))
}

fn handshake_summary(
    transport: &str,
    id: &str,
    hello: &Value,
    tools: usize,
    started: Instant,
) -> Value {
    let capabilities: Vec<String> = match hello.get("capabilities").and_then(Value::as_object) {
        Some(object) => object.keys().cloned().collect(),
        None => Vec::new(),
    };

    json!({
        "transport": transport,
        "protocol": field(hello, &["protocolVersion"]),
        "server": id,
        "serverVersion": field(hello, &["serverInfo", "version"]),
        "capabilities": capabilities,
        "tools": tools,
        "durMs": elapsed_ms(started),
        "serverName": field(hello, &["serverInfo", "name"]),
    })
}

/// The last four stderr lines, joined, cut to 400 units. Empty when there was no stderr.
fn stderr_tail(text: &str) -> String {
    let trimmed = trim(text);
    let lines: Vec<&str> = trimmed.split('\n').collect();
    let start = lines.len().saturating_sub(4);
    utf16_prefix(&lines[start..].join(" "), DETAIL_CHARS)
}

fn state_of<H: Http, P: Process>(live: &Live<H, P>) -> ServerState {
    // A process error leaves the server in the list, marked as failed, as the reference does.
    let failure = match &live.link {
        Link::Stdio(conn) => conn.failure(),
        Link::Http(_) => None,
    };
    let (status, error) = match failure {
        Some(reason) => ("error", Some(reason)),
        None => (live.status, live.error.clone()),
    };

    ServerState {
        id: live.id.clone(),
        status,
        error,
        tools: live
            .tools
            .iter()
            .map(|tool| tool_state(&live.id, tool))
            .collect(),
    }
}

fn tool_state(server_id: &str, tool: &Value) -> ToolState {
    let name_text = match tool.get("name") {
        None => "undefined".to_owned(),
        Some(name) => to_js_string(name),
    };

    ToolState {
        name: tool.get("name").cloned(),
        qualified_name: qualified_name(server_id, &name_text),
        description: match tool.get("description") {
            Some(text) if truthy(Some(text)) => to_js_string(text),
            _ => String::new(),
        },
        annotations: tool
            .get("annotations")
            .filter(|value| truthy(Some(value)))
            .cloned(),
        input_schema: tool
            .get("inputSchema")
            .filter(|value| truthy(Some(value)))
            .cloned()
            .unwrap_or_else(|| json!({"type": "object", "properties": {}})),
    }
}

fn failed(id: &str, error: String) -> ServerState {
    ServerState {
        id: id.to_owned(),
        status: "error",
        error: Some(error),
        tools: Vec::new(),
    }
}

/// The first eight hex digits of the SHA-256 of the arguments. The arguments themselves never reach the log.
fn arg_hash(args: &Value) -> String {
    let text = if truthy(Some(args)) {
        stringify(args)
    } else {
        "{}".to_owned()
    };
    Sha256::digest(text.as_bytes())
        .iter()
        .take(4)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The install fields a log line carries: the program and its arguments, each cut to 80 units.
fn install_fields(command: &InstallCommand) -> Value {
    json!({
        "command": command.file,
        "args": command.args.iter().map(|arg| utf16_prefix(arg, 80)).collect::<Vec<_>>(),
    })
}

/// Adds the install fields to a log line's data.
fn with_install(mut data: Value, fields: &Value) -> Value {
    if let (Some(object), Some(extra)) = (data.as_object_mut(), fields.as_object()) {
        object.extend(extra.clone());
    }
    data
}

fn with_cid(mut data: Value, cid: &Option<String>) -> Value {
    if let (Some(cid), Some(object)) = (cid, data.as_object_mut()) {
        object.insert("cid".to_owned(), json!(cid));
    }
    data
}

fn mime_of(one: &Value) -> String {
    match one.get("mimeType") {
        Some(mime) if truthy(Some(mime)) => to_js_string(mime),
        _ => String::new(),
    }
}

/// Reads a path of object keys, giving null where any step is missing, as `a?.b?.c ?? null` does.
fn field(value: &Value, path: &[&str]) -> Value {
    path.iter()
        .try_fold(value, |current, key| current.get(*key))
        .cloned()
        .unwrap_or(Value::Null)
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}
