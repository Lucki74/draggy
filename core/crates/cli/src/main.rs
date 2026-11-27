//! `draggy run`: one prompt in, one streamed answer out, against any provider in the bundled catalog.
//!
//! This is a plain completion. The agent loop in `draggy-agent` is a set of traits with no transport, tool runtime
//! or approval host behind them in the core, so the CLI cannot run tools, edit files or ask for permission yet.

use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::process::ExitCode;
use std::time::Duration;

use draggy_providers::adapters::common::{Connection, Stream};
use draggy_providers::adapters::{anthropic, gemini, ollama, openai};
use draggy_providers::catalog::{Catalog, CatalogEntry};
use draggy_providers::errors::from_response_text;
use draggy_providers::http::{HttpRequest, Method};
use draggy_providers::types::{
    ChatMessage, ChatRequest, Content, ErrorKind, FinishReason, ProviderError, StreamEvent, Usage,
};
use serde_json::{Value, json};

const USAGE: &str = "Usage: draggy run [options] [prompt]

Sends one prompt to a model and prints the answer. Use `-` as the prompt to read it from stdin.

Options:
  -p, --provider <id>    Catalog provider id (default: ollama)
  -m, --model <id>       Model id (or set DRAGGY_MODEL)
      --base-url <url>   Override the provider's address (needed for `custom`)
      --system <text>    System prompt
      --max-tokens <n>   Limit the answer length
      --temperature <x>  Sampling temperature, 0 to 2
      --timeout <secs>   Give up after this long (default: 600)
      --json             Print one JSON object instead of streaming text
  -h, --help             Show this help
  -V, --version          Show the version

The key comes from DRAGGY_API_KEY, or <PROVIDER>_API_KEY such as OPENAI_API_KEY. Keys saved in the app are not read.

Exit codes: 0 done, 1 provider or network failure, 2 usage, 3 stopped early (length limit or tool call).";

const DEFAULT_PROVIDER: &str = "ollama";
const DEFAULT_TIMEOUT_SECS: u64 = 600;

#[derive(Debug, PartialEq)]
enum Command {
    Help,
    Version,
    Run(Box<RunOptions>),
}

#[derive(Debug, PartialEq)]
struct RunOptions {
    provider: String,
    model: String,
    base_url: Option<String>,
    system: Option<String>,
    max_tokens: Option<i64>,
    temperature: Option<f64>,
    timeout_secs: u64,
    json: bool,
    prompt: String,
}

fn value_of<'a>(flag: &str, args: &'a [String], index: &mut usize) -> Result<&'a str, String> {
    *index += 1;
    args.get(*index)
        .map(String::as_str)
        .ok_or_else(|| format!("{flag} needs a value"))
}

/// Reads the arguments after the program name. `stdin` runs only when the prompt is `-`.
fn parse_args(
    args: &[String],
    env: &dyn Fn(&str) -> Option<String>,
    stdin: &mut dyn FnMut() -> io::Result<String>,
) -> Result<Command, String> {
    match args.first().map(String::as_str) {
        Some("-h" | "--help" | "help") => return Ok(Command::Help),
        Some("-V" | "--version") => return Ok(Command::Version),
        Some("run") => {}
        Some(other) => return Err(format!("Unknown command `{other}`. Try `draggy run`.")),
        None => return Err("Missing command. Try `draggy run \"your prompt\"`.".to_owned()),
    }

    let mut provider = None;
    let mut model = None;
    let mut base_url = None;
    let mut system = None;
    let mut max_tokens = None;
    let mut temperature = None;
    let mut timeout_secs = DEFAULT_TIMEOUT_SECS;
    let mut json = false;
    let mut words: Vec<&str> = Vec::new();
    let mut from_stdin = false;
    let mut options_done = false;

    let mut index = 1;
    while index < args.len() {
        let arg = args[index].as_str();
        if options_done || !arg.starts_with('-') || arg == "-" {
            if arg == "-" && !options_done {
                from_stdin = true;
            } else {
                words.push(arg);
            }
        } else {
            match arg {
                "--" => options_done = true,
                "-h" | "--help" => return Ok(Command::Help),
                "-V" | "--version" => return Ok(Command::Version),
                "--json" => json = true,
                "-p" | "--provider" => provider = Some(value_of(arg, args, &mut index)?.to_owned()),
                "-m" | "--model" => model = Some(value_of(arg, args, &mut index)?.to_owned()),
                "--base-url" => base_url = Some(value_of(arg, args, &mut index)?.to_owned()),
                "--system" => system = Some(value_of(arg, args, &mut index)?.to_owned()),
                "--max-tokens" => {
                    let text = value_of(arg, args, &mut index)?;
                    match text.parse::<i64>() {
                        Ok(count) if count > 0 => max_tokens = Some(count),
                        _ => {
                            return Err(format!(
                                "--max-tokens must be a positive whole number, not `{text}`"
                            ));
                        }
                    }
                }
                "--temperature" => {
                    let text = value_of(arg, args, &mut index)?;
                    match text.parse::<f64>() {
                        Ok(value) if (0.0..=2.0).contains(&value) => temperature = Some(value),
                        _ => {
                            return Err(format!(
                                "--temperature must be between 0 and 2, not `{text}`"
                            ));
                        }
                    }
                }
                "--timeout" => {
                    let text = value_of(arg, args, &mut index)?;
                    match text.parse::<u64>() {
                        Ok(secs) if secs > 0 => timeout_secs = secs,
                        _ => {
                            return Err(format!(
                                "--timeout must be a positive number of seconds, not `{text}`"
                            ));
                        }
                    }
                }
                "--allow-commands" => {
                    return Err(
                        "--allow-commands is not available: the CLI runs no tools.".to_owned()
                    );
                }
                _ => return Err(format!("Unknown option `{arg}`.")),
            }
        }
        index += 1;
    }

    if from_stdin && !words.is_empty() {
        return Err("Give the prompt as words or as `-`, not both.".to_owned());
    }
    let prompt = if from_stdin {
        stdin().map_err(|error| format!("Could not read stdin: {error}"))?
    } else {
        words.join(" ")
    };
    if prompt.trim().is_empty() {
        return Err("The prompt is empty. Pass it as words, or use `-` to read stdin.".to_owned());
    }

    let model = model
        .or_else(|| env("DRAGGY_MODEL").filter(|value| !value.trim().is_empty()))
        .ok_or("No model. Pass --model <id> or set DRAGGY_MODEL.")?;

    Ok(Command::Run(Box::new(RunOptions {
        provider: provider.unwrap_or_else(|| DEFAULT_PROVIDER.to_owned()),
        model,
        base_url,
        system,
        max_tokens,
        temperature,
        timeout_secs,
        json,
        prompt,
    })))
}

/// The environment variable that holds a provider's key, such as `OPENAI_API_KEY` or `OLLAMA_CLOUD_API_KEY`.
fn key_variable(provider: &str) -> String {
    let name: String = provider
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    format!("{name}_API_KEY")
}

struct Target {
    protocol: String,
    connection: Connection,
}

/// Where the request goes: the catalog entry, address and key.
fn resolve(
    options: &RunOptions,
    catalog: &Catalog,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<Target, String> {
    let entry: &CatalogEntry = catalog
        .find(&options.provider)
        .ok_or_else(|| format!("Unknown provider `{}`.", options.provider))?;
    if !matches!(
        entry.protocol.as_str(),
        "openai" | "anthropic" | "gemini" | "ollama"
    ) {
        return Err(format!(
            "`{}` signs in through the app, which the CLI cannot do. Use a provider with an API key.",
            entry.id
        ));
    }
    let base_url = options
        .base_url
        .clone()
        .unwrap_or_else(|| entry.base_url.clone());
    if base_url.is_empty() {
        return Err(format!(
            "`{}` has no default address. Pass --base-url.",
            entry.id
        ));
    }
    let non_empty =
        |value: Option<String>| value.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty());
    let api_key = non_empty(env("DRAGGY_API_KEY"))
        .or_else(|| non_empty(env(&key_variable(&entry.id))))
        .unwrap_or_default();
    let needs_key = entry.auth != "none" && entry.key_optional != Some(true);
    if needs_key && api_key.is_empty() {
        return Err(format!(
            "No API key for `{}`. Set DRAGGY_API_KEY or {}.",
            entry.id,
            key_variable(&entry.id)
        ));
    }
    Ok(Target {
        protocol: entry.protocol.clone(),
        connection: Connection {
            instance_id: Some(entry.id.clone()),
            base_url,
            api_key,
            headers: BTreeMap::new(),
            entry: Some(entry.clone()),
        },
    })
}

fn text_message(role: &str, text: &str) -> ChatMessage {
    ChatMessage {
        role: role.to_owned(),
        content: Some(Content::Text(text.to_owned())),
        tool_calls: Vec::new(),
        tool_call_id: None,
        tool_name: None,
        thinking: None,
        provider_state: None,
    }
}

fn build_request(options: &RunOptions, target: &Target) -> HttpRequest {
    let mut messages = Vec::new();
    if let Some(system) = &options.system {
        messages.push(text_message("system", system));
    }
    messages.push(text_message("user", &options.prompt));
    let request = ChatRequest {
        messages,
        stream: true,
        max_tokens: options.max_tokens,
        temperature: options.temperature,
        ..ChatRequest::default()
    };
    let conn = &target.connection;
    let mut http = match target.protocol.as_str() {
        "anthropic" => anthropic::build_request(&request, conn, &options.model),
        "gemini" => gemini::build_request(&request, conn, &options.model),
        "ollama" => ollama::build_request(&request, conn, &options.model),
        _ => openai::build_request(&request, conn, &options.model),
    };
    http.timeout_ms = Some(options.timeout_secs.saturating_mul(1000));
    http
}

type OnText<'a> = &'a mut dyn FnMut(&str) -> io::Result<()>;

/// What one answer came to.
#[derive(Debug, Default, PartialEq)]
struct Outcome {
    text: String,
    finish: Option<FinishReason>,
    usage: Usage,
    error: Option<ProviderError>,
}

impl Outcome {
    /// Folds events in. Text goes to `on_text` as it arrives.
    fn apply(&mut self, events: Vec<StreamEvent>, on_text: OnText<'_>) -> io::Result<()> {
        for event in events {
            match event {
                StreamEvent::TextDelta { text } => {
                    on_text(&text)?;
                    self.text.push_str(&text);
                }
                StreamEvent::Finish { reason, usage } => {
                    self.finish = Some(reason);
                    self.usage = usage;
                }
                StreamEvent::Error { error } => {
                    if self.error.is_none() {
                        self.error = Some(error);
                    }
                }
                StreamEvent::ReasoningDelta { .. }
                | StreamEvent::ToolCallDelta { .. }
                | StreamEvent::ProviderState { .. } => {}
            }
        }
        Ok(())
    }

    fn exit_code(&self) -> u8 {
        if self.error.is_some() {
            return 1;
        }
        match self.finish {
            Some(FinishReason::Stop) => 0,
            Some(FinishReason::Length | FinishReason::ToolCalls) => 3,
            None => 1,
        }
    }

    /// Why the run did not finish, for stderr. `None` when it did.
    fn problem(&self) -> Option<String> {
        if let Some(error) = &self.error {
            return Some(error.to_string());
        }
        match self.finish {
            Some(FinishReason::Stop) => None,
            Some(FinishReason::Length) => {
                Some("Stopped: the answer hit the length limit.".to_owned())
            }
            Some(FinishReason::ToolCalls) => Some(
                "Stopped: the model asked to call a tool, which the CLI cannot run.".to_owned(),
            ),
            None => Some("The answer ended without a finish.".to_owned()),
        }
    }

    fn to_json(&self, options: &RunOptions) -> Value {
        let status = match self.exit_code() {
            0 => "done",
            3 => "stopped",
            _ => "failed",
        };
        json!({
            "status": status,
            "provider": options.provider,
            "model": options.model,
            "text": self.text,
            "finish": self.finish.map(|reason| match reason {
                FinishReason::Stop => "stop",
                FinishReason::Length => "length",
                FinishReason::ToolCalls => "tool_calls",
            }),
            "usage": {
                "promptTokens": self.usage.prompt_tokens,
                "outputTokens": self.usage.output_tokens,
            },
            "error": self.problem().filter(|_| self.exit_code() == 1),
        })
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

enum Decoding {
    OpenAi(Stream<openai::OpenAiDecoder>),
    Anthropic(Stream<anthropic::AnthropicDecoder>),
    Gemini(Stream<gemini::GeminiDecoder>),
    Ollama(Stream<ollama::OllamaDecoder>),
}

impl Decoding {
    fn new(protocol: &str, instance: &str) -> Self {
        match protocol {
            "anthropic" => Self::Anthropic(anthropic::stream(Some(instance))),
            "gemini" => Self::Gemini(gemini::stream(Some(instance))),
            "ollama" => Self::Ollama(ollama::stream()),
            _ => Self::OpenAi(openai::stream()),
        }
    }

    fn push(&mut self, bytes: &[u8]) -> Vec<StreamEvent> {
        match self {
            Self::OpenAi(s) => s.push(bytes),
            Self::Anthropic(s) => s.push(bytes),
            Self::Gemini(s) => s.push(bytes),
            Self::Ollama(s) => s.push(bytes),
        }
    }

    fn finish(&mut self) -> Vec<StreamEvent> {
        match self {
            Self::OpenAi(s) => s.finish(),
            Self::Anthropic(s) => s.finish(),
            Self::Gemini(s) => s.finish(),
            Self::Ollama(s) => s.finish(),
        }
    }
}

/// Reads an answer's bytes through the protocol's decoder.
fn read_answer(
    protocol: &str,
    instance: &str,
    body: &mut dyn Read,
    on_text: OnText<'_>,
) -> io::Result<Outcome> {
    let mut decoding = Decoding::new(protocol, instance);
    let mut outcome = Outcome::default();
    let mut buffer = [0u8; 8192];
    loop {
        let read = body.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        outcome.apply(decoding.push(&buffer[..read]), on_text)?;
    }
    outcome.apply(decoding.finish(), on_text)?;
    Ok(outcome)
}

fn failure(message: impl Into<String>) -> Outcome {
    Outcome {
        error: Some(ProviderError {
            kind: ErrorKind::UnknownError,
            status: None,
            message: Some(message.into()),
            provider_message: None,
            retry_after: None,
        }),
        ..Outcome::default()
    }
}

/// Sends the request and reads the answer. Network and status failures come back as an outcome with an error.
fn send(options: &RunOptions, target: &Target, on_text: OnText<'_>) -> io::Result<Outcome> {
    let request = build_request(options, target);
    let client = match reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(options.timeout_secs))
        .build()
    {
        Ok(client) => client,
        Err(error) => return Ok(failure(format!("Could not start the HTTP client: {error}"))),
    };
    let mut call = match request.method {
        Method::Get => client.get(&request.url),
        Method::Post => client.post(&request.url),
    };
    for (name, value) in &request.headers {
        call = call.header(name, value);
    }
    if let Some(body) = request.body.clone() {
        call = call.body(body);
    }
    let mut response = match call.send() {
        Ok(response) => response,
        Err(error) => {
            let reason = if error.is_timeout() {
                "the request timed out".to_owned()
            } else {
                error.to_string()
            };
            return Ok(failure(format!(
                "Could not reach {}: {reason}",
                target.connection.base_url
            )));
        }
    };
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                Some((name.as_str().to_owned(), value.to_str().ok()?.to_owned()))
            })
            .collect();
        let mut text = String::new();
        let _ = response.read_to_string(&mut text);
        return Ok(Outcome {
            error: Some(from_response_text(status, &text, &headers, now_ms())),
            ..Outcome::default()
        });
    }
    let instance = target.connection.instance_id.clone().unwrap_or_default();
    match read_answer(&target.protocol, &instance, &mut response, on_text) {
        Ok(outcome) => Ok(outcome),
        Err(error) if error.kind() == io::ErrorKind::BrokenPipe => Err(error),
        Err(error) => Ok(failure(format!("The connection broke mid-answer: {error}"))),
    }
}

fn run(options: &RunOptions) -> u8 {
    let env = |name: &str| std::env::var(name).ok();
    let target = match resolve(options, &Catalog::bundled(), &env) {
        Ok(target) => target,
        Err(message) => {
            eprintln!("draggy: {message}");
            return 2;
        }
    };
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let streaming = !options.json;
    let outcome = {
        let mut on_text = |text: &str| -> io::Result<()> {
            if streaming {
                out.write_all(text.as_bytes())?;
                out.flush()?;
            }
            Ok(())
        };
        match send(options, &target, &mut on_text) {
            Ok(outcome) => outcome,
            Err(error) => {
                eprintln!("draggy: could not write the answer: {error}");
                return 1;
            }
        }
    };
    let written = if streaming {
        if outcome.text.is_empty() || outcome.text.ends_with('\n') {
            Ok(())
        } else {
            writeln!(out)
        }
    } else {
        writeln!(out, "{}", outcome.to_json(options))
    };
    if written.is_err() {
        return 1;
    }
    if streaming && let Some(problem) = outcome.problem() {
        eprintln!("draggy: {problem}");
    }
    outcome.exit_code()
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let env = |name: &str| std::env::var(name).ok();
    let mut read_stdin = || {
        let mut text = String::new();
        io::stdin().read_to_string(&mut text)?;
        Ok(text)
    };
    match parse_args(&args, &env, &mut read_stdin) {
        Ok(Command::Help) => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Ok(Command::Version) => {
            println!("draggy {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Ok(Command::Run(options)) => ExitCode::from(run(&options)),
        Err(message) => {
            eprintln!("draggy: {message}\n\n{USAGE}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| (*arg).to_owned()).collect()
    }

    fn no_env(_: &str) -> Option<String> {
        None
    }

    fn parse(args: &[&str]) -> Result<Command, String> {
        parse_args(&strings(args), &no_env, &mut || {
            Ok("from stdin\n".to_owned())
        })
    }

    fn options(args: &[&str]) -> RunOptions {
        match parse(args) {
            Ok(Command::Run(options)) => *options,
            other => panic!("expected a run, got {other:?}"),
        }
    }

    fn drain(outcome: &mut Outcome, events: Vec<StreamEvent>) -> String {
        let mut printed = String::new();
        outcome
            .apply(events, &mut |text| {
                printed.push_str(text);
                Ok(())
            })
            .unwrap();
        printed
    }

    #[test]
    fn prompt_words_join_and_options_may_follow() {
        let parsed = options(&["run", "say", "hi", "-m", "qwen", "--json"]);
        assert_eq!(parsed.prompt, "say hi");
        assert_eq!(parsed.model, "qwen");
        assert_eq!(parsed.provider, "ollama");
        assert!(parsed.json);
    }

    #[test]
    fn model_falls_back_to_the_environment_and_is_required() {
        let env = |name: &str| (name == "DRAGGY_MODEL").then(|| "llama3".to_owned());
        let parsed = parse_args(&strings(&["run", "hi"]), &env, &mut || Ok(String::new()));
        assert!(matches!(parsed, Ok(Command::Run(ref o)) if o.model == "llama3"));
        assert!(parse(&["run", "hi"]).unwrap_err().contains("No model"));
    }

    #[test]
    fn dash_reads_stdin_and_double_dash_ends_options() {
        assert_eq!(options(&["run", "-m", "x", "-"]).prompt, "from stdin\n");
        assert_eq!(
            options(&["run", "-m", "x", "--", "--json"]).prompt,
            "--json"
        );
        assert!(parse(&["run", "-m", "x", "-", "extra"]).is_err());
    }

    #[test]
    fn empty_prompts_are_refused() {
        assert!(parse(&["run", "-m", "x"]).unwrap_err().contains("empty"));
        let blank = parse_args(&strings(&["run", "-m", "x", "-"]), &no_env, &mut || {
            Ok("  \n".to_owned())
        });
        assert!(blank.unwrap_err().contains("empty"));
    }

    #[test]
    fn bad_values_and_unknown_flags_are_usage_errors() {
        assert!(parse(&["run", "-m", "x", "--max-tokens", "0", "hi"]).is_err());
        assert!(parse(&["run", "-m", "x", "--temperature", "3", "hi"]).is_err());
        assert!(parse(&["run", "-m", "x", "--timeout", "abc", "hi"]).is_err());
        assert!(
            parse(&["run", "-m", "x", "--bogus", "hi"])
                .unwrap_err()
                .contains("--bogus")
        );
        assert!(
            parse(&["run", "-m", "x", "hi", "--model"])
                .unwrap_err()
                .contains("needs a value")
        );
        assert!(parse(&["run", "-m", "x", "--allow-commands", "hi"]).is_err());
        assert!(parse(&["frobnicate"]).is_err());
        assert!(parse(&[]).is_err());
    }

    #[test]
    fn help_and_version_win() {
        assert_eq!(parse(&["--help"]), Ok(Command::Help));
        assert_eq!(parse(&["run", "--version"]), Ok(Command::Version));
    }

    #[test]
    fn keys_come_from_the_environment() {
        assert_eq!(key_variable("ollama-cloud"), "OLLAMA_CLOUD_API_KEY");
        let catalog = Catalog::bundled();
        let parsed = options(&["run", "-p", "openai", "-m", "gpt", "hi"]);
        let missing = resolve(&parsed, &catalog, &no_env).err().unwrap();
        assert!(missing.contains("OPENAI_API_KEY"));
        let env = |name: &str| (name == "OPENAI_API_KEY").then(|| " sk-test ".to_owned());
        let target = resolve(&parsed, &catalog, &env).ok().unwrap();
        assert_eq!(target.connection.api_key, "sk-test");
        let general = |name: &str| (name == "DRAGGY_API_KEY").then(|| "k".to_owned());
        assert_eq!(
            resolve(&parsed, &catalog, &general)
                .ok()
                .unwrap()
                .connection
                .api_key,
            "k"
        );
    }

    #[test]
    fn local_providers_need_no_key_and_account_providers_are_refused() {
        let catalog = Catalog::bundled();
        let local = options(&["run", "-m", "x", "hi"]);
        assert!(resolve(&local, &catalog, &no_env).is_ok());
        let account = options(&["run", "-p", "claude", "-m", "x", "hi"]);
        assert!(
            resolve(&account, &catalog, &no_env)
                .err()
                .unwrap()
                .contains("signs in through the app")
        );
        let unknown = options(&["run", "-p", "nope", "-m", "x", "hi"]);
        assert!(
            resolve(&unknown, &catalog, &no_env)
                .err()
                .unwrap()
                .contains("Unknown provider")
        );
        let custom = options(&["run", "-p", "custom", "-m", "x", "hi"]);
        assert!(
            resolve(&custom, &catalog, &no_env)
                .err()
                .unwrap()
                .contains("--base-url")
        );
    }

    #[test]
    fn the_request_targets_the_provider_with_the_prompt() {
        let catalog = Catalog::bundled();
        let parsed = options(&[
            "run", "-p", "openai", "-m", "gpt-x", "--system", "be brief", "hi",
        ]);
        let env = |name: &str| (name == "DRAGGY_API_KEY").then(|| "k".to_owned());
        let target = resolve(&parsed, &catalog, &env).ok().unwrap();
        let request = build_request(&parsed, &target);
        assert!(request.url.starts_with("https://api.openai.com/v1"));
        assert_eq!(
            request.headers.get("Authorization").map(String::as_str),
            Some("Bearer k")
        );
        let body: Value = serde_json::from_str(request.body.as_deref().unwrap()).unwrap();
        assert_eq!(body["model"], "gpt-x");
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"][0]["content"], "be brief");
        assert_eq!(body["messages"][1]["content"], "hi");
    }

    const SSE: &str = "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n\
        data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n\
        data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\n\
        data: [DONE]\n\n";

    #[test]
    fn an_openai_stream_prints_text_and_finishes() {
        let mut printed = String::new();
        let outcome = read_answer("openai", "openai", &mut SSE.as_bytes(), &mut |text| {
            printed.push_str(text);
            Ok(())
        })
        .unwrap();
        assert_eq!(printed, "Hello");
        assert_eq!(outcome.text, "Hello");
        assert_eq!(outcome.finish, Some(FinishReason::Stop));
        assert_eq!(outcome.usage.prompt_tokens, 3);
        assert_eq!(outcome.exit_code(), 0);
        assert!(outcome.problem().is_none());
    }

    #[test]
    fn an_error_in_the_stream_is_a_failure() {
        let bad = "data: {\"error\":{\"message\":\"overloaded\"}}

";
        let outcome =
            read_answer("openai", "openai", &mut bad.as_bytes(), &mut |_| Ok(())).unwrap();
        assert_eq!(outcome.exit_code(), 1);
        assert!(outcome.problem().unwrap().contains("overloaded"));
    }

    #[test]
    fn exit_codes_follow_the_finish() {
        let mut outcome = Outcome::default();
        drain(
            &mut outcome,
            vec![StreamEvent::Finish {
                reason: FinishReason::Length,
                usage: Usage::default(),
            }],
        );
        assert_eq!(outcome.exit_code(), 3);
        assert!(outcome.problem().unwrap().contains("length"));
        let mut tools = Outcome::default();
        drain(
            &mut tools,
            vec![StreamEvent::Finish {
                reason: FinishReason::ToolCalls,
                usage: Usage::default(),
            }],
        );
        assert_eq!(tools.exit_code(), 3);
        let failed = failure("boom");
        assert_eq!(failed.exit_code(), 1);
        assert!(failed.problem().unwrap().contains("boom"));
    }

    #[test]
    fn json_output_carries_status_text_and_usage() {
        let parsed = options(&["run", "-m", "x", "--json", "hi"]);
        let mut outcome = Outcome::default();
        let printed = drain(
            &mut outcome,
            vec![
                StreamEvent::TextDelta {
                    text: "ok".to_owned(),
                },
                StreamEvent::Finish {
                    reason: FinishReason::Stop,
                    usage: Usage {
                        prompt_tokens: 4,
                        output_tokens: 1,
                        tokens: None,
                    },
                },
            ],
        );
        assert_eq!(printed, "ok");
        let value = outcome.to_json(&parsed);
        assert_eq!(value["status"], "done");
        assert_eq!(value["text"], "ok");
        assert_eq!(value["finish"], "stop");
        assert_eq!(value["usage"]["promptTokens"], 4);
        assert!(value["error"].is_null());
        let failed = failure("down").to_json(&parsed);
        assert_eq!(failed["status"], "failed");
        assert!(failed["error"].as_str().unwrap().contains("down"));
    }
}
