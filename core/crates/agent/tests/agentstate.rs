//! Runs the golden fixtures in `shared/fixtures/agentstate` through the Rust port. The vitest runner in
//! `src/__tests__/fixtures/agentstate.test.ts` drives the TypeScript reference on the same files, so both must agree.
//! Each fixture file names its area; a `taskManager` case is an op list over one manager, then its final state.

use std::collections::BTreeMap;

use draggy_agent::compaction::{
    CHARS_PER_TOKEN, COMPACT_AT, CompactionPlan, CompactionState, KEEP_RECENT_MESSAGES,
    MIN_FOLD_MESSAGES, PlanOptions, SUMMARY_CHAR_BUDGET, append_summary, build_summary_messages,
    compaction_survives, conversation_chars, folded_tokens, message_chars, plan_compaction,
    plan_manual_compaction, render_compaction_block, render_transcript, summary_from_response,
    summary_request_body, trim_summary,
};
use draggy_agent::context_breakdown::{
    ContextBreakdown, ContextDetails, ContextWindowInput, LoadedSkillName, MIN_COMPACT_LIMIT,
    PAID_COMPACT_CAP, PromptParts, TokenCount, compact_threshold, context_details,
    describe_context_window, format_token_count, max_limit_for, measure_breakdown,
    parse_token_count, tokens_of,
};
use draggy_agent::json::canonical;
use draggy_agent::live_turn::{LiveTurn, LiveTurns};
use draggy_agent::permissions::Grant;
use draggy_agent::prompts::{PromptSkill, describe_skills};
use draggy_agent::resume::{
    RESUME_BUDGET, SearchStep, build_resume_message, describe_completed_work, join_continuation,
};
use draggy_agent::skills::{
    LoadedSkill, loaded_skill_ids, render_invoked_skill, render_loaded_skills, render_skill,
    skill_invocation,
};
use draggy_agent::subagent::{
    EXPLORE_TIMEOUT_MS, ExploreError, ExploreRequest, ExploreRunner, InstalledModel, explore,
    pick_explore_model,
};
use draggy_agent::task_manager::{
    Attachment, ChatSession, Message, TaskManager, Turn, TurnOutcome, TurnResult,
};
use draggy_agent::tool_channel::{
    ToolDefinition, choose_channel, looks_like_call, read_repair, repair_prompt, repair_schema,
};
use draggy_testkit::{cases, files, load};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

#[test]
fn fixtures_match_the_typescript_reference() {
    for file in files("agentstate") {
        let area = load("agentstate", &file)["area"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        for case in cases("agentstate", &file) {
            let name = case["name"].as_str().unwrap_or_default();
            let actual = drive(&area, &case["input"]);
            // Numbers compare as JavaScript doubles, so `1.0` and `1` are the same value on both sides.
            assert_eq!(
                canonical(&actual),
                canonical(&case["expected"]),
                "{file}: {name}"
            );
        }
    }
}

fn drive(area: &str, input: &Value) -> Value {
    match area {
        "compaction" => compaction(input),
        "contextBreakdown" => context_breakdown(input),
        "resume" => resume(input),
        "subagent" => subagent(input),
        "toolChannel" => tool_channel(input),
        "liveTurn" => live_turn(input),
        "taskManager" => task_manager(input),
        "agentLoop" => agent_loop(input),
        other => panic!("no runner for {other}"),
    }
}

/// A typed value from a fixture field. A missing or `null` field is a test bug, so it panics with the field name.
fn typed<T: DeserializeOwned>(value: &Value, field: &str) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("bad {field}: {error}"))
}

/// An optional typed value: absent and `null` are both None.
fn optional<T: DeserializeOwned>(value: &Value) -> Option<T> {
    if value.is_null() {
        None
    } else {
        Some(typed(value, "optional field"))
    }
}

fn messages_of(value: &Value) -> Vec<Message> {
    value
        .as_array()
        .map(|items| items.iter().map(|item| typed(item, "message")).collect())
        .unwrap_or_default()
}

fn optional_state(value: &Value) -> Option<CompactionState> {
    optional(value)
}

fn plan_of(value: &Value) -> CompactionPlan {
    typed(value, "plan")
}

fn usize_field(value: &Value, field: &str) -> Option<usize> {
    value[field].as_u64().map(|number| number as usize)
}

fn to_value<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or_else(|error| panic!("cannot serialise: {error}"))
}

// ---------------------------------------------------------------------------------------------------------------
// compaction
// ---------------------------------------------------------------------------------------------------------------

fn compaction(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or_default() {
        "constants" => json!({
            "CHARS_PER_TOKEN": CHARS_PER_TOKEN,
            "COMPACT_AT": COMPACT_AT,
            "KEEP_RECENT_MESSAGES": KEEP_RECENT_MESSAGES,
            "MIN_FOLD_MESSAGES": MIN_FOLD_MESSAGES,
            "SUMMARY_CHAR_BUDGET": SUMMARY_CHAR_BUDGET,
        }),
        "messageChars" => json!(message_chars(&typed(&input["message"], "message"))),
        "conversationChars" => json!(conversation_chars(
            &messages_of(&input["messages"]),
            optional_state(&input["existing"]).as_ref()
        )),
        "planCompaction" => {
            let options = PlanOptions {
                budget_chars: input["budgetChars"].as_i64().unwrap_or(0),
                keep_recent: usize_field(input, "keepRecent").unwrap_or(KEEP_RECENT_MESSAGES),
                min_fold: usize_field(input, "minFold").unwrap_or(MIN_FOLD_MESSAGES),
            };
            to_value(&plan_compaction(
                &messages_of(&input["messages"]),
                optional_state(&input["existing"]).as_ref(),
                options,
            ))
        }
        "planManual" => to_value(&plan_manual_compaction(
            &messages_of(&input["messages"]),
            optional_state(&input["existing"]).as_ref(),
        )),
        "foldedTokens" => json!(folded_tokens(
            &messages_of(&input["messages"]),
            plan_of(&input["plan"])
        )),
        "renderTranscript" => json!(render_transcript(&messages_of(&input["messages"]))),
        "buildSummaryMessages" => to_value(&build_summary_messages(
            input["previous"].as_str(),
            &messages_of(&input["slice"]),
        )),
        "appendSummary" => json!(append_summary(
            input["previous"].as_str(),
            input["addition"].as_str().unwrap_or("")
        )),
        "trimSummary" => json!(trim_summary(
            input["summary"].as_str().unwrap_or(""),
            usize_field(input, "budget").unwrap_or(SUMMARY_CHAR_BUDGET)
        )),
        "renderCompactionBlock" => json!(render_compaction_block(&typed(&input["state"], "state"))),
        "compactionSurvives" => to_value(&compaction_survives(
            optional_state(&input["state"]).as_ref(),
            &messages_of(&input["messages"]),
            usize_field(input, "editedIndex"),
        )),
        "requestBody" => {
            let messages = messages_of(&input["messages"]);
            let plan = plan_of(&input["plan"]);
            let slice = &messages[plan.fold_from..plan.fold_through];
            summary_request_body(
                input["model"].as_str().unwrap_or(""),
                &build_summary_messages(None, slice),
            )
        }
        "foldResult" => {
            let folded = summary_from_response(
                &messages_of(&input["messages"]),
                plan_of(&input["plan"]),
                optional_state(&input["existing"]).as_ref(),
                input["status"].as_u64().unwrap_or(200) as u16,
                input["response"].as_str().unwrap_or(""),
                0.0,
            );
            match folded {
                None => Value::Null,
                Some(state) => {
                    json!({"throughIndex": state.through_index, "summary": state.summary})
                }
            }
        }
        other => panic!("no compaction op {other}"),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// contextBreakdown
// ---------------------------------------------------------------------------------------------------------------

fn source_name(source: impl serde::Serialize) -> Value {
    to_value(&source)
}

fn context_breakdown(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or_default() {
        "tokensOf" => json!(tokens_of(input["chars"].as_i64().unwrap_or(0))),
        "measureBreakdown" => {
            let parts: PromptParts = typed(&input["parts"], "parts");
            let breakdown = measure_breakdown(
                &parts,
                input["measured"].as_i64().unwrap_or(0),
                input["conversationChars"].as_i64().unwrap_or(0),
            );
            to_value(&breakdown)
        }
        "describeContextWindow" => {
            let raw = &input["input"];
            let window = ContextWindowInput {
                details: optional::<ContextDetails>(&raw["details"]),
                breakdown: optional::<ContextBreakdown>(&raw["breakdown"]),
                draft_tokens: raw["draftTokens"].as_f64().unwrap_or(0.0),
                exact: raw["exact"].as_bool().unwrap_or(true),
                window_tokens: raw["windowTokens"].as_i64().unwrap_or(0),
                limit_tokens: raw["limitTokens"].as_i64(),
                paid: raw["paid"].as_bool().unwrap_or(false),
            };
            to_value(&describe_context_window(&window))
        }
        "compactThreshold" => {
            let threshold = compact_threshold(
                input["window"].as_i64().unwrap_or(0),
                input["limit"].as_i64(),
                input["paid"].as_bool().unwrap_or(false),
            );
            json!({"tokens": threshold.tokens, "source": source_name(threshold.source)})
        }
        "maxLimitFor" => json!(max_limit_for(input["window"].as_i64().unwrap_or(0))),
        "parseTokenCount" => match parse_token_count(input["raw"].as_str().unwrap_or("")) {
            TokenCount::Limit(value) => json!(value),
            TokenCount::NoLimit => Value::Null,
            TokenCount::Invalid => json!("undefined"),
        },
        "formatTokenCount" => json!(format_token_count(input["tokens"].as_f64().unwrap_or(0.0))),
        "contextDetails" => {
            let parts: Option<PromptParts> = optional(&input["parts"]);
            let loaded: Vec<LoadedSkillName> = typed(&input["loaded"], "loaded");
            to_value(&context_details(parts.as_ref(), &loaded))
        }
        "constants" => {
            json!({"PAID_COMPACT_CAP": PAID_COMPACT_CAP, "MIN_COMPACT_LIMIT": MIN_COMPACT_LIMIT})
        }
        other => panic!("no contextBreakdown op {other}"),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// resume
// ---------------------------------------------------------------------------------------------------------------

fn steps_of(value: &Value) -> Vec<SearchStep> {
    value
        .as_array()
        .map(|items| items.iter().map(|item| typed(item, "step")).collect())
        .unwrap_or_default()
}

fn resume(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or_default() {
        "describeCompletedWork" => json!(describe_completed_work(
            &steps_of(&input["steps"]),
            usize_field(input, "budget").unwrap_or(RESUME_BUDGET)
        )),
        "buildResumeMessage" => json!(build_resume_message(&steps_of(&input["steps"]))),
        "joinContinuation" => json!(join_continuation(
            input["before"].as_str().unwrap_or(""),
            input["after"].as_str().unwrap_or("")
        )),
        "constants" => json!({"RESUME_BUDGET": RESUME_BUDGET}),
        other => panic!("no resume op {other}"),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// subagent
// ---------------------------------------------------------------------------------------------------------------

/// A nested turn that answers or fails as the fixture says, without running anything.
struct FakeExplorer {
    outcome: Result<String, ExploreError>,
}

impl ExploreRunner for FakeExplorer {
    fn run(&mut self, _request: &ExploreRequest, timeout_ms: u64) -> Result<String, ExploreError> {
        assert_eq!(
            timeout_ms, EXPLORE_TIMEOUT_MS,
            "the explorer runs under the two-minute timeout"
        );
        self.outcome.clone()
    }
}

fn subagent(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or_default() {
        "pickExploreModel" => {
            let installed: Vec<InstalledModel> = typed(&input["installed"], "installed");
            json!(pick_explore_model(
                &installed,
                input["current"].as_str().unwrap_or("")
            ))
        }
        "constants" => json!({"EXPLORE_TIMEOUT_MS": EXPLORE_TIMEOUT_MS}),
        "explore" => {
            let outcome = match input["mode"].as_str().unwrap_or_default() {
                "answer" => Ok(input["text"].as_str().unwrap_or("").to_string()),
                "error" => Err(ExploreError::Failed(
                    input["message"].as_str().unwrap_or("").to_string(),
                )),
                "timeout" => Err(ExploreError::Timeout),
                other => panic!("no explore mode {other}"),
            };
            let mut runner = FakeExplorer { outcome };
            json!(explore(
                &mut runner,
                input["question"].as_str().unwrap_or(""),
                "qwen3:8b"
            ))
        }
        other => panic!("no subagent op {other}"),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// toolChannel
// ---------------------------------------------------------------------------------------------------------------

fn tool_channel(input: &Value) -> Value {
    match input["op"].as_str().unwrap_or_default() {
        "chooseChannel" => {
            let capabilities: Option<Vec<String>> = optional(&input["capabilities"]);
            to_value(&choose_channel(capabilities.as_deref()))
        }
        "repairSchema" => {
            let definitions: Vec<ToolDefinition> = typed(&input["definitions"], "definitions");
            repair_schema(&definitions)
        }
        "repairPrompt" => json!(repair_prompt(input["broken"].as_str().unwrap_or(""))),
        "readRepair" => to_value(&read_repair(input["raw"].as_str().unwrap_or(""))),
        "looksLikeCall" => {
            let names: Vec<String> = typed(&input["names"], "names");
            let names: Vec<&str> = names.iter().map(String::as_str).collect();
            json!(looks_like_call(
                input["text"].as_str().unwrap_or(""),
                &names
            ))
        }
        other => panic!("no toolChannel op {other}"),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// liveTurn
// ---------------------------------------------------------------------------------------------------------------

fn live_turn(input: &Value) -> Value {
    let mut turns = LiveTurns::default();
    for step in input["ops"].as_array().into_iter().flatten() {
        let chat_id = step["chatId"].as_str().unwrap_or_default();
        turns.set(chat_id, optional::<LiveTurn>(&step["live"]));
    }
    let mut read = serde_json::Map::new();
    for chat_id in input["query"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        read.insert(chat_id.to_string(), to_value(&turns.get(chat_id)));
    }
    Value::Object(read)
}

// ---------------------------------------------------------------------------------------------------------------
// taskManager
// ---------------------------------------------------------------------------------------------------------------

/// A turn the harness started, with whether its op list has finished it.
struct Started {
    turn: Turn,
    finished: bool,
}

/// Keeps a turn the manager started. A turn that did not start (no model) is not kept.
fn record_turn(turn: Option<Turn>, started: &mut Vec<Started>) {
    if let Some(turn) = turn {
        started.push(Started {
            turn,
            finished: false,
        });
    }
}

fn grant_of(value: &Value) -> Grant {
    Grant {
        tool: value["tool"].as_str().unwrap_or_default().to_string(),
        target: value["target"].as_str().map(str::to_string),
    }
}

fn outcome_of(op: &Value) -> TurnOutcome {
    if op["abort"].as_bool().unwrap_or(false) {
        TurnOutcome::Aborted
    } else {
        TurnOutcome::Failed(op["message"].as_str().unwrap_or("").to_string())
    }
}

/// The part of a session the fixture pins: what a person would see, without ids or clock readings.
fn project_session(session: &ChatSession) -> Value {
    let messages: Vec<Value> = session
        .messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role,
                "content": message.content,
                "failed": message.failed.unwrap_or(false),
                "textContent": message.text_content,
                "steps": kinds(message.steps.as_deref()),
                "providerState": message.provider_state.clone().unwrap_or(Value::Null),
                "fold": message.fold.map_or(Value::Null, |fold| to_value(&fold.status)),
                "currentVersionIndex": message.current_version_index,
                "versions": message.versions.iter().flatten().map(|version| json!({
                    "content": version.content,
                    "steps": kinds(version.steps.as_deref()),
                    "providerState": version.provider_state.clone().unwrap_or(Value::Null),
                })).collect::<Vec<_>>(),
            })
        })
        .collect();

    json!({
        "id": session.id,
        "workspaceId": session.workspace_id,
        "isGenerating": session.is_generating,
        "isOutOfContext": session.is_out_of_context,
        "compaction": session.compaction.as_ref().map_or(Value::Null, |state| json!({
            "throughIndex": state.through_index,
            "summary": state.summary,
        })),
        "messages": messages,
    })
}

fn kinds(steps: Option<&[SearchStep]>) -> Value {
    match steps {
        None => Value::Null,
        Some(steps) => Value::Array(steps.iter().map(|step| json!(step.kind)).collect()),
    }
}

fn task_manager(input: &Value) -> Value {
    let mut manager = TaskManager::new(input["workspaceId"].as_str().unwrap_or("default"));
    manager.set_model(input["model"].as_str().map(str::to_string));
    for session in input["sessions"].as_array().into_iter().flatten() {
        manager.add_session(typed(session, "session"));
    }

    let mut next_id = 0;
    let mut ids = move || {
        next_id += 1;
        format!("id-{next_id}")
    };
    let now = 1000.0;

    let mut started: Vec<Started> = Vec::new();
    let mut answers: BTreeMap<String, String> = BTreeMap::new();
    let mut seen: Vec<Value> = Vec::new();
    let mut recorded: Vec<Value> = Vec::new();
    for op in input["ops"].as_array().into_iter().flatten() {
        let chat = op["chatId"].as_str().unwrap_or_default();
        match op["op"].as_str().unwrap_or_default() {
            "send" => {
                let attachments: Option<Vec<Attachment>> = optional(&op["attachments"]);
                let turn = manager.send(
                    chat,
                    op["content"].as_str().unwrap_or(""),
                    attachments,
                    "title",
                    now,
                    &mut ids,
                );
                record_turn(turn, &mut started);
            }
            "regenerate" => {
                let turn = manager.regenerate(chat, usize_field(op, "index"), now, &mut ids);
                record_turn(turn, &mut started);
            }
            "editMessage" => {
                let index = usize_field(op, "index").unwrap_or(usize::MAX);
                let turn = manager.edit_message(
                    chat,
                    index,
                    op["content"].as_str().unwrap_or(""),
                    now,
                    &mut ids,
                );
                record_turn(turn, &mut started);
            }
            "switchVersion" => {
                let index = usize_field(op, "index").unwrap_or(usize::MAX);
                manager.switch_version(chat, index, usize_field(op, "version").unwrap_or(0));
            }
            "continue" => {
                let turn = manager.continue_generation(chat, now, &mut ids);
                record_turn(turn, &mut started);
            }
            "finish" => {
                let Some(position) = started
                    .iter()
                    .position(|item| !item.finished && item.turn.chat_id == chat)
                else {
                    panic!("nothing to finish for {chat}");
                };
                started[position].finished = true;
                let turn = started[position].turn.clone();
                let result: TurnResult = typed(&op["result"], "result");
                let report = manager.finish_turn(
                    &turn,
                    TurnOutcome::Finished(Box::new(result)),
                    now,
                    &mut ids,
                );
                if let Some(row) = report.metric {
                    recorded.push(json!({
                        "chatId": row.chat_id,
                        "model": row.model,
                        "promptTokens": row.prompt_tokens,
                        "responseTokens": row.response_tokens,
                        "responseMs": row.response_ms,
                        "firstTokenMs": row.first_token_ms,
                        "loadMs": row.load_ms,
                        "loops": row.loops,
                        "tools": row.tools,
                    }));
                }
            }
            "fail" => {
                let Some(position) = started
                    .iter()
                    .position(|item| !item.finished && item.turn.chat_id == chat)
                else {
                    panic!("nothing to fail for {chat}");
                };
                started[position].finished = true;
                let turn = started[position].turn.clone();
                manager.finish_turn(&turn, outcome_of(op), now, &mut ids);
            }
            "ask" => {
                let approval = op["approvalId"].as_str().unwrap_or_default();
                manager.request_approval(chat, approval);
                answers.insert(approval.to_string(), "pending".to_string());
            }
            "answer" => {
                let approval = op["approvalId"].as_str().unwrap_or_default();
                if let Some(delivery) =
                    manager.answer_approval(approval, op["answer"].as_str().unwrap_or(""))
                {
                    answers.insert(delivery.approval_id, delivery.answer);
                }
            }
            "grant" => manager.grant(grant_of(&op["grant"])),
            "seen" => {
                let turn = started
                    .iter()
                    .rev()
                    .find(|item| item.turn.chat_id == chat)
                    .unwrap_or_else(|| panic!("no turn for {chat}"));
                let contents: Vec<String> = turn
                    .turn
                    .context
                    .iter()
                    .map(|message| message.content.clone())
                    .collect();
                seen.push(json!({"chatId": chat, "contents": contents}));
            }
            "stop" => {
                for delivery in manager.stop(chat) {
                    answers.insert(delivery.approval_id, delivery.answer);
                }
            }
            "stopAll" => {
                for delivery in manager.stop_all() {
                    answers.insert(delivery.approval_id, delivery.answer);
                }
            }
            other => panic!("no task op {other}"),
        }
    }

    let sessions: Vec<Value> = manager.sessions().values().map(project_session).collect();
    let granted: Vec<Value> = manager
        .granted()
        .iter()
        .map(|grant| json!({"tool": grant.tool, "target": grant.target}))
        .collect();

    json!({
        "sessions": sessions,
        "running": manager.running(),
        "granted": granted,
        "answers": answers,
        "recorded": recorded,
        "seen": seen,
    })
}

// -- agentLoop: the pure helpers of the turn loop. A case is told apart by its input's shape. --------------------

fn agent_loop(input: &Value) -> Value {
    use draggy_agent::agent_loop::{
        WireMessage, describe_edit, describe_plan, estimate_chars, is_remote, parse_plan,
        provider_of, same_plan, scope_to_target, to_wire_message,
    };

    if let Some(message) = input.get("message") {
        let message: draggy_agent::task_manager::Message =
            serde_json::from_value(message.clone()).expect("a stored message");
        let wire = to_wire_message(
            &message,
            input["allowImages"].as_bool().unwrap_or_default(),
            input["keepThinking"].as_bool().unwrap_or_default(),
        );
        return wire_json(&wire);
    }
    if let (Some(messages), None) = (
        input.get("messages").and_then(Value::as_array),
        input.get("op"),
    ) {
        let wires: Vec<WireMessage> = messages.iter().map(wire_from).collect();
        let tool_chars = input["toolChars"].as_i64().unwrap_or_default();
        return json!(estimate_chars(&wires, tool_chars));
    }
    let text = |field: &str| input[field].as_str().unwrap_or_default();
    match input["op"].as_str().unwrap_or_default() {
        "parsePlan" => json!(parse_plan(text("text"))),
        "samePlan" => json!(same_plan(
            &parse_plan(text("left")),
            &parse_plan(text("right"))
        )),
        "describePlan" => json!(describe_plan(&parse_plan(text("text")))),
        "describeEdit" => json!(describe_edit(&parse_plan(text("text")))),
        "isRemote" => json!(is_remote(text("model"))),
        "providerOf" => json!(provider_of(text("model"))),
        "scopeToTarget" => {
            let wires: Vec<WireMessage> = input["messages"]
                .as_array()
                .map(|entries| entries.iter().map(wire_from).collect())
                .unwrap_or_default();
            let kept = scope_to_target(&wires, text("model"));
            Value::Array(kept.iter().map(wire_json).collect())
        }
        "skillInvocation" => {
            let skills = prompt_skills(&input["skills"]);
            match skill_invocation(text("text"), &skills) {
                Some(found) => json!({ "id": found.skill.id, "request": found.request }),
                None => Value::Null,
            }
        }
        "loadedSkillIds" => {
            let messages: Vec<Message> = input["messages"]
                .as_array()
                .map(|entries| {
                    entries
                        .iter()
                        .map(|entry| serde_json::from_value(entry.clone()).expect("a message"))
                        .collect()
                })
                .unwrap_or_default();
            json!(loaded_skill_ids(
                &messages,
                &prompt_skills(&input["skills"])
            ))
        }
        "renderLoadedSkills" => json!(render_loaded_skills(&loaded_skills(&input["loaded"]))),
        "renderInvokedSkill" => json!(render_invoked_skill(
            &prompt_skill(&input["skill"]),
            text("request")
        )),
        "renderSkill" => json!(render_skill(&loaded_skill(&input["skill"]))),
        "describeSkills" => json!(describe_skills(&prompt_skills(&input["skills"]))),
        other => panic!("no agentLoop op {other}"),
    }
}

/// An installed skill as the prompt reads it: id, name, description, and whether the model may start it.
fn prompt_skill(value: &Value) -> PromptSkill {
    PromptSkill {
        id: value["id"].as_str().unwrap_or_default().to_string(),
        name: value["name"].as_str().unwrap_or_default().to_string(),
        description: value["description"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        model_invocable: value["modelInvocable"].as_bool(),
    }
}

fn prompt_skills(value: &Value) -> Vec<PromptSkill> {
    value
        .as_array()
        .map(|items| items.iter().map(prompt_skill).collect())
        .unwrap_or_default()
}

/// A loaded skill, read back from a fixture entry that carries its body and files.
fn loaded_skill(value: &Value) -> LoadedSkill {
    LoadedSkill {
        id: value["id"].as_str().unwrap_or_default().to_string(),
        name: value["name"].as_str().unwrap_or_default().to_string(),
        body: value["body"].as_str().unwrap_or_default().to_string(),
        files: value["files"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn loaded_skills(value: &Value) -> Vec<LoadedSkill> {
    value
        .as_array()
        .map(|items| items.iter().map(loaded_skill).collect())
        .unwrap_or_default()
}

/// A wire message as a fixture writes it: the fields the loop sends, and no others.
fn wire_json(wire: &draggy_agent::agent_loop::WireMessage) -> Value {
    let mut out = serde_json::Map::new();
    out.insert("role".to_string(), json!(wire.role));
    out.insert("content".to_string(), json!(wire.content));
    if let Some(thinking) = &wire.thinking {
        out.insert("thinking".to_string(), json!(thinking));
    }
    if !wire.images.is_empty() {
        out.insert("images".to_string(), json!(wire.images));
    }
    if let Some(state) = &wire.provider_state {
        out.insert("provider_state".to_string(), state.clone());
    }
    if let Some(reference) = &wire.draggy_ref {
        out.insert("draggy_ref".to_string(), to_value(reference));
    }
    Value::Object(out)
}

/// A fixture message read back into a wire message, keeping the fields the helpers look at.
fn wire_from(entry: &Value) -> draggy_agent::agent_loop::WireMessage {
    use draggy_agent::agent_loop::{DraggyRef, WireMessage};

    let mut wire = WireMessage::text(
        entry["role"].as_str().unwrap_or("user"),
        entry["content"].as_str().unwrap_or_default(),
    );
    wire.thinking = entry["thinking"].as_str().map(str::to_string);
    wire.images = entry["images"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    wire.provider_state = entry.get("provider_state").cloned();
    wire.draggy_ref = entry
        .get("draggy_ref")
        .and_then(|reference| serde_json::from_value::<DraggyRef>(reference.clone()).ok());
    wire
}
