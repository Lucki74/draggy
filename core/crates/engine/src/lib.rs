//! Local inference engine: which llama.cpp build a machine runs, how it is installed and updated, the hardware it runs
//! on, and what its output and failures say. Shells run the processes; this crate decides what to run.

pub mod binary_manager;
pub mod colibri_runtime;
pub mod command;
pub mod cpu_topology;
pub mod engine_host;
pub mod engine_updater;
pub mod failure;
pub mod hardware_probe;
mod js;
pub mod llama_args;
pub mod llama_draft_stats;
pub mod llama_flags;
pub mod llama_health;
pub mod llama_output;
pub mod llama_process;
pub mod mlx_runtime;
pub mod platform;
pub mod sd_runner;
pub mod supervisor;
pub mod vram_probe;
