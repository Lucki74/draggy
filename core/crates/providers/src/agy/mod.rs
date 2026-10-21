//! A Google account through the Antigravity CLI (`agy`) in headless mode: one process per turn, text only. The pure
//! parts live here; the host starts the process. See `win/electron/providers/google/MODE.md` for the terms warning.

pub mod adapter;
pub mod failure;
