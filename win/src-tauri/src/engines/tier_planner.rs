//! Where a colibri model lives (VRAM, RAM, disk) and how fast it should run.
//! Colibri models only: a pure function of the hardware report (its JSON) and the catalog entry.

use serde_json::{Value, json};

const OS_RESERVE_MIN_GB: f64 = 6.0;
const OS_RESERVE_FRACTION: f64 = 0.15;
const VRAM_USABLE_FRACTION: f64 = 0.9;
const VRAM_RUNTIME_OVERHEAD_GB: f64 = 0.8;
/// Share of disk time hidden behind compute by the loader pool.
const IO_OVERLAP: f64 = 0.3;
const SLOW_TOK_PER_SEC: f64 = 3.0;
const RAM_BANDWIDTH_GBPS: [f64; 2] = [30.0, 70.0];
const VRAM_BANDWIDTH_GBPS: [f64; 2] = [200.0, 450.0];
const GB: f64 = 1e9;
/// Context length the catalog plans against when the renderer gives none.
pub const DEFAULT_CONTEXT_TOKENS: f64 = 8192.0;

/// The catalog fields the planner reads, as the colibri entry describes them.
#[derive(Debug, Clone, Copy)]
pub struct Model {
    pub total_gb: f64,
    pub dense_gb: f64,
    pub routed_gb: f64,
    pub ram_min_gb: f64,
    pub estimated: bool,
    pub kv_bytes_per_token: f64,
}

/// Rounds like JavaScript's `Number(value.toFixed(digits))`.
fn round(value: f64, digits: usize) -> f64 {
    format!("{:.*}", digits, value).parse().unwrap_or(value)
}

fn num(value: &Value, pointer: &str) -> f64 {
    value
        .pointer(pointer)
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

/// The RAM the operating system keeps for itself.
pub fn os_reserve_gb(ram_gb: f64) -> f64 {
    OS_RESERVE_MIN_GB.max(ram_gb * OS_RESERVE_FRACTION)
}

/// A plan whose best case is under 3 tokens per second gets the slow-model behaviour in chat.
pub fn is_slow_plan(plan: &Value) -> bool {
    plan.get("expectedTokPerSec")
        .and_then(Value::as_array)
        .and_then(|range| range.get(1))
        .and_then(Value::as_f64)
        .is_some_and(|best| best < SLOW_TOK_PER_SEC)
}

fn role_rank(role: &str) -> u8 {
    match role {
        "good" => 0,
        "unknown" => 1,
        "slow" => 2,
        _ => 3,
    }
}

fn expert_mbps(drive: &Value) -> f64 {
    drive
        .pointer("/benchmark/expertMBps")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

/// The drive a large model should go on: not USB, enough room, fastest measured, then roomiest.
pub fn choose_drive(drives: &[Value], need_gb: f64) -> Option<&Value> {
    let mut usable: Vec<&Value> = drives
        .iter()
        .filter(|d| {
            d.get("role").and_then(Value::as_str) != Some("refuse")
                && num(d, "/freeBytes") / GB >= need_gb
        })
        .collect();
    usable.sort_by(|a, b| {
        let role = |d: &Value| role_rank(d.get("role").and_then(Value::as_str).unwrap_or(""));
        role(a)
            .cmp(&role(b))
            .then_with(|| expert_mbps(b).total_cmp(&expert_mbps(a)))
            .then_with(|| num(b, "/freeBytes").total_cmp(&num(a, "/freeBytes")))
    });
    usable.first().copied()
}

fn bottleneck_of(io_seconds: f64, vram_share: f64) -> &'static str {
    if io_seconds > 0.5 {
        "disk"
    } else if vram_share > 0.5 {
        "vram"
    } else {
        "ram-bandwidth"
    }
}

fn refusal(reason: &str, suggestion: &str, base: &Value, warnings: &[String]) -> Value {
    let mut out = base.clone();
    out["engine"] = json!("none");
    out["refusal"] = json!({ "reason": reason, "suggestion": suggestion });
    out["warnings"] = json!(warnings);
    out
}

/// Plans one colibri model against the hardware report. Returns the TierPlan object the renderer reads.
/// The engines installed here.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Availability {
    pub llamacpp: bool,
    pub llamacpp_stream: bool,
    pub colibri: bool,
}

/// The tier plan for one model. Catalog entries are all colibri kind, so the planner does not check the
/// engines, so the flags do not change this output; they are carried for llama.cpp kinds.
pub fn plan_model(
    model: &Model,
    hardware: &Value,
    context_tokens: f64,
    _engines: &Availability,
) -> Value {
    let ram_total = num(hardware, "/ram/totalGB");
    let unified = hardware
        .pointer("/gpu/unified")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let vram_raw = if unified {
        0.0
    } else {
        num(hardware, "/gpu/vramGB")
    };
    let reserve = os_reserve_gb(ram_total);
    let ram_usable = (ram_total - reserve).max(0.0);
    let vram_usable = if vram_raw > 0.0 {
        (vram_raw * VRAM_USABLE_FRACTION - VRAM_RUNTIME_OVERHEAD_GB).max(0.0)
    } else {
        0.0
    };
    let kv_gb = model.kv_bytes_per_token * context_tokens / GB;
    let mut warnings: Vec<String> = Vec::new();
    let drives: Vec<Value> = hardware
        .get("drives")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if model.ram_min_gb > ram_usable {
        let suggestion = format!(
            "This model needs at least {} GB of RAM for the engine; {} GB is usable here.",
            model.ram_min_gb,
            round(ram_usable, 1)
        );
        return refusal("ram-floor", &suggestion, &json!({}), &warnings);
    }
    if model.dense_gb + kv_gb > ram_usable + vram_usable {
        return refusal(
            "dense-part-too-large",
            "The always-active part of this model plus its context does not fit in RAM and VRAM together. Lower the context or pick a smaller model.",
            &json!({}),
            &warnings,
        );
    }

    // Dense weights go to VRAM first, then RAM; the context follows the same order.
    let dense_vram = model.dense_gb.min(vram_usable);
    let dense_ram = model.dense_gb - dense_vram;
    let kv_vram = kv_gb.min(vram_usable - dense_vram);
    let kv_ram = kv_gb - kv_vram;
    let expert_gb = (model.total_gb - model.dense_gb).max(0.0);
    let vram_expert = expert_gb.min(vram_usable - dense_vram - kv_vram);
    let ram_cache = (expert_gb - vram_expert).min((ram_usable - dense_ram - kv_ram).max(0.0));
    let cold_gb = (expert_gb - vram_expert - ram_cache).max(0.0);

    let base = json!({
        "vram": { "denseGB": round(dense_vram, 1), "expertGB": round(vram_expert, 1), "kvGB": round(kv_vram, 1) },
        "ram": { "denseGB": round(dense_ram, 1), "expertCacheGB": round(ram_cache, 1), "kvGB": round(kv_ram, 1), "reserveGB": round(reserve, 1) },
        "disk": { "volume": null, "mirrors": [], "coldGB": round(cold_gb, 1) },
        "estimated": model.estimated,
    });

    // Compute time: the bytes touched per token, read from VRAM or RAM.
    let active_gb = model.dense_gb + model.routed_gb;
    let vram_share = (dense_vram / active_gb.max(1e-9)).min(1.0);
    let compute_seconds = |high: bool| {
        let ram_bw = RAM_BANDWIDTH_GBPS[if high { 0 } else { 1 }];
        let vram_bw = VRAM_BANDWIDTH_GBPS[if high { 0 } else { 1 }];
        (active_gb * vram_share) / vram_bw + (active_gb * (1.0 - vram_share)) / ram_bw
    };

    // Nothing leaves RAM and VRAM: no disk, speed set by memory bandwidth.
    if cold_gb <= 0.05 {
        let mut out = base.clone();
        out["engine"] = json!("colibri");
        out["expectedHitRate"] = json!([1, 1]);
        out["expectedTokPerSec"] = json!([
            round(1.0 / compute_seconds(true), 1),
            round(1.0 / compute_seconds(false), 1)
        ]);
        out["bottleneck"] = json!(bottleneck_of(0.0, vram_share));
        out["warnings"] = json!(warnings);
        return out;
    }

    // Part of the experts must stay on disk.
    let Some(drive) = choose_drive(&drives, model.total_gb) else {
        let usb_only = drives.iter().any(|d| {
            d.get("role").and_then(Value::as_str) == Some("refuse")
                && num(d, "/freeBytes") / GB >= model.total_gb
        });
        return if usb_only {
            refusal(
                "usb-drive",
                "USB drives disconnect under sustained reads. Put the model on an internal NVMe drive.",
                &base,
                &warnings,
            )
        } else {
            let suggestion = format!("No internal drive has {:.0} GB free.", model.total_gb);
            refusal("no-space", &suggestion, &base, &warnings)
        };
    };
    match drive.get("role").and_then(Value::as_str) {
        Some("slow") => warnings.push("slow-drive".into()),
        Some("unknown") => warnings.push("unknown-drive".into()),
        _ => {}
    }
    let volume = drive.get("volume").cloned().unwrap_or(Value::Null);

    let cache_gb = vram_expert + ram_cache;
    let ratio = if expert_gb > 0.0 {
        cache_gb / expert_gb
    } else {
        1.0
    };
    let hit_rate = [round(ratio, 2), round(ratio.sqrt().min(0.95), 2)];

    let mut out = base.clone();
    out["engine"] = json!("colibri");
    out["disk"]["volume"] = volume;
    out["expectedHitRate"] = json!(hit_rate);
    out["warnings"] = json!(warnings);

    let bandwidth = expert_mbps(drive) / 1000.0;
    if bandwidth <= 0.0 {
        out["expectedTokPerSec"] = Value::Null;
        out["bottleneck"] = json!("disk");
        out["needsDiskTest"] = json!(true);
        return out;
    }
    let seconds = |hit: f64, high: bool| {
        compute_seconds(high) + (model.routed_gb * (1.0 - hit) * (1.0 - IO_OVERLAP)) / bandwidth
    };
    let slowest = seconds(hit_rate[0], true);
    let fastest = seconds(hit_rate[1], false);
    out["expectedTokPerSec"] = json!([round(1.0 / slowest, 2), round(1.0 / fastest, 2)]);
    out["bottleneck"] = json!(bottleneck_of(
        model.routed_gb * (1.0 - hit_rate[1]) / bandwidth,
        vram_share
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model() -> Model {
        Model {
            total_gb: 19.4,
            dense_gb: 3.6,
            routed_gb: 1.3,
            ram_min_gb: 8.0,
            estimated: true,
            kv_bytes_per_token: 60.0 * 1024.0,
        }
    }

    fn machine(ram: f64, vram: f64, drives: Value) -> Value {
        json!({
            "ram": { "totalGB": ram, "availableGB": ram },
            "gpu": { "vramGB": vram, "unified": false },
            "drives": drives,
        })
    }

    fn drive(role: &str, free_gb: f64, mbps: f64) -> Value {
        json!({ "volume": "D:\\", "role": role, "freeBytes": free_gb * GB, "benchmark": { "expertMBps": mbps } })
    }

    #[test]
    fn model_in_memory_runs_at_memory_speed() {
        let plan = plan_model(
            &model(),
            &machine(64.0, 8.0, json!([])),
            DEFAULT_CONTEXT_TOKENS,
            &Availability::default(),
        );
        assert_eq!(plan["engine"], "colibri");
        assert_eq!(plan["disk"]["coldGB"], 0.0);
        assert!(
            plan["expectedTokPerSec"][1].as_f64().unwrap()
                > plan["expectedTokPerSec"][0].as_f64().unwrap()
        );
        assert!(plan.get("refusal").is_none());
    }

    #[test]
    fn small_ram_refuses_at_the_floor() {
        let plan = plan_model(
            &model(),
            &machine(8.0, 0.0, json!([])),
            DEFAULT_CONTEXT_TOKENS,
            &Availability::default(),
        );
        assert_eq!(plan["refusal"]["reason"], "ram-floor");
    }

    #[test]
    fn cold_experts_need_a_drive_with_room() {
        let mut big = model();
        big.total_gb = 200.0;
        big.dense_gb = 10.0;
        let none = plan_model(
            &big,
            &machine(32.0, 0.0, json!([])),
            DEFAULT_CONTEXT_TOKENS,
            &Availability::default(),
        );
        assert_eq!(none["refusal"]["reason"], "no-space");
        let usb = plan_model(
            &big,
            &machine(32.0, 0.0, json!([drive("refuse", 900.0, 0.0)])),
            DEFAULT_CONTEXT_TOKENS,
            &Availability::default(),
        );
        assert_eq!(usb["refusal"]["reason"], "usb-drive");
    }

    #[test]
    fn unmeasured_drive_asks_for_a_disk_test() {
        let mut big = model();
        big.total_gb = 200.0;
        let plan = plan_model(
            &big,
            &machine(32.0, 0.0, json!([drive("good", 900.0, 0.0)])),
            DEFAULT_CONTEXT_TOKENS,
            &Availability::default(),
        );
        assert!(plan["expectedTokPerSec"].is_null());
        assert_eq!(plan["needsDiskTest"], true);
        assert_eq!(plan["disk"]["volume"], "D:\\");
    }

    #[test]
    fn chooses_good_fast_then_roomy_drives() {
        let drives = vec![
            drive("slow", 900.0, 9000.0),
            drive("good", 100.0, 1.0),
            drive("good", 500.0, 1.0),
        ];
        let picked = choose_drive(&drives, 50.0).unwrap();
        assert_eq!(picked["role"], "good");
        assert_eq!(picked["freeBytes"], json!(500.0 * GB));
        assert!(choose_drive(&drives, 2000.0).is_none());
    }

    #[test]
    fn slow_plan_is_under_three_tokens() {
        assert!(is_slow_plan(&json!({ "expectedTokPerSec": [1.0, 2.5] })));
        assert!(!is_slow_plan(&json!({ "expectedTokPerSec": [1.0, 3.0] })));
        assert!(!is_slow_plan(&json!({ "expectedTokPerSec": null })));
    }

    #[test]
    fn reserve_has_a_floor() {
        assert_eq!(os_reserve_gb(16.0), 6.0);
        assert!((os_reserve_gb(64.0) - 9.6).abs() < 1e-9);
    }
}

#[cfg(test)]
mod availability_tests {
    use super::*;

    #[test]
    fn colibri_entries_plan_the_same_whatever_engines_are_installed() {
        let hardware = json!({
            "ram": { "totalGB": 64.0 },
            "gpu": { "vramGB": 8.0, "unified": false },
            "drives": [],
        });
        let none = Availability::default();
        let all = Availability {
            llamacpp: true,
            llamacpp_stream: true,
            colibri: true,
        };
        let big = Model {
            total_gb: 40.0,
            dense_gb: 4.0,
            routed_gb: 36.0,
            ram_min_gb: 8.0,
            estimated: false,
            kv_bytes_per_token: 0.0,
        };
        let plan_none = plan_model(&big, &hardware, 8192.0, &none);
        let plan_all = plan_model(&big, &hardware, 8192.0, &all);
        assert_eq!(plan_none["engine"], "colibri");
        assert_eq!(plan_none, plan_all);
    }
}
