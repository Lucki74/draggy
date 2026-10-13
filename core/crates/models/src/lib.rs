//! Model metadata: what a GGUF header says about a model, the companion files beside it, and the rung
//! of the ladder a machine can run. Hugging Face search, downloads and the cache are not here.

pub mod draft_model;
pub mod draft_pairing;
pub mod gguf;
mod js;
pub mod mmproj;
pub mod model_kinds;
pub mod model_recommendations;
pub mod shards;
pub mod vram;
