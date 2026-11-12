//! The colibri models the app offers (plan appendix A.1). Port of electron/colibriCatalog.cjs.
//! Sizes are the download as listed on Hugging Face. `routed_gb` is what one token reads from the experts;
//! where the plan has no measurement it is derived from the active-expert fraction and flagged `estimated`.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: &'static str,
    pub name: &'static str,
    pub repo: &'static str,
    #[serde(rename = "totalGB")]
    pub total_gb: f64,
    #[serde(rename = "denseGB")]
    pub dense_gb: f64,
    #[serde(rename = "ramMinGB")]
    pub ram_min_gb: f64,
    #[serde(rename = "ramGoodGB")]
    pub ram_good_gb: f64,
    #[serde(rename = "routedGB")]
    pub routed_gb: f64,
    pub estimated: bool,
}

#[allow(clippy::too_many_arguments)]
const fn entry(
    id: &'static str,
    name: &'static str,
    repo: &'static str,
    total_gb: f64,
    dense_gb: f64,
    ram_min_gb: f64,
    ram_good_gb: f64,
    routed_gb: f64,
    estimated: bool,
) -> Entry {
    Entry {
        id,
        name,
        repo,
        total_gb,
        dense_gb,
        ram_min_gb,
        ram_good_gb,
        routed_gb,
        estimated,
    }
}

pub const CATALOG: [Entry; 10] = [
    entry(
        "qwen3-coder-30b-a3b",
        "Qwen3-Coder-30B-A3B",
        "Justvugg/Qwen3-Coder-30B-A3B-colibri-int4",
        19.4,
        3.6,
        8.0,
        18.0,
        1.3,
        true,
    ),
    entry(
        "qwen36-35b-a3b",
        "Qwen3.6-35B-A3B",
        "Kreuzzelg/qwen36-35b-a3b-colibri-i4-gs64",
        23.1,
        3.5,
        10.0,
        20.0,
        1.6,
        false,
    ),
    entry(
        "dsv4-flash-reap",
        "DeepSeek V4 Flash REAP",
        "puwaer/DeepSeek-V4-Flash-0731-reap-150b",
        84.7,
        7.9,
        16.0,
        32.0,
        3.0,
        true,
    ),
    entry(
        "dsv4-flash",
        "DeepSeek V4 Flash",
        "deepseek-ai/DeepSeek-V4-Flash-0731",
        166.9,
        7.9,
        16.0,
        32.0,
        5.5,
        false,
    ),
    entry(
        "mimo-v26-flash",
        "MiMo-V2.6 Flash",
        "XiaomiMiMo/MiMo-V2.6-Flash-MOPD",
        171.8,
        24.0,
        32.0,
        52.0,
        6.0,
        true,
    ),
    entry(
        "glm-52",
        "GLM-5.2",
        "mastouri/GLM-5.2-colibri-int4-g64-with-int8-mtp",
        429.3,
        9.9,
        16.0,
        24.0,
        11.0,
        false,
    ),
    entry(
        "glm-53",
        "GLM-5.3",
        "Justvugg/GLM-5.3-colibri-int4-g64",
        419.3,
        9.9,
        16.0,
        24.0,
        11.0,
        true,
    ),
    entry(
        "inkling",
        "Inkling",
        "nbeerbower/Inkling-colibri-int4",
        514.1,
        49.4,
        120.0,
        128.0,
        10.0,
        true,
    ),
    entry(
        "mimo-v26-pro",
        "MiMo-V2.6 Pro",
        "XiaomiMiMo/MiMo-V2.6-Pro-MOPD",
        563.6,
        32.4,
        54.0,
        64.0,
        12.0,
        false,
    ),
    entry(
        "kimi-k3",
        "Kimi K3",
        "moonshotai/Kimi-K3",
        1561.0,
        20.0,
        32.0,
        64.0,
        25.0,
        false,
    ),
];

/// The catalog entry with this id, or None.
pub fn find(id: &str) -> Option<&'static Entry> {
    CATALOG.iter().find(|item| item.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_known_and_rejects_unknown() {
        assert_eq!(find("glm-52").map(|e| e.routed_gb), Some(11.0));
        assert!(find("nope").is_none());
    }

    #[test]
    fn ids_are_unique() {
        let mut ids: Vec<&str> = CATALOG.iter().map(|e| e.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), CATALOG.len());
    }
}
