//! The research tools: a plan, notes tied to read pages, a notes search and a checked finish.
//! Gathering itself goes through search_web and read_url, which feed the run held by `WebTools`.

use std::sync::Arc;

use draggy_agent::agent_loop::ToolContext;
use draggy_agent::tool_channel::{FunctionDefinition, ToolDefinition};
use draggy_storage::{NoteSave, RunSave, SourceSave, Storage};
use serde::Serialize;
use serde_json::{Value, json};

use super::citations::{Citable, CitationVerdict, verify_citations};
use super::run::{
    Depth, NoteInput, RawList, RunStatus, SourceStatus, StopReason, DEPTH_IDS, add_note, budget_of, coverage, create_run, depth_spec, finish, read_plan,
};
use crate::web_tools::{WebTools, now_ms};

/// The names of the research tools.
pub const NAMES: [&str; 4] = ["start_research", "add_note", "search_notes", "finish_research"];

/// Where finished runs are saved, and which chat a follow-up question finds them under.
#[derive(Clone)]
pub struct ResearchLibrary {
    pub storage: Arc<Storage>,
    pub workspace_id: Option<String>,
    pub chat_id: Option<String>,
}

fn definition(name: &str, description: &str, properties: &Value, required: &[&str]) -> ToolDefinition {
    ToolDefinition {
        kind: "function".to_owned(),
        function: FunctionDefinition {
            name: name.to_owned(),
            description: description.to_owned(),
            parameters: json!({"type": "object", "properties": properties, "required": required}),
        },
    }
}

pub fn definitions() -> Vec<ToolDefinition> {
    vec![
        definition(
            "start_research",
            "Start a research run for a question that needs several sources. Draft the sub-questions that together answer it; the user approves the plan before any search runs. Then search, read pages and record what you learn with add_note.",
            &json!({
                "question": {"type": "string", "description": "The question to research, in the user's words."},
                "sub_questions": {"type": "string", "description": "The sub-questions, one per line."},
                "depth": {"type": "string", "description": "How deep to go: quick, standard, deep."},
                "sources": {"type": "string", "description": "Where to look, comma separated: web, papers, wiki, code. Pass the same word as search_web's source parameter to search each one."}
            }),
            &["question", "sub_questions"],
        ),
        definition(
            "add_note",
            "Record one fact from a page you read during research, with the exact sentence that supports it. Only noted facts can be cited in the report.",
            &json!({
                "sub_question": {"type": "number", "description": "The number of the sub-question this answers."},
                "claim": {"type": "string", "description": "What you learned, in one sentence of your own."},
                "quote": {"type": "string", "description": "The exact sentence from the page, copied word for word."},
                "source_id": {"type": "string", "description": "The source id read_url gave, such as s1."},
                "confidence": {"type": "string", "description": "confirmed, single_source or disputed."}
            }),
            &["claim", "quote", "source_id"],
        ),
        definition(
            "search_notes",
            "Look through the notes of this research run by keyword before searching the web again.",
            &json!({"query": {"type": "string", "description": "Words to look for in the notes."}}),
            &["query"],
        ),
        definition(
            "finish_research",
            "End gathering and get the checked notes and sources to write the report from. Cite notes by id in square brackets, like [n1].",
            &json!({}),
            &[],
        ),
    ]
}

fn raw_list(value: Option<&Value>) -> RawList {
    match value {
        Some(Value::Array(items)) => RawList::Items(
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect(),
        ),
        Some(Value::String(text)) => RawList::Text(text.clone()),
        _ => RawList::Text(String::new()),
    }
}

fn text(args: &Value, key: &str) -> String {
    match args.get(key) {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

/// The id of a serde enum written as snake_case text.
fn id_of<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

impl WebTools {
    /// Where a finished run is saved. Without it a run lives only for the turn.
    pub fn set_library(&mut self, library: Option<ResearchLibrary>) {
        self.library = library;
    }

    /// The deepest plan a run may take; a deeper one is cut down to it.
    pub fn set_max_depth(&mut self, depth: Option<Depth>) {
        self.max_depth = depth;
    }

    pub(crate) fn run_research(&mut self, name: &str, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        match name {
            "start_research" => self.start_research(args, ctx),
            "add_note" => self.add_note_tool(args),
            "search_notes" => self.search_notes(args),
            _ => self.finish_research(),
        }
    }

    /// Shows the run to the shells as one `research_run` step whose content is the run view as JSON.
    /// The step id is the run id, so each call patches the same row.
    pub(crate) fn sync_run_step(&self, ctx: &mut ToolContext<'_>) {
        self.patch_run_step(ctx.steps);
    }

    /// Writes the current run view onto its step in `steps`, or adds the step.
    fn patch_run_step(&self, steps: &mut Vec<draggy_agent::resume::SearchStep>) {
        let Some(run) = self.research.as_ref() else {
            return;
        };
        let view = json!({
            "id": run.id,
            "question": run.plan.question,
            "depth": run.plan.depth.id(),
            "startedAt": run.started_at,
            "endedAt": run.ended_at,
            "wallMs": budget_of(run, now_ms()).wall_ms,
            "gathering": id_of(&run.status) == "gathering",
            "questions": coverage(run).iter().map(|c| json!({"text": c.text, "notes": c.notes})).collect::<Vec<_>>(),
            "sources": run.sources.iter().map(|s| json!({
                "id": s.id, "url": s.url, "title": s.title, "site": s.site,
                "published": s.published, "status": id_of(&s.status),
            })).collect::<Vec<_>>(),
            "notes": run.notes.iter().map(|n| json!({
                "id": n.id, "sourceId": n.source_id, "quote": n.quote, "verified": n.verified,
            })).collect::<Vec<_>>(),
            "hosts": run.contacted_hosts,
        })
        .to_string();
        let complete = Some(run.ended_at.is_some());
        if let Some(step) = steps.iter_mut().find(|s| s.kind == "research_run" && s.id.as_deref() == Some(&run.id)) {
            step.content = Some(view);
            step.is_complete = complete;
        } else {
            steps.push(draggy_agent::resume::SearchStep {
                id: Some(run.id.clone()),
                kind: "research_run".to_owned(),
                content: Some(view),
                is_complete: complete,
                ..Default::default()
            });
        }
    }

    fn start_research(&mut self, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        if self.research.is_some() {
            return format!(
                "TOOL RESULT (start_research): A research run is already going in this reply. Carry on with it.{}",
                self.run_footer()
            );
        }
        let depth = text(args, "depth");
        let plan = read_plan(
            &text(args, "question"),
            raw_list(args.get("sub_questions")),
            Some(depth.as_str()),
            raw_list(args.get("sources")),
        );
        let Some(plan) = plan else {
            return "TOOL RESULT (start_research): There was no question. Send the question to research.".to_owned();
        };
        let mut plan = plan;
        if let Some(max) = self.max_depth
            && DEPTH_IDS.iter().position(|d| *d == plan.depth) > DEPTH_IDS.iter().position(|d| *d == max)
        {
            plan.depth = max;
            plan.sub_questions.truncate(depth_spec(max).max_questions);
        }
        // The core has no approval card yet: the drafted plan stands as approved.
        let run = create_run(&ctx.new_id(), plan, now_ms());
        self.research = Some(run);
        self.page_texts.clear();
        format!(
            "TOOL RESULT (start_research): The plan is approved. Search for each sub-question, read the best pages with read_url, and after each useful page call add_note with the exact sentence it says.{}",
            self.run_footer()
        )
    }

    fn add_note_tool(&mut self, args: &Value) -> String {
        if self.research.is_none() {
            return "TOOL RESULT (add_note): There is no research run. Call start_research first.".to_owned();
        }
        self.spend_call();
        let sub_question = match args.get("sub_question") {
            Some(Value::Null) | None => None,
            Some(Value::String(text)) => Some(text.clone()),
            Some(other) => Some(other.to_string()),
        };
        let claim = text(args, "claim");
        let quote = text(args, "quote");
        let source = text(args, "source_id");
        let confidence = args.get("confidence").and_then(Value::as_str);
        let Some(run) = self.research.as_mut() else {
            return String::new();
        };
        let added = add_note(
            run,
            NoteInput {
                sub_question: sub_question.as_deref(),
                claim: &claim,
                quote: &quote,
                source: &source,
                confidence,
            },
        );
        match added {
            Err(message) => format!("TOOL RESULT (add_note): {message}"),
            Ok(note) => format!("TOOL RESULT (add_note): Saved as {}.{}", note.id, self.run_footer()),
        }
    }

    /// The latest finished run saved for this chat, for a follow-up after the turn that ran it is gone.
    fn prior_run(&self) -> Option<draggy_storage::SavedRun> {
        let library = self.library.as_ref()?;
        let chat = library.chat_id.as_deref()?;
        let listed = library
            .storage
            .list_research_runs(library.workspace_id.as_deref(), 100)
            .ok()?;
        let latest = listed
            .into_iter()
            .filter(|entry| entry.chat_id.as_deref() == Some(chat) && entry.status == "done")
            .max_by_key(|entry| entry.ended_at.unwrap_or(0))?;
        library.storage.get_research_run(&latest.id).ok().flatten()
    }

    fn search_notes(&self, args: &Value) -> String {
        let saved = if self.research.is_some() { None } else { self.prior_run() };
        if self.research.is_none() && saved.is_none() {
            return "TOOL RESULT (search_notes): There is no research run.".to_owned();
        }
        let query = text(args, "query");
        let words: Vec<String> = query.to_lowercase().split_whitespace().map(str::to_owned).collect();
        let notes: Vec<(String, String, String, String)> = match (&self.research, &saved) {
            (Some(run), _) => run
                .notes
                .iter()
                .map(|n| (n.id.clone(), n.source_id.clone(), n.claim.clone(), n.quote.clone()))
                .collect(),
            (None, Some(saved)) => saved
                .notes
                .iter()
                .map(|n| (n.id.clone(), n.source_id.clone(), n.claim.clone(), n.quote.clone()))
                .collect(),
            _ => Vec::new(),
        };
        let mut lines: Vec<String> = notes
            .iter()
            .filter(|(_, _, claim, quote)| {
                let haystack = format!("{claim} {quote}").to_lowercase();
                words.is_empty() || words.iter().any(|word| haystack.contains(word.as_str()))
            })
            .take(20)
            .map(|(id, source, claim, quote)| format!("{id} ({source}): {claim}\n  \"{quote}\""))
            .collect();
        if let (Some(saved), Some(library)) = (&saved, &self.library) {
            let hits = library
                .storage
                .search_research(&query, Some(&saved.summary.id), 5)
                .unwrap_or_default();
            lines.extend(
                hits.into_iter()
                    .filter(|hit| hit.kind == "source")
                    .take(3)
                    .map(|hit| format!("page {}: {}", hit.reference, hit.snippet)),
            );
        }
        if lines.is_empty() {
            return if saved.is_some() {
                "TOOL RESULT (search_notes): Nothing in the earlier research matches. Search the web for this.".to_owned()
            } else {
                "TOOL RESULT (search_notes): No notes match.".to_owned()
            };
        }
        format!("TOOL RESULT (search_notes):\n{}", lines.join("\n"))
    }

    fn finish_research(&mut self) -> String {
        if self.research.is_none() {
            return "TOOL RESULT (finish_research): There is no research run.".to_owned();
        }
        let dropped = self.settle().unwrap_or(0);
        let Some(run) = self.research.as_ref() else {
            return String::new();
        };
        let kept: Vec<_> = run.notes.iter().filter(|note| note.verified == Some(true)).collect();
        let sources: Vec<_> = run
            .sources
            .iter()
            .filter(|source| kept.iter().any(|note| note.source_id == source.id))
            .collect();
        let gaps: Vec<String> = coverage(run)
            .into_iter()
            .filter(|entry| !entry.enough)
            .map(|entry| format!("{}. {}", entry.sub_question, entry.text))
            .collect();
        let list = |lines: Vec<String>| if lines.is_empty() { "(none)".to_owned() } else { lines.join("\n") };
        let mut parts = vec![
            "TOOL RESULT (finish_research): Write the report now. Answer the question first, then one section per sub-question. Cite every fact with its note id like [n1]; do not cite anything else. Write the report in the reply when it fits. When the user asked for a file, or it would run past about 1,500 words, write it with create_file and keep the reply to a short summary.".to_owned(),
            format!(
                "Notes:\n{}",
                list(kept
                    .iter()
                    .map(|note| format!("{} q{} {}: {}", note.id, note.sub_question, note.confidence.id(), note.claim))
                    .collect())
            ),
            format!(
                "Sources:\n{}",
                list(sources
                    .iter()
                    .map(|source| format!("{} {} {}", source.id, source.title, source.url))
                    .collect())
            ),
        ];
        if dropped > 0 {
            parts.push(format!("{dropped} notes were left out because their quote was not found on the page."));
        }
        if !gaps.is_empty() {
            parts.push(format!("Say plainly that these were not answered:\n{}", gaps.join("\n")));
        }
        parts.join("\n\n")
    }

    /// Settles a run the model never finished, as the turn ends. A stopped or failed turn leaves it cancelled.
    /// The run step in `steps` is redrawn, so the card shows the end state.
    pub fn settle_open(&mut self, cancelled: bool, steps: &mut Vec<draggy_agent::resume::SearchStep>) {
        if self.research.as_ref().is_some_and(|run| run.ended_at.is_none()) {
            if cancelled && let Some(run) = self.research.as_mut() {
                run.status = RunStatus::Cancelled;
            }
            self.settle();
            self.patch_run_step(steps);
        }
    }

    /// Ends gathering: checks every quote against its page, then saves the run to the library.
    /// The report still gets written if the library cannot save. Returns how many notes were dropped.
    pub fn settle(&mut self) -> Option<usize> {
        let now = now_ms();
        let run = self.research.as_mut()?;
        finish(run, StopReason::Finished);
        // A page opened but never resolved was left behind, so it reads as skipped.
        for source in &mut run.sources {
            if source.status == SourceStatus::Reading {
                source.status = SourceStatus::Skipped;
            }
        }
        let citable: Vec<Citable> = run
            .notes
            .iter()
            .map(|note| Citable {
                id: note.id.clone(),
                claim: note.claim.clone(),
                quote: note.quote.clone(),
                source_id: note.source_id.clone(),
            })
            .collect();
        let verdicts = verify_citations(&citable, &self.page_texts);
        for note in &mut run.notes {
            note.verified = Some(verdicts.get(&note.id) == Some(&CitationVerdict::Verified));
        }
        run.ended_at = Some(now);
        let dropped = run.notes.iter().filter(|note| note.verified != Some(true)).count();
        if let Some(library) = &self.library
            && let Some(record) = self.record(now)
            && let Err(error) = library.storage.save_research_run(&record)
        {
            tracing::warn!(target: "research.settle", error = %error, "the run stays in the chat");
        }
        Some(dropped)
    }

    /// What the library stores for the run. Only pages a note rests on keep a snapshot.
    fn record(&self, now: u64) -> Option<RunSave> {
        let run = self.research.as_ref()?;
        let library = self.library.as_ref()?;
        let to_i64 = |value: u64| i64::try_from(value).unwrap_or(i64::MAX);
        let plan = json!({
            "question": run.plan.question,
            "subQuestions": run.plan.sub_questions,
            "depth": run.plan.depth.id(),
            "sources": run.plan.sources.iter().map(|kind| kind.id()).collect::<Vec<_>>(),
        });
        Some(RunSave {
            id: run.id.clone(),
            workspace_id: library.workspace_id.clone(),
            chat_id: library.chat_id.clone(),
            question: run.plan.question.clone(),
            depth: Depth::id(run.plan.depth).to_owned(),
            status: if id_of(&run.status) == "cancelled" { "cancelled" } else { "done" }.to_owned(),
            plan_json: plan.to_string(),
            sub_questions: run.plan.sub_questions.clone(),
            started_at: to_i64(run.started_at),
            ended_at: Some(to_i64(run.ended_at.unwrap_or(now))),
            budget_used: budget_of(run, now).used,
            hosts_json: serde_json::to_string(&run.contacted_hosts).unwrap_or_else(|_| "[]".to_owned()),
            report_ref: None,
            sources: run
                .sources
                .iter()
                .map(|source| {
                    let noted = run.notes.iter().any(|note| note.source_id == source.id);
                    SourceSave {
                        id: source.id.clone(),
                        url: source.url.clone(),
                        canonical_url: source.key.clone(),
                        title: source.title.clone(),
                        site: source.site.clone(),
                        published: source.published.clone(),
                        status: id_of(&source.status),
                        text: self.page_texts.get(&source.id).filter(|_| noted).cloned(),
                        ..SourceSave::default()
                    }
                })
                .collect(),
            notes: run
                .notes
                .iter()
                .map(|note| NoteSave {
                    id: note.id.clone(),
                    sub_question: i64::try_from(note.sub_question).unwrap_or(1),
                    claim: note.claim.clone(),
                    quote: note.quote.clone(),
                    source_id: note.source_id.clone(),
                    confidence: note.confidence.id().to_owned(),
                    verified: note.verified == Some(true),
                })
                .collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research::run::{SourceInput, SourceStatus, add_source};
    use draggy_agent::agent_loop::IdSource;
    use draggy_agent::task_manager::CancelSignal;
    use draggy_web::search::SearchConfig;

    struct Ids(u32);

    impl IdSource for Ids {
        fn next_id(&mut self) -> String {
            self.0 += 1;
            format!("id{}", self.0)
        }
    }

    fn call(web: &mut WebTools, name: &str, args: &Value) -> String {
        let (mut steps, mut ids, cancel) = (Vec::new(), Ids(0), CancelSignal::new());
        let mut ctx = ToolContext {
            steps: &mut steps,
            ids: &mut ids,
            cancel: &cancel,
            plan: None,
        };
        web.run_research(name, args, &mut ctx)
    }

    #[test]
    fn run_step_follows_the_run() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let mut web = tools(&rt);
        let (mut steps, mut ids, cancel) = (Vec::new(), Ids(0), CancelSignal::new());
        let mut ctx = ToolContext { steps: &mut steps, ids: &mut ids, cancel: &cancel, plan: None };
        web.run_research("start_research", &json!({"question": "Why is the sky blue"}), &mut ctx);
        web.sync_run_step(&mut ctx);
        web.sync_run_step(&mut ctx);
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].kind, "research_run");
        assert!(steps[0].content.as_deref().unwrap().contains("\"question\""));
    }

    fn tools(rt: &tokio::runtime::Runtime) -> WebTools {
        WebTools::new(rt.handle().clone(), SearchConfig::default()).expect("web tools")
    }

    #[test]
    fn a_run_notes_a_read_page_and_saves_on_settle() {
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let storage = Arc::new(Storage::open(dir.path()).unwrap());
        let mut web = tools(&rt);
        web.set_library(Some(ResearchLibrary {
            storage: Arc::clone(&storage),
            workspace_id: Some("default".into()),
            chat_id: Some("c1".into()),
        }));
        assert!(call(&mut web, "add_note", &json!({})).contains("Call start_research first"));
        let started = call(&mut web, "start_research", &json!({"question": "Why", "sub_questions": "One\nTwo"}));
        assert!(started.contains("The plan is approved") && started.contains("RESEARCH: Why"));
        let run = web.research.as_mut().unwrap();
        let source = add_source(
            run,
            SourceInput {
                url: "https://a.test/p",
                title: Some("P"),
                status: Some(SourceStatus::Read),
                ..SourceInput::default()
            },
        );
        web.page_texts.insert(source.id.clone(), "The sky is blue because of scattering.".into());
        let args = json!({"claim": "Scattering", "quote": "blue because of scattering", "source_id": "s1"});
        assert!(call(&mut web, "add_note", &args).contains("Saved as n1."));
        let fake = json!({"claim": "Made up", "quote": "this is not on the page", "source_id": "s1"});
        call(&mut web, "add_note", &fake);
        let finished = call(&mut web, "finish_research", &json!({}));
        assert!(finished.contains("n1 q1 single_source: Scattering"));
        assert!(!finished.contains("Made up"));
        assert!(finished.contains("1 notes were left out"));
        let saved = storage.get_research_run(&web.research.as_ref().unwrap().id).unwrap().expect("saved");
        assert_eq!(saved.summary.status, "done");
        assert_eq!(saved.notes.len(), 2);
        assert!(saved.sources[0].snapshot_hash.is_some());
        assert!(saved.plan_json.contains("subQuestions"));

        web.set_research(None);
        let found = call(&mut web, "search_notes", &json!({"query": "scattering"}));
        assert!(found.contains("n1 (s1): Scattering"));
        assert!(found.contains("page s1:"));
    }

    #[test]
    fn search_notes_without_a_run_says_so() {
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let mut web = tools(&rt);
        assert_eq!(
            call(&mut web, "search_notes", &json!({"query": "x"})),
            "TOOL RESULT (search_notes): There is no research run."
        );
    }

    #[test]
    fn settle_open_leaves_a_finished_run_alone() {
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let mut web = tools(&rt);
        call(&mut web, "start_research", &json!({"question": "Why", "sub_questions": "One"}));
        web.settle_open(false, &mut Vec::new());
        let ended = web.research.as_ref().unwrap().ended_at;
        assert!(ended.is_some());
        web.settle_open(false, &mut Vec::new());
        assert_eq!(web.research.as_ref().unwrap().ended_at, ended);
    }

    #[test]
    fn a_cancelled_turn_keeps_notes_and_skips_unread_pages() {
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let mut web = tools(&rt);
        call(&mut web, "start_research", &json!({"question": "Why", "sub_questions": "One"}));
        let run = web.research.as_mut().unwrap();
        let read = SourceInput { url: "https://a.test/p", status: Some(SourceStatus::Read), ..SourceInput::default() };
        let open = SourceInput { url: "https://b.test/q", status: Some(SourceStatus::Reading), ..SourceInput::default() };
        add_source(run, read);
        add_source(run, open);
        web.page_texts.insert("s1".into(), "The sky is blue because of scattering.".into());
        call(&mut web, "add_note", &json!({"claim": "C", "quote": "blue because of scattering", "source_id": "s1"}));
        let mut steps = Vec::new();
        web.settle_open(true, &mut steps);
        let run = web.research.as_ref().unwrap();
        assert_eq!(run.status, RunStatus::Cancelled);
        assert!(run.ended_at.is_some());
        assert_eq!(run.notes.len(), 1);
        assert_eq!(run.notes[0].verified, Some(true));
        assert_eq!(run.sources[1].status, SourceStatus::Skipped);
        let view = steps[0].content.as_deref().unwrap();
        assert!(view.contains("\"status\":\"skipped\"") && view.contains("\"gathering\":false"));
        assert_eq!(steps[0].is_complete, Some(true));
    }

    #[test]
    fn a_failed_turn_without_cancel_still_finishes_as_done() {
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let mut web = tools(&rt);
        call(&mut web, "start_research", &json!({"question": "Why", "sub_questions": "One"}));
        web.settle_open(false, &mut Vec::new());
        assert_eq!(web.research.as_ref().unwrap().status, RunStatus::Writing);
    }
}
