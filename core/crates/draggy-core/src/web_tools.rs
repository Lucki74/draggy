//! `search_web` and `read_url`, the model's two web tools. Search runs the provider chain of the web crate; a page read
//! checks the URL policy on the address and on every redirect hop. The turn thread blocks on a runtime handle, so this
//! must never run on that runtime's own threads.

use std::collections::HashMap;

use draggy_agent::agent_loop::{ToolContext, ToolRuntime};
use draggy_agent::permissions::ToolAnnotations;
use draggy_agent::resume::{SearchResult as StepResult, SearchStep};
use draggy_agent::tool_channel::{FunctionDefinition, ToolDefinition};
use draggy_web::http::ReqwestClient;
use draggy_web::page::{BlockKind, PageCache, PageRead, ReadOutcome, ReqwestPageSource, read_page};
use draggy_web::search::{
    Search, SearchConfig, Status, SystemClock, domain_of,
};
use serde_json::{Value, json};
use tokio::runtime::Handle;

use crate::research::receipts::apply_receipts;
use crate::research::run::{
    ResearchRun, RunStatus, SourceInput, SourceStatus, add_source, loop_limit_for, record_host, render_run_state, tick,
};
use crate::research::tools::{self as research_tools, ResearchLibrary};
use draggy_agent::agent_loop::WireMessage;

/// How many failed searches a reply may have before search is switched off for it.
const SEARCH_FAILURE_BUDGET: u32 = 3;
/// How many results the model reads.
const RESULT_LIMIT: usize = 8;
/// The most characters of a read page kept for checking quotes against it.
const PAGE_KEEP: usize = 200_000;

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
            "Read a web page or PDF as Markdown. Long pages come in parts: pass page to read the next one.",
            &json!({
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Absolute URL of the page to read."},
                    "page": {"type": "integer", "description": "Optional 1-based part of a long page. Default 1."}
                },
                "required": ["url"]
            }),
        ),
    ]
    .into_iter()
    .chain(research_tools::definitions())
    .collect()
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
    matches!(name, "search_web" | "read_url") || research_tools::NAMES.contains(&name)
}

pub struct WebTools {
    handle: Handle,
    config: SearchConfig,
    search: Search<ReqwestClient, SystemClock>,
    pages: Option<ReqwestPageSource>,
    cache: PageCache,
    pub(crate) research: Option<ResearchRun>,
    pub(crate) library: Option<ResearchLibrary>,
    pub(crate) page_texts: HashMap<String, String>,
    asked: HashMap<String, String>,
    failures: u32,
}

impl WebTools {
    /// Starts or ends a research run, whose budget and sources read_url then tracks.
    pub fn set_research(&mut self, run: Option<ResearchRun>) {
        self.research = run;
    }

    pub fn research(&self) -> Option<&ResearchRun> {
        self.research.as_ref()
    }

    /// Kept page text by source id, for checking quotes.
    pub fn page_texts(&self) -> &HashMap<String, String> {
        &self.page_texts
    }

    pub fn new(handle: Handle, config: SearchConfig) -> Result<Self, String> {
        let http = ReqwestClient::new().map_err(|error| error.to_string())?;
        Ok(Self {
            handle,
            config,
            search: Search::new(http, SystemClock),
            pages: ReqwestPageSource::new(),
            cache: PageCache::new(),
            research: None,
            library: None,
            page_texts: HashMap::new(),
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
            let tried_ids = || {
                let tried: Vec<&str> = outcome.tried.iter().map(|p| p.id()).collect();
                if tried.is_empty() {
                    "none".to_owned()
                } else {
                    tried.join(", ")
                }
            };
            if outcome.status == Status::Blocked {
                let tail = if remaining > 0 {
                    " Retry later or rephrase the question once; do not conclude that nothing exists."
                } else {
                    " Answer from your own knowledge and say which parts you could not check."
                };
                return format!(
                    "TOOL RESULT (search_web): The search was blocked: the engines asked for a CAPTCHA or refused automated requests (tried {}). This is temporary and says nothing about whether the subject exists.{tail}",
                    tried_ids()
                );
            }
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
                    "[Result #{}] {}\nDomain: {}\nURL: {}\nSnippet: {}",
                    index + 1,
                    r.title,
                    domain_of(&r.url),
                    r.url,
                    r.snippet
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        self.asked.insert(key, summary.clone());
        let provider = outcome.provider.map_or("unknown", |p| p.id());
        format!(
            "TOOL RESULT (search_web, via {provider}):\n{summary}\n\nRead the most relevant URL(s) with read_url when you need the full text. If you already have enough to answer, stop calling tools and reply."
        )
    }

    /// Counts a gathering call. True when the run says stop, which the caller reports instead of working.
    pub(crate) fn spend_call(&mut self) -> bool {
        match self.research.as_mut() {
            Some(run) if run.status == RunStatus::Gathering => tick(run, now_ms()).is_some(),
            Some(run) => run.status == RunStatus::Writing,
            None => false,
        }
    }

    /// The run state as a tool-result footer, or nothing outside a run.
    pub(crate) fn run_footer(&self) -> String {
        self.research
            .as_ref()
            .map_or_else(String::new, |run| format!("\n\n{}", render_run_state(run, now_ms())))
    }

    fn record_reading(&mut self, url: &str) {
        if let Some(run) = self.research.as_mut() {
            record_host(run, url);
            add_source(
                run,
                SourceInput {
                    url,
                    status: Some(SourceStatus::Reading),
                    ..SourceInput::default()
                },
            );
        }
    }

    /// Records a page that was opened. Returns its source id, so read_url can tell the model what to cite.
    fn record_read(&mut self, url: &str, read: Option<&PageRead>) -> Option<String> {
        let run = self.research.as_mut()?;
        record_host(run, url);
        let source = add_source(
            run,
            SourceInput {
                url,
                title: read.map(|page| page.title.as_str()),
                site: read.and_then(|page| page.meta.site.as_deref()),
                published: read.and_then(|page| page.meta.published.as_deref()),
                status: Some(if read.is_some() {
                    SourceStatus::Read
                } else {
                    SourceStatus::Failed
                }),
            },
        );
        if let Some(page) = read.filter(|page| !page.text.is_empty()) {
            let kept: String = page.text.chars().take(PAGE_KEEP).collect();
            self.page_texts.insert(source.id.clone(), kept);
        }
        Some(source.id)
    }

    fn read_url(&mut self, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        let url = args
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let wanted = args
            .get("page")
            .and_then(|page| page.as_u64().or_else(|| page.as_str()?.trim().parse().ok()));
        if self.spend_call() {
            return format!(
                "TOOL RESULT (read_url): The research budget is spent. Stop gathering, call finish_research and write the report from your notes.{}",
                self.run_footer()
            );
        }
        let id = ctx.new_id();
        ctx.steps.push(SearchStep {
            id: Some(id.clone()),
            kind: "reading".to_owned(),
            content: Some(format!("Reading **{url}**")),
            is_complete: Some(false),
            ..SearchStep::default()
        });
        self.record_reading(&url);
        let Some(source) = self.pages.clone() else {
            self.record_read(&url, None);
            patch(ctx, &id, "error", None);
            return "TOOL RESULT (read_url): Failed to read URL.".to_owned();
        };
        let outcome = self.handle.block_on(read_page(
            &mut self.cache,
            &source,
            &url,
            wanted,
            now_ms(),
            &read_pdf,
        ));
        let read = match outcome {
            ReadOutcome::Blocked(blocked) => {
                self.record_read(&url, None);
                patch(ctx, &id, "error", None);
                return match blocked.kind {
                    BlockKind::HumanVerification => format!(
                        "TOOL RESULT (read_url): This page is behind a human-verification challenge (such as Cloudflare) and cannot be read automatically. Do not retry this URL or try to work around the check. Tell the user the page needs them to open it and pass the check themselves, and give them the link: {url}"
                    ),
                    BlockKind::Refused | BlockKind::Unreachable => {
                        format!("TOOL RESULT (read_url): {}", blocked.reason)
                    }
                };
            }
            ReadOutcome::Page(read) => read,
        };
        patch(ctx, &id, "reading", Some(format!("Read **{url}**")));
        let cite = self.record_read(&url, Some(&read)).map_or_else(String::new, |id| {
            format!("Source id: {id}. Record what it says with add_note and this id.\n")
        });
        let meta = &read.meta;
        let facts: Vec<String> = [
            meta.site.as_ref().map(|site| format!("Site: {site}")),
            meta.author.as_ref().map(|author| format!("Author: {author}")),
            meta.published.as_ref().map(|date| format!("Published: {date}")),
            meta.modified.as_ref().map(|date| format!("Modified: {date}")),
            meta.language.as_ref().map(|language| format!("Language: {language}")),
            Some(&read.canonical_url)
                .filter(|canonical| **canonical != url)
                .map(|canonical| format!("Canonical: {canonical}")),
            Some(read.page_note.clone()).filter(|note| !note.is_empty()),
        ]
        .into_iter()
        .flatten()
        .collect();
        let facts = if facts.is_empty() {
            String::new()
        } else {
            format!("{}\n", facts.join("\n"))
        };
        format!(
            "TOOL RESULT (read_url):\n{cite}Title: {}\n{facts}Content:\n{}{}",
            read.title,
            read.text,
            self.run_footer()
        )
    }
}

impl ToolRuntime for WebTools {
    fn annotations(&self, name: &str) -> ToolAnnotations {
        if owns(name) {
            ToolAnnotations {
                read_only: true,
                idempotent: !research_tools::NAMES.contains(&name),
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
            other if research_tools::NAMES.contains(&other) => self.run_research(other, args, ctx),
            other => format!("TOOL ERROR: There is no tool called \"{other}\"."),
        }
    }

    fn prepare_wire(&mut self, wire: &mut [WireMessage]) {
        if let Some(run) = self.research.as_ref() {
            apply_receipts(wire, run);
        }
    }

    fn loop_limit(&self, base: usize) -> usize {
        loop_limit_for(self.research.as_ref(), base)
    }
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn read_pdf(bytes: &[u8]) -> Result<String, String> {
    draggy_documents::office_pdf::read_pdf(bytes).map_err(|error| error.to_string())
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
    fn owns_the_web_and_research_tools() {
        assert!(owns("search_web") && owns("read_url") && owns("add_note"));
        assert!(!owns("read_file"));
    }

    #[test]
    fn definitions_name_the_web_and_research_tools() {
        let names: Vec<String> = definitions().into_iter().map(|d| d.function.name).collect();
        assert_eq!(
            names,
            ["search_web", "read_url", "start_research", "add_note", "search_notes", "finish_research"]
        );
    }

    #[test]
    fn repeated_queries_match_after_normalising() {
        assert_eq!(normalise("  Rust, async!  "), normalise("rust async"));
    }
}
