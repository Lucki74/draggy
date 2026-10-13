//! Runs the golden fixtures in `shared/fixtures/models` through the port, as `src/__tests__/fixtures/models.test.ts` does for the TypeScript reference.
//! Whole numbers are decimal strings on both sides, so 64-bit values stay exact through JSON.

use std::fs::{self, File};
use std::io::Cursor;
use std::path::Path;

use draggy_models::draft_model::{Drafts, draft_companion_name, is_companion_draft};
use draggy_models::draft_pairing::{
    DraftEntry, FAMILY_DRAFTS, family_draft_for, plan_draft, skip_reason,
};
use draggy_models::gguf::{
    GgufHeader, capabilities_from_template, parse_header, read_chat_template, read_header,
};
use draggy_models::mmproj::{Projectors, companion_name, is_companion_file};
use draggy_models::model_kinds::{
    Capabilities, cannot_generate, is_embedding_model, is_image_model, selectable_models,
};
use draggy_models::model_recommendations::{
    CPU_ONLY_RAM_FRACTION, GGUF_LADDER, RuntimeTarget, USABLE_RAM_FRACTION, chip_class_of,
    get_recommended_download, get_recommended_model, ladder_for, supports_mlx,
};
use draggy_models::shards::{parse_shard, shard_names};
use draggy_models::vram::{
    FitInput, ModelFit, RUNTIME_OVERHEAD_GB, Tone, USABLE_UNIFIED_FRACTION, USABLE_VRAM_FRACTION,
    describe_fit, describe_split, fit_status,
};
use draggy_testkit::{cases, files};
use serde_json::{Value, json};

/// A whole number as a decimal string, exact for any double; anything else stays a JSON number.
fn canon(n: f64) -> Value {
    if n.is_finite() && n.fract() == 0.0 {
        // The reference prints negative zero as "0".
        if n == 0.0 {
            Value::String("0".to_owned())
        } else {
            Value::String(format!("{n:.0}"))
        }
    } else {
        Value::from(n)
    }
}

fn canon_opt(n: Option<f64>) -> Value {
    n.map_or(Value::Null, canon)
}

fn canon_u64(n: Option<u64>) -> Value {
    n.map_or(Value::Null, |n| Value::String(n.to_string()))
}

fn str_of(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

/// Input numbers may be NaN or infinite, which JSON cannot carry, so they arrive as those words.
fn num(value: &Value) -> f64 {
    match value.as_str() {
        Some("NaN") => f64::NAN,
        Some("Infinity") => f64::INFINITY,
        Some("-Infinity") => f64::NEG_INFINITY,
        _ => value.as_f64().unwrap_or(f64::NAN),
    }
}

fn decode_hex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).expect("fixture hex"))
        .collect()
}

fn write_sized(path: &Path, size: u64) {
    let file = File::create(path).expect("create fixture file");
    file.set_len(size).expect("size fixture file");
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The header as the fixture writes it: the same keys as the reference, whole numbers as strings.
fn header_json(header: &GgufHeader) -> Value {
    json!({
        "architecture": header.architecture,
        "contextLength": canon_opt(header.context_length),
        "blockCount": canon_opt(header.block_count),
        "embeddingLength": canon_opt(header.embedding_length),
        "fileType": canon_opt(header.file_type),
        "name": header.name,
        "expertCount": canon(header.expert_count),
        "expertUsedCount": canon(header.expert_used_count),
        "headCountKv": canon_opt(header.head_count_kv),
        "keyLength": canon_opt(header.key_length),
        "valueLength": canon_opt(header.value_length),
        "mtp": header.mtp,
        "tokenizerModel": header.tokenizer_model,
        "tokenizerPre": header.tokenizer_pre,
        "vocabSize": canon_opt(header.vocab_size),
        "version": canon(f64::from(header.version)),
    })
}

/// The header a fixture input describes. Missing keys read as the reference reads them: null, false or 0.
fn header_of(value: &Value) -> Option<GgufHeader> {
    if value.is_null() {
        return None;
    }
    Some(GgufHeader {
        architecture: str_of(&value["architecture"]).to_owned(),
        context_length: value["contextLength"].as_f64(),
        block_count: value["blockCount"].as_f64(),
        embedding_length: value["embeddingLength"].as_f64(),
        file_type: value["fileType"].as_f64(),
        name: value["name"].as_str().map(str::to_owned),
        expert_count: value["expertCount"].as_f64().unwrap_or(0.0),
        expert_used_count: value["expertUsedCount"].as_f64().unwrap_or(0.0),
        head_count_kv: value["headCountKv"].as_f64(),
        key_length: value["keyLength"].as_f64(),
        value_length: value["valueLength"].as_f64(),
        mtp: value["mtp"].as_bool().unwrap_or(false),
        tokenizer_model: value["tokenizerModel"].as_str().map(str::to_owned),
        tokenizer_pre: value["tokenizerPre"].as_str().map(str::to_owned),
        vocab_size: value["vocabSize"].as_f64(),
        version: value["version"]
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .unwrap_or(3),
    })
}

fn run_gguf(input: &Value) -> Value {
    let bytes = input["hex"].as_str().map(decode_hex);
    let (buffer, header, template) = match &bytes {
        None => (Value::Null, Value::Null, None),
        Some(bytes) => (
            parse_header(bytes)
                .ok()
                .map_or(Value::Null, |header| header_json(&header)),
            read_header(&mut Cursor::new(bytes.clone()))
                .ok()
                .map_or(Value::Null, |header| header_json(&header)),
            read_chat_template(&mut Cursor::new(bytes.clone()))
                .ok()
                .flatten(),
        ),
    };
    json!({
        "buffer": buffer,
        "header": header,
        "chatTemplate": template,
        "capabilities": capabilities_from_template(template.as_deref()),
    })
}

#[derive(Clone, Copy)]
enum Kind {
    Mmproj,
    Draft,
}

/// Runs the steps in order in one models folder and returns one result per step.
fn run_sequence(input: &Value, kind: Kind) -> Value {
    let dir = tempfile::tempdir().expect("temp dir");
    let folder = dir.path();
    for file in input["files"].as_array().into_iter().flatten() {
        write_sized(
            &folder.join(str_of(&file["name"])),
            file["size"].as_u64().unwrap_or(0),
        );
    }
    let mut projectors = Projectors::new();
    let mut drafts = Drafts::new();
    let mut results = Vec::new();
    for step in input["steps"].as_array().into_iter().flatten() {
        let model = str_of(&step["model"]);
        let result = match str_of(&step["op"]) {
            "find" => {
                let found = match kind {
                    Kind::Mmproj => projectors.find_companion(folder, model),
                    Kind::Draft => drafts.find_companion_draft(folder, model),
                };
                found.map_or(Value::Null, |path| json!(name_of(&path)))
            }
            "wasRefused" => json!(match kind {
                Kind::Mmproj => projectors.was_refused(folder, model),
                Kind::Draft => drafts.was_refused(folder, model),
            }),
            "refuse" => {
                let file = folder.join(str_of(&step["file"]));
                match kind {
                    Kind::Mmproj => projectors.mark_refused(&file),
                    Kind::Draft => drafts.mark_refused(&file),
                }
                Value::Null
            }
            "write" => {
                write_sized(
                    &folder.join(str_of(&step["file"])),
                    step["size"].as_u64().unwrap_or(0),
                );
                Value::Null
            }
            other => panic!("unknown step {other}"),
        };
        results.push(result);
    }
    Value::Array(results)
}

fn run_mmproj(input: &Value) -> Value {
    match str_of(&input["op"]) {
        "companionName" => json!(companion_name(str_of(&input["filename"]))),
        "isCompanionFile" => json!(is_companion_file(str_of(&input["name"]))),
        "sequence" => run_sequence(input, Kind::Mmproj),
        other => panic!("unknown mmproj op {other}"),
    }
}

fn run_draft_model(input: &Value) -> Value {
    match str_of(&input["op"]) {
        "draftCompanionName" => json!(draft_companion_name(str_of(&input["filename"]))),
        "isCompanionDraft" => json!(is_companion_draft(str_of(&input["name"]))),
        "sequence" => run_sequence(input, Kind::Draft),
        other => panic!("unknown draft op {other}"),
    }
}

fn family_json(entry: Option<&DraftEntry>) -> Value {
    entry.map_or(Value::Null, |entry| {
        json!({
            "family": entry.family,
            "vocab": canon_u64(entry.vocab),
            "repo": entry.repo,
            "file": entry.file,
        })
    })
}

fn run_plan_draft(input: &Value) -> Value {
    let dir = tempfile::tempdir().expect("temp dir");
    for file in input["files"].as_array().into_iter().flatten() {
        let bytes = file["hex"].as_str().map(decode_hex).unwrap_or_default();
        let path = dir.path().join(str_of(&file["name"]));
        fs::write(&path, &bytes).expect("write fixture file");
        let size = file["size"].as_u64().unwrap_or(0);
        if size > bytes.len() as u64 {
            let handle = fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .expect("reopen fixture file");
            handle.set_len(size).expect("size fixture file");
        }
    }
    plan_draft(&dir.path().join(str_of(&input["model"]))).map_or(
        Value::Null,
        |plan| json!({"family": plan.family, "url": plan.url, "filename": plan.filename}),
    )
}

fn run_draft_pairing(input: &Value) -> Value {
    match str_of(&input["op"]) {
        "familyDraftFor" => {
            let header = header_of(&input["header"]);
            family_json(family_draft_for(header.as_ref()))
        }
        "skipReason" => {
            let header = header_of(&input["header"]);
            let bytes = input["modelBytes"].as_u64().unwrap_or(0);
            skip_reason(header.as_ref(), bytes).map_or(Value::Null, |reason| json!(reason.as_str()))
        }
        "table" => Value::Array(
            FAMILY_DRAFTS
                .iter()
                .map(|entry| family_json(Some(entry)))
                .collect(),
        ),
        "planDraft" => run_plan_draft(input),
        other => panic!("unknown draft-pairing op {other}"),
    }
}

fn run_shards(input: &Value) -> Value {
    let filename = str_of(&input["filename"]);
    let shard = parse_shard(filename).map_or(Value::Null, |shard| {
        json!({
            "stem": shard.stem,
            "index": canon(f64::from(shard.index)),
            "total": canon(f64::from(shard.total)),
            "totalText": shard.total_text,
        })
    });
    json!({"shard": shard, "names": shard_names(filename)})
}

struct Model {
    name: String,
    capabilities: Vec<String>,
}

impl Capabilities for Model {
    fn capabilities(&self) -> &[String] {
        &self.capabilities
    }
}

/// A capability list; an absent (null) list is the empty list, which the reference also reads as no objection.
fn capabilities_of(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str().map(str::to_owned))
        .collect()
}

fn run_model_kinds(input: &Value) -> Value {
    let caps = capabilities_of(&input["capabilities"]);
    match str_of(&input["op"]) {
        "cannotGenerate" => json!(cannot_generate(&caps)),
        "isEmbeddingModel" => json!(is_embedding_model(&caps)),
        "isImageModel" => json!(is_image_model(&caps)),
        "selectableModels" => {
            let models: Vec<Model> = input["models"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|model| Model {
                    name: str_of(&model["name"]).to_owned(),
                    capabilities: capabilities_of(&model["capabilities"]),
                })
                .collect();
            json!(
                selectable_models(&models)
                    .iter()
                    .map(|model| model.name.clone())
                    .collect::<Vec<_>>()
            )
        }
        other => panic!("unknown model-kinds op {other}"),
    }
}

fn target_of(value: &Value) -> RuntimeTarget {
    RuntimeTarget {
        platform: value["platform"].as_str().map(str::to_owned),
        arch: value["arch"].as_str().map(str::to_owned),
        ram: value["ram"].as_f64(),
        cpu_model: value["cpuModel"].as_str().map(str::to_owned),
    }
}

fn run_recommendations(input: &Value) -> Value {
    let target = target_of(&input["target"]);
    match str_of(&input["op"]) {
        "ladder" => Value::Array(
            GGUF_LADDER
                .iter()
                .map(|rung| {
                    json!({
                        "vram": canon(rung.vram),
                        "model": rung.model,
                        "label": rung.label,
                        "params": rung.params,
                        "sizeGB": canon(rung.size_gb),
                    })
                })
                .collect(),
        ),
        "ladderFor" => Value::Array(
            ladder_for(&target)
                .iter()
                .map(|rung| json!(rung.model))
                .collect(),
        ),
        "constants" => json!({
            "USABLE_RAM_FRACTION": canon(USABLE_RAM_FRACTION),
            "CPU_ONLY_RAM_FRACTION": canon(CPU_ONLY_RAM_FRACTION),
        }),
        "getRecommendedModel" => json!(get_recommended_model(num(&input["vram"]), &target)),
        "getRecommendedDownload" => {
            let download = get_recommended_download(num(&input["vram"]), &target);
            json!({
                "model": download.model,
                "label": download.label,
                "reference": download.reference,
                "size": download.size.to_string(),
            })
        }
        "chipClassOf" => json!(chip_class_of(input["cpuModel"].as_str()).as_str()),
        "supportsMlx" => json!(supports_mlx(&target)),
        other => panic!("unknown recommendations op {other}"),
    }
}

fn tone_of(name: &str) -> Option<Tone> {
    match name {
        "green" => Some(Tone::Green),
        "amber" => Some(Tone::Amber),
        "red" => Some(Tone::Red),
        "unknown" => Some(Tone::Unknown),
        _ => None,
    }
}

fn fit_json(fit: &ModelFit) -> Value {
    json!({
        "tone": fit.tone.as_str(),
        "gpuPercent": canon(fit.gpu_percent),
        "sizeGB": canon(fit.size_gb),
        "neededGB": canon(fit.needed_gb),
        "usableGB": canon(fit.usable_gb),
    })
}

fn run_vram(input: &Value) -> Value {
    match str_of(&input["op"]) {
        "describe" => {
            let fit = describe_fit(FitInput {
                model_bytes: num(&input["modelBytes"]),
                vram_gb: num(&input["vramGB"]),
                unified_memory: input["unifiedMemory"].as_bool().unwrap_or(false),
            });
            json!({"fit": fit_json(&fit), "split": describe_split(&fit)})
        }
        "fitStatus" => tone_of(str_of(&input["tone"]))
            .and_then(fit_status)
            .map_or(Value::Null, |status| json!(status)),
        "constants" => json!({
            "RUNTIME_OVERHEAD_GB": canon(RUNTIME_OVERHEAD_GB),
            "USABLE_VRAM_FRACTION": canon(USABLE_VRAM_FRACTION),
            "USABLE_UNIFIED_FRACTION": canon(USABLE_UNIFIED_FRACTION),
        }),
        other => panic!("unknown vram op {other}"),
    }
}

#[test]
fn fixtures_match_the_typescript_reference() {
    for file in files("models") {
        for case in cases("models", &file) {
            let name = str_of(&case["name"]);
            let input = &case["input"];
            let actual = match file.as_str() {
                "gguf.json" => run_gguf(input),
                "mmproj.json" => run_mmproj(input),
                "draft-model.json" => run_draft_model(input),
                "draft-pairing.json" => run_draft_pairing(input),
                "shards.json" => run_shards(input),
                "model-kinds.json" => run_model_kinds(input),
                "model-recommendations.json" => run_recommendations(input),
                "vram.json" => run_vram(input),
                other => panic!("no runner for {other}"),
            };
            assert_eq!(actual, case["expected"], "{file}: {name}");
        }
    }
}
