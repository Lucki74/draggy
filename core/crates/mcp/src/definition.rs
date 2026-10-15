//! What a server is: a catalogue entry, an npm package the user saved, or a URL. Also the config the user enters for it.

use std::fmt;
use std::future::{Future, ready};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::catalogue::{Argument, Config as CatalogueConfig, Entry, EnvVar, find_entry};
use crate::http::Credentials;
use crate::js::{to_js_string, truthy};
use crate::log::Log;
use crate::net::Http;
use crate::ports::Ports;
use crate::signin::{access_token, refresh_tokens};

const NPM_PAGE: &str = "https://www.npmjs.com/package/";

/// The settings the user has entered for a server, as the app stores them. Secrets are merged in before this point.
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ServerConfig {
    pub url: Option<String>,
    pub name: Option<String>,
    pub package: Option<String>,
    pub description: Option<String>,
    pub docs: Option<String>,
    pub args: Option<Vec<String>>,
    pub arguments_list: Option<Vec<Argument>>,
    pub env_declarations: Option<Vec<EnvVar>>,
    pub env: Map<String, Value>,
    pub arguments: Map<String, Value>,
}

/// The environment values are credentials, so only their names are printed.
impl fmt::Debug for ServerConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ServerConfig")
            .field("url", &self.url)
            .field("name", &self.name)
            .field("package", &self.package)
            .field("description", &self.description)
            .field("docs", &self.docs)
            .field("args", &self.args)
            .field("arguments_list", &self.arguments_list)
            .field("env_declarations", &self.env_declarations)
            .field("env", &self.env.keys().collect::<Vec<_>>())
            .field("arguments", &self.arguments)
            .finish()
    }
}

impl ServerConfig {
    /// The part of the config the catalogue checks requirements against and builds the command line from.
    pub fn catalogue_config(&self) -> CatalogueConfig {
        CatalogueConfig {
            env: self.env.clone(),
            arguments: self.arguments.clone(),
        }
    }
}

/// A server saved from the registry or entered by hand as an npm package.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PackageDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub package: String,
    pub docs: String,
    pub args: Vec<String>,
    pub arguments: Vec<Argument>,
    pub env: Vec<EnvVar>,
    pub source: String,
}

/// A server reached over HTTP, saved with its address.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RemoteDefinition {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub url: String,
    pub remote: bool,
}

/// The three kinds of server, in the order they are looked up.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Definition {
    Catalogue(Entry),
    Package(PackageDefinition),
    Remote(RemoteDefinition),
}

impl Definition {
    /// The definition as a catalogue entry, which is what the requirement and command checks read.
    pub fn requirements(&self) -> Entry {
        match self {
            Self::Catalogue(entry) => entry.clone(),
            Self::Package(package) => Entry {
                id: package.id.clone(),
                name: Some(package.name.clone()),
                description: package.description.clone(),
                package: Some(package.package.clone()),
                docs: Some(package.docs.clone()),
                args: Some(package.args.clone()),
                arguments: Some(package.arguments.clone()),
                env: Some(package.env.clone()),
                source: Some(package.source.clone()),
                ..Entry::default()
            },
            Self::Remote(remote) => Entry {
                id: remote.id.clone(),
                name: Some(remote.name.clone()),
                transport: Some(remote.transport.clone()),
                url: Some(remote.url.clone()),
                remote: Some(remote.remote),
                ..Entry::default()
            },
        }
    }

    /// The address a remote server is called at, if it has one.
    pub fn url(&self) -> Option<String> {
        match self {
            Self::Catalogue(entry) => entry.url.clone(),
            Self::Package(_) => None,
            Self::Remote(remote) => Some(remote.url.clone()),
        }
    }

    /// Whether the server declares any environment variables. A sign-in refusal means something else when it does.
    pub fn declares_env(&self) -> bool {
        self.requirements().env.is_some_and(|env| !env.is_empty())
    }
}

/// The definition for a server id: a catalogue entry first, then a saved package, then a saved URL. Nothing matches otherwise.
pub fn definition_for(id: &str, config: &ServerConfig) -> Option<Definition> {
    if let Some(entry) = find_entry(id) {
        return Some(Definition::Catalogue(entry));
    }

    package_definition(id, config).or_else(|| remote_definition(id, config))
}

/// Whether a server is one Draggy reaches over the network.
pub fn is_remote(id: &str, config: &ServerConfig) -> bool {
    definition_for(id, config)
        .is_some_and(|definition| definition.requirements().transport.as_deref() == Some("http"))
}

/// The headers that carry an API key for the servers that take one. Both names are sent, as the reference sends them.
pub fn api_key_headers(env: &Map<String, Value>) -> Vec<(String, String)> {
    let key = ["COMPOSIO_API_KEY", "API_KEY", "MCP_API_KEY"]
        .into_iter()
        .find_map(|name| env.get(name).filter(|value| truthy(Some(value))));

    match key {
        Some(key) => {
            let key = to_js_string(key);
            vec![
                ("x-consumer-api-key".to_owned(), key.clone()),
                ("x-api-key".to_owned(), key),
            ]
        }
        None => Vec::new(),
    }
}

/// The token and headers a remote server is called with. The token is read from the vault on each request, so a refresh
/// is picked up, and a 401 asks for one refresh before the request is sent again.
pub struct RemoteCredentials<H> {
    http: H,
    ports: Ports,
    log: Arc<dyn Log>,
    id: String,
    url: String,
    headers: Vec<(String, String)>,
}

impl<H: Http> RemoteCredentials<H> {
    pub fn new(
        http: H,
        ports: Ports,
        log: Arc<dyn Log>,
        id: &str,
        url: &str,
        headers: Vec<(String, String)>,
    ) -> Self {
        Self {
            http,
            ports,
            log,
            id: id.to_owned(),
            url: url.to_owned(),
            headers,
        }
    }
}

/// The token itself and the header values are never printed.
impl<H> fmt::Debug for RemoteCredentials<H> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RemoteCredentials")
            .field("id", &self.id)
            .field("url", &self.url)
            .field(
                "headers",
                &self
                    .headers
                    .iter()
                    .map(|(name, _)| name)
                    .collect::<Vec<_>>(),
            )
            .finish()
    }
}

impl<H: Http> Credentials for RemoteCredentials<H> {
    fn token(&self) -> impl Future<Output = Option<String>> + Send {
        ready(access_token(self.ports.vault.as_ref(), &self.id))
    }

    fn headers(&self) -> impl Future<Output = Option<Vec<(String, String)>>> + Send {
        ready(Some(self.headers.clone()))
    }

    fn unauthorized(&self) -> impl Future<Output = bool> + Send {
        refresh_tokens(
            &self.http,
            &self.ports,
            self.log.as_ref(),
            &self.id,
            &self.url,
        )
    }
}

fn package_definition(id: &str, config: &ServerConfig) -> Option<Definition> {
    let package = non_empty(config.package.as_deref())?;

    Some(Definition::Package(PackageDefinition {
        id: id.to_owned(),
        name: non_empty(config.name.as_deref()).unwrap_or(id).to_owned(),
        description: config.description.clone().unwrap_or_default(),
        package: package.to_owned(),
        docs: non_empty(config.docs.as_deref())
            .map_or_else(|| format!("{NPM_PAGE}{package}"), str::to_owned),
        args: config.args.clone().unwrap_or_default(),
        arguments: config.arguments_list.clone().unwrap_or_default(),
        env: config.env_declarations.clone().unwrap_or_default(),
        source: "registry".to_owned(),
    }))
}

fn remote_definition(id: &str, config: &ServerConfig) -> Option<Definition> {
    let url = non_empty(config.url.as_deref())?;

    Some(Definition::Remote(RemoteDefinition {
        id: id.to_owned(),
        name: non_empty(config.name.as_deref()).unwrap_or(id).to_owned(),
        transport: "http".to_owned(),
        url: url.to_owned(),
        remote: true,
    }))
}

/// A JavaScript falsy string is the empty one. Whitespace is truthy and stays.
fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.is_empty())
}

#[cfg(test)]
mod tests {
    use std::future::{Future, ready};
    use std::sync::Arc;

    use serde_json::json;

    use super::*;
    use crate::log::{Level, Log};
    use crate::net::{Http, NetError, Request, Response};
    use crate::ports::{Clock, MemoryVault, Ports, Provisioner, Vault};

    /// Refuses every request, since the redaction test sends nothing.
    struct Offline;

    impl Http for Offline {
        fn send(
            &self,
            _request: Request,
        ) -> impl Future<Output = Result<Response, NetError>> + Send {
            ready(Err(NetError::Failed("offline".to_owned())))
        }
    }

    struct Nothing;

    impl Log for Nothing {
        fn line(&self, _level: Level, _scope: &str, _message: &str, _data: Value) {}
    }

    struct NoPackages;

    impl Provisioner for NoPackages {
        fn ready(&self) -> bool {
            false
        }

        fn install_command(&self, _package: &str) -> Option<crate::provision::InstallCommand> {
            None
        }

        fn entry_point(&self, _package: &str) -> Option<String> {
            None
        }

        fn install(
            &self,
            _command: &crate::provision::InstallCommand,
        ) -> crate::ports::BoxFuture<'_, Result<(), String>> {
            Box::pin(ready(Err(String::new())))
        }
    }

    struct Zero;

    impl Clock for Zero {
        fn now_ms(&self) -> f64 {
            0.0
        }
    }

    #[test]
    fn a_config_debug_print_names_its_environment_but_not_its_values() {
        let config: ServerConfig = serde_json::from_value(json!({
            "url": "https://tools.example/mcp",
            "env": {"API_KEY": "sk-live-never-printed"},
        }))
        .unwrap_or_default();

        let printed = format!("{config:?}");

        assert!(printed.contains("API_KEY"), "{printed}");
        assert!(!printed.contains("sk-live-never-printed"), "{printed}");
    }

    #[test]
    fn remote_credentials_debug_print_leaves_out_the_token_and_the_header_values() {
        let vault = Arc::new(MemoryVault::default());
        vault.set(
            "oauth:docs",
            json!({"access_token": "bearer-never-printed"}),
        );
        let ports = Ports {
            vault: vault.clone() as Arc<dyn Vault>,
            provisioner: Arc::new(NoPackages),
            clock: Arc::new(Zero),
        };
        let credentials = RemoteCredentials::new(
            Offline,
            ports,
            Arc::new(Nothing),
            "docs",
            "https://tools.example/mcp",
            vec![("x-api-key".to_owned(), "key-never-printed".to_owned())],
        );

        let printed = format!("{credentials:?}");

        assert!(printed.contains("x-api-key"), "{printed}");
        assert!(!printed.contains("bearer-never-printed"), "{printed}");
        assert!(!printed.contains("key-never-printed"), "{printed}");
    }
}
