//! The tools of running MCP servers, as the agent sees them: their definitions, the flags the permission engine reads,
//! and calls that run on the servers' runtime while the turn thread waits for the answer. The turn runs on a plain
//! thread, so `call` blocks on a runtime handle that the caller passes in and must never run on that runtime's threads.

use std::collections::HashMap;
use std::sync::Arc;

use draggy_agent::agent_loop::{ToolContext, ToolRuntime};
use draggy_agent::permissions::ToolAnnotations;
use draggy_agent::tool_channel::{FunctionDefinition, ToolDefinition};
use draggy_mcp::net::Http;
use draggy_mcp::process::Launcher;
use draggy_mcp::server::{CallOptions, ServerState, Servers};
use serde_json::Value;
use tokio::runtime::Handle;
use tokio::sync::Mutex;

/// What an unknown tool may do. Like MCP's own defaults, it may change things and lose work.
const CAUTIOUS: ToolAnnotations = ToolAnnotations {
    read_only: false,
    destructive: true,
    idempotent: false,
    open_world: true,
    sandboxed: false,
    executes: false,
};

/// One tool a running server offers: the name the server knows it by, and the flags the permission engine reads.
struct Entry {
    server: String,
    tool: String,
    annotations: ToolAnnotations,
}

/// The flags the permission engine reads, from a tool's MCP annotations. A missing hint takes MCP's own default:
/// the tool may lose work and reaches outside the machine unless it says otherwise.
pub fn annotations_from(annotations: Option<&Value>) -> ToolAnnotations {
    let hint = |key: &str| {
        annotations
            .and_then(|value| value.get(key))
            .and_then(Value::as_bool)
    };
    ToolAnnotations {
        read_only: hint("readOnlyHint") == Some(true),
        destructive: hint("destructiveHint") != Some(false),
        idempotent: hint("idempotentHint") == Some(true),
        open_world: hint("openWorldHint") != Some(false),
        sandboxed: false,
        executes: false,
    }
}

/// The tools of the servers that were running when the list was taken, callable by their qualified names.
pub struct McpTools<H: Http + Clone, L: Launcher> {
    handle: Handle,
    servers: Arc<Mutex<Servers<H, L>>>,
    entries: HashMap<String, Entry>,
    definitions: Vec<ToolDefinition>,
}

impl<H, L> McpTools<H, L>
where
    H: Http + Clone + Send + 'static,
    L: Launcher + Send + 'static,
{
    /// Takes the tools from `states`. A server that is not ready, or a tool with no name, is left out.
    pub fn new(handle: Handle, servers: Arc<Mutex<Servers<H, L>>>, states: &[ServerState]) -> Self {
        let mut entries = HashMap::new();
        let mut definitions = Vec::new();
        for server in states.iter().filter(|server| server.status == "ready") {
            for tool in &server.tools {
                let Some(name) = tool.name.as_ref().and_then(Value::as_str) else {
                    continue;
                };
                entries.insert(
                    tool.qualified_name.clone(),
                    Entry {
                        server: server.id.clone(),
                        tool: name.to_owned(),
                        annotations: annotations_from(tool.annotations.as_ref()),
                    },
                );
                definitions.push(ToolDefinition {
                    kind: "function".to_owned(),
                    function: FunctionDefinition {
                        name: tool.qualified_name.clone(),
                        description: tool.description.clone(),
                        parameters: tool.input_schema.clone(),
                    },
                });
            }
        }
        Self {
            handle,
            servers,
            entries,
            definitions,
        }
    }

    /// The definitions the model is offered for these tools.
    pub fn definitions(&self) -> &[ToolDefinition] {
        &self.definitions
    }

    /// Whether `name` is one of these tools, so a caller can route the call here.
    pub fn owns(&self, name: &str) -> bool {
        self.entries.contains_key(name)
    }

    /// Calls one tool and returns what the model reads back: the server's text, or its error.
    fn call(&self, name: &str, args: &Value) -> String {
        let Some(entry) = self.entries.get(name) else {
            return format!("TOOL ERROR: There is no tool called \"{name}\".");
        };
        let outcome = self.handle.block_on(async {
            let mut servers = self.servers.lock().await;
            servers
                .call_tool(
                    &entry.server,
                    &entry.tool,
                    args.clone(),
                    &CallOptions::default(),
                )
                .await
        });
        if outcome.success {
            outcome.text.unwrap_or_default()
        } else {
            outcome
                .error
                .unwrap_or_else(|| "The tool failed.".to_owned())
        }
    }
}

impl<H, L> ToolRuntime for McpTools<H, L>
where
    H: Http + Clone + Send + 'static,
    L: Launcher + Send + 'static,
{
    fn annotations(&self, name: &str) -> ToolAnnotations {
        self.entries
            .get(name)
            .map_or(CAUTIOUS, |entry| entry.annotations)
    }

    fn run(&mut self, name: &str, args: &Value, _ctx: &mut ToolContext<'_>) -> String {
        self.call(name, args)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use draggy_agent::permissions::ToolAnnotations;
    use draggy_agent::tool_channel::ToolDefinition;
    use draggy_mcp::child_process::StdioLauncher;
    use draggy_mcp::log::TracingLog;
    use draggy_mcp::ports::{BoxFuture, MemoryVault, Ports, Provisioner, SystemClock};
    use draggy_mcp::provision::InstallCommand;
    use draggy_mcp::reqwest_net::ReqwestHttp;
    use draggy_mcp::server::{ServerState, Servers, ToolState};
    use serde_json::{Value, json};
    use tokio::runtime::Runtime;
    use tokio::sync::Mutex;

    use super::{McpTools, annotations_from};

    /// Never installs anything: these tests do not start a server.
    struct NoProvisioner;

    impl Provisioner for NoProvisioner {
        fn ready(&self) -> bool {
            false
        }

        fn install_command(&self, _package: &str) -> Option<InstallCommand> {
            None
        }

        fn entry_point(&self, _package: &str) -> Option<String> {
            None
        }

        fn install(&self, _command: &InstallCommand) -> BoxFuture<'_, Result<(), String>> {
            Box::pin(async { Err("Installs are off in tests.".to_owned()) })
        }
    }

    fn servers() -> Arc<Mutex<Servers<ReqwestHttp, StdioLauncher>>> {
        let ports = Ports {
            vault: Arc::new(MemoryVault::default()),
            provisioner: Arc::new(NoProvisioner),
            clock: Arc::new(SystemClock),
        };
        let http = ReqwestHttp::new().expect("the HTTP client builds");
        let launcher = StdioLauncher::new(PathBuf::from("node"));
        Arc::new(Mutex::new(Servers::new(
            http,
            launcher,
            Arc::new(TracingLog),
            ports,
        )))
    }

    fn tool(name: Option<&str>, qualified: &str, annotations: Option<Value>) -> ToolState {
        ToolState {
            name: name.map(|text| json!(text)),
            qualified_name: qualified.to_owned(),
            description: format!("Does {qualified}."),
            annotations,
            input_schema: json!({"type": "object"}),
        }
    }

    fn server(id: &str, status: &'static str, tools: Vec<ToolState>) -> ServerState {
        ServerState {
            id: id.to_owned(),
            status,
            error: None,
            tools,
        }
    }

    #[test]
    fn missing_hints_take_the_cautious_defaults() {
        let flags = annotations_from(None);
        assert_eq!(
            flags,
            ToolAnnotations {
                read_only: false,
                destructive: true,
                idempotent: false,
                open_world: true,
                sandboxed: false,
                executes: false,
            }
        );
    }

    #[test]
    fn stated_hints_are_read() {
        let flags = annotations_from(Some(&json!({
            "readOnlyHint": true,
            "destructiveHint": false,
            "idempotentHint": true,
            "openWorldHint": false,
        })));
        assert!(flags.read_only);
        assert!(!flags.destructive);
        assert!(flags.idempotent);
        assert!(!flags.open_world);
    }

    #[test]
    fn only_ready_servers_offer_named_tools() {
        let states = vec![
            server(
                "docs",
                "ready",
                vec![
                    tool(Some("search"), "docs__search", None),
                    tool(None, "docs__nameless", None),
                ],
            ),
            server(
                "news",
                "starting",
                vec![tool(Some("headlines"), "news__headlines", None)],
            ),
        ];
        let runtime = Runtime::new().expect("a runtime starts");
        let tools = McpTools::new(runtime.handle().clone(), servers(), &states);

        let names: Vec<&str> = tools
            .definitions()
            .iter()
            .map(|definition: &ToolDefinition| definition.function.name.as_str())
            .collect();
        assert_eq!(names, vec!["docs__search"]);
        assert_eq!(tools.definitions()[0].kind, "function");
        assert!(tools.owns("docs__search"));
        assert!(!tools.owns("news__headlines"));
    }

    #[test]
    fn an_unknown_tool_is_cautious_and_refused_by_name() {
        let runtime = Runtime::new().expect("a runtime starts");
        let tools = McpTools::new(runtime.handle().clone(), servers(), &[]);

        let flags = tools.annotations("docs__missing");
        assert!(flags.destructive);
        assert!(!flags.read_only);
        assert_eq!(
            tools.call("docs__missing", &json!({})),
            "TOOL ERROR: There is no tool called \"docs__missing\"."
        );
    }

    #[test]
    fn a_call_to_a_server_that_is_not_running_says_so() {
        let states = vec![server(
            "docs",
            "ready",
            vec![tool(
                Some("search"),
                "docs__search",
                Some(json!({"readOnlyHint": true})),
            )],
        )];
        let runtime = Runtime::new().expect("a runtime starts");
        let tools = McpTools::new(runtime.handle().clone(), servers(), &states);

        assert!(tools.annotations("docs__search").read_only);
        assert_eq!(
            tools.call("docs__search", &json!({"q": "x"})),
            "The docs server is not running."
        );
    }
}
