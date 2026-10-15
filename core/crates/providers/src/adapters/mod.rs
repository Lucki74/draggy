//! One adapter per wire protocol. Each builds the provider's request from the neutral chat request and turns the
//! provider's streamed or whole answer back into neutral events. None of them sends anything itself.

pub mod anthropic;
pub mod common;
pub mod gemini;
pub mod ollama;
pub mod openai;
