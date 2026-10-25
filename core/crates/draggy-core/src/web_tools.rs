//! `search_web` and `read_url`, the model's two web tools. Search runs the provider chain of the web crate; a page read
//! checks the URL policy on the address and on every redirect hop. The turn thread blocks on a runtime handle, so this
//! must never run on that runtime's own threads.

use std::collections::HashMap;
use std::time::Duration;

use draggy_agent::agent_loop::{ToolContext, ToolRuntime};
use draggy_agent::permissions::ToolAnnotations;
use draggy_agent::resume::{SearchResult as StepResult, SearchStep};
use draggy_agent::tool_channel::{FunctionDefinition, ToolDefinition};
use draggy_web::http::{ReqwestClient, decode_page};
use draggy_web::page::page_text;
use draggy_web::policy::{UrlPolicy, refusal_for};
use draggy_web::search::{DESKTOP_USER_AGENT, Search, SearchConfig, Status, SystemClock};
use serde_json::{Value, json};
use tokio::runtime::Handle;

/// How many failed searches a reply may have before search is switched off for it.
const SEARCH_FAILURE_BUDGET: u32 = 2;
/// How many results the model reads.
const RESULT_LIMIT: usize = 8;
/// The longest page text handed back, in lines.
const PAGE_LINE_LIMIT: usize = 500;
/// The most bytes of a page that are read.
const PAGE_BYTE_LIMIT: usize = 4 * 1024 * 1024;
const PAGE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REDIRECTS: usize = 20;

/// The tool definitions a session offers when the web is on.
pub fn definitions() -> Vec<ToolDefinition> {
    vec![
        definition(
            "search_web",
            "Search the web and return a list of results with titles, URLs and snippets.",
            &json!({
                "type": "object",
                "properties": {"query": {"type": "string", "description": "The search query."}},
                "required": ["query"]
            }),
        ),
        definition(
            "read_url",
            "Read the readable text content of a web page.",
            &json!({
                "type": "object",
                "properties": {"url": {"type": "string", "description": "Absolute URL of the page to read."}},
                "required": ["url"]
            }),
        ),
    ]
}

fn definition(name: &str, description: &str, parameters: &Value) -> ToolDefinition {
    ToolDefinition {
        kind: "function".to_owned(),
        function: FunctionDefinition {
            name: name.to_owned(),
            description: description.to_owned(),
            parameters: parameters.clone(),
        },
    }
}

/// Whether `name` is one of the web tools.
pub fn owns(name: &str) -> bool {
    matches!(name, "search_web" | "read_url")
}

pub struct WebTools {
    handle: Handle,
    config: SearchConfig,
    search: Search<ReqwestClient, SystemClock>,
    pages: Option<reqwest::Client>,
    asked: HashMap<String, String>,
    failures: u32,
}

impl WebTools {
    pub fn new(handle: Handle, config: SearchConfig) -> Result<Self, String> {
        let http = ReqwestClient::new().map_err(|error| error.to_string())?;
        Ok(Self {
            handle,
            config,
            search: Search::new(http, SystemClock),
            pages: page_client(),
            asked: HashMap::new(),
            failures: 0,
        })
    }

    fn search_web(&mut self, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        let query = args
            .get("query")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let key = normalise(&query);
        if let Some(repeat) = self.asked.get(&key) {
            return format!(
                "TOOL RESULT (search_web): You already searched for \"{query}\" in this turn. Here is what it returned, unchanged:\n{repeat}\n\nDo not search for this again. Use what you have, or read one of the URLs."
            );
        }
        if self.failures >= SEARCH_FAILURE_BUDGET {
            return "TOOL RESULT (search_web): Web search is not answering right now, so it has been switched off for this reply. Do not call search_web again. Answer from your own knowledge and say plainly which parts you could not check.".to_owned();
        }
        let id = ctx.new_id();
        ctx.steps.push(SearchStep {
            id: Some(id.clone()),
            kind: "searching".to_owned(),
            content: Some(format!("Searching for **{query}**")),
            is_complete: Some(false),
            ..SearchStep::default()
        });
        let outcome = self.handle.block_on(self.search.run(&query, &self.config));
        if outcome.results.is_empty() {
            self.failures += 1;
            patch(ctx, &id, "error", None);
            let remaining = SEARCH_FAILURE_BUDGET.saturating_sub(self.failures);
            if outcome.status == Status::Unavailable {
                let tried: Vec<&str> = outcome.tried.iter().map(|p| p.id()).collect();
                let tried = if tried.is_empty() {
                    "none".to_owned()
                } else {
                    tried.join(", ")
                };
                let tail = if remaining > 0 {
                    " Do not reword the question; if you retry at all, wait for a different question."
                } else {
                    " Answer from your own knowledge and say which parts you could not check."
                };
                return format!(
                    "TOOL RESULT (search_web): No search engine would answer just now (tried {tried}). This is a temporary outage, not a sign that nothing exists on the subject.{tail}"
                );
            }
            let tail = if remaining > 0 {
                " Try one clearly different query, using fewer and more common words."
            } else {
                " Stop searching and answer from your own knowledge."
            };
            return format!("TOOL RESULT (search_web): No results for \"{query}\".{tail}");
        }
        self.failures = 0;
        patch(
            ctx,
            &id,
            "searching",
            Some(format!("Searched for **{query}**")),
        );
        let results_id = ctx.new_id();
        ctx.steps.push(SearchStep {
            id: Some(results_id),
            kind: "results".to_owned(),
            content: Some(format!("Results for **{query}**")),
            is_complete: Some(true),
            results: Some(
                outcome
                    .results
                    .iter()
                    .map(|r| StepResult {
                        title: r.title.clone(),
                        url: r.url.clone(),
                        ..StepResult::default()
                    })
                    .collect(),
            ),
            ..SearchStep::default()
        });
        let summary = outcome
            .results
            .iter()
            .take(RESULT_LIMIT)
            .enumerate()
            .map(|(index, r)| {
                format!(
                    "[Result #{}] {}\nURL: {}\nSnippet: {}",
                    index + 1,
                    r.title,
                    r.url,
                    r.snippet
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        self.asked.insert(key, summary.clone());
        format!(
            "TOOL RESULT (search_web):\n{summary}\n\nRead the most relevant URL(s) with read_url when you need the full text. If you already have enough to answer, stop calling tools and reply."
        )
    }

    fn read_url(&mut self, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        let url = args
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let id = ctx.new_id();
        ctx.steps.push(SearchStep {
            id: Some(id.clone()),
            kind: "reading".to_owned(),
            content: Some(format!("Reading **{url}**")),
            is_complete: Some(false),
            ..SearchStep::default()
        });
        if !UrlPolicy::new().is_fetchable_url(&url, false) {
            patch(ctx, &id, "error", None);
            return format!("TOOL RESULT (read_url): {}", refusal_for(&url));
        }
        let Some(client) = self.pages.clone() else {
            patch(ctx, &id, "error", None);
            return "TOOL RESULT (read_url): Failed to read URL.".to_owned();
        };
        let fetched = self.handle.block_on(fetch(&client, &url));
        let html = match fetched {
            Ok(html) => html,
            Err(Fetch::Refused) => {
                patch(ctx, &id, "error", None);
                return format!("TOOL RESULT (read_url): {}", refusal_for(&url));
            }
            Err(Fetch::Failed) => {
                patch(ctx, &id, "error", None);
                return "TOOL RESULT (read_url): Failed to read URL.".to_owned();
            }
        };
        let (title, text) = page_text(&html);
        if is_challenge(&title, &text) {
            patch(ctx, &id, "error", None);
            return format!(
                "TOOL RESULT (read_url): This page is behind a human-verification challenge (such as Cloudflare) and cannot be read automatically. Do not retry this URL or try to work around the check. Tell the user the page needs them to open it and pass the check themselves, and give them the link: {url}"
            );
        }
        patch(ctx, &id, "reading", Some(format!("Read **{url}**")));
        let lines: Vec<&str> = text.lines().take(PAGE_LINE_LIMIT).collect();
        format!(
            "TOOL RESULT (read_url):\nTitle: {title}\nContent:\n{}",
            lines.join("\n")
        )
    }
}

impl ToolRuntime for WebTools {
    fn annotations(&self, name: &str) -> ToolAnnotations {
        if owns(name) {
            ToolAnnotations {
                read_only: true,
                idempotent: true,
                open_world: true,
                ..ToolAnnotations::default()
            }
        } else {
            ToolAnnotations::default()
        }
    }

    fn run(&mut self, name: &str, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        match name {
            "search_web" => self.search_web(args, ctx),
            "read_url" => self.read_url(args, ctx),
            other => format!("TOOL ERROR: There is no tool called \"{other}\"."),
        }
    }
}

enum Fetch {
    Refused,
    Failed,
}

/// A client that checks the URL policy on every redirect hop, so a public page cannot bounce the app to a local address.
fn page_client() -> Option<reqwest::Client> {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("too many redirects");
        }
        if UrlPolicy::new().is_fetchable_url(attempt.url().as_str(), false) {
            attempt.follow()
        } else {
            attempt.error("redirect refused")
        }
    });
    reqwest::Client::builder()
        .redirect(policy)
        .user_agent(DESKTOP_USER_AGENT)
        .timeout(PAGE_TIMEOUT)
        .build()
        .ok()
}

async fn fetch(client: &reqwest::Client, url: &str) -> Result<String, Fetch> {
    let response = client.get(url).send().await.map_err(|error| {
        if error.is_redirect() {
            Fetch::Refused
        } else {
            Fetch::Failed
        }
    })?;
    if !response.status().is_success() {
        return Err(Fetch::Failed);
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let bytes = response.bytes().await.map_err(|_| Fetch::Failed)?;
    let capped = &bytes[..bytes.len().min(PAGE_BYTE_LIMIT)];
    Ok(decode_page(capped, content_type.as_deref()))
}

fn is_challenge(title: &str, text: &str) -> bool {
    let title = title.to_lowercase();
    let head: String = text.chars().take(600).collect::<String>().to_lowercase();
    title.contains("just a moment")
        || title.contains("attention required")
        || head.contains("verify you are human")
        || head.contains("checking your browser")
}

fn normalise(query: &str) -> String {
    let lowered: String = query
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == ' ' {
                c
            } else {
                ' '
            }
        })
        .collect();
    lowered.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn patch(ctx: &mut ToolContext<'_>, id: &str, kind: &str, content: Option<String>) {
    if let Some(step) = ctx.steps.iter_mut().find(|s| s.id.as_deref() == Some(id)) {
        step.kind = kind.to_owned();
        step.is_complete = Some(true);
        if content.is_some() {
            step.content = content;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owns_only_the_two_web_tools() {
        assert!(owns("search_web") && owns("read_url"));
        assert!(!owns("read_file"));
    }

    #[test]
    fn definitions_name_both_tools() {
        let names: Vec<String> = definitions().into_iter().map(|d| d.function.name).collect();
        assert_eq!(names, ["search_web", "read_url"]);
    }

    #[test]
    fn repeated_queries_match_after_normalising() {
        assert_eq!(normalise("  Rust, async!  "), normalise("rust async"));
    }

    #[test]
    fn spots_a_verification_page() {
        assert!(is_challenge("Just a moment...", ""));
        assert!(is_challenge("", "Please Verify you are human"));
        assert!(!is_challenge("Docs", "Hello"));
    }
}
