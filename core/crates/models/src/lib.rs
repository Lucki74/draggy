//! Model metadata: what a GGUF header says about a model, the companion files beside it, and the rung
//! of the ladder a machine can run. The model hub, downloads, the models folder and the cache sit beside it.

pub mod download;
pub mod draft_model;
pub mod draft_pairing;
pub mod gguf;
pub mod huggingface;
mod js;
pub mod mmproj;
pub mod model_cache;
pub mod model_kinds;
pub mod model_recommendations;
pub mod model_storage;
pub mod shards;
pub mod vram;
