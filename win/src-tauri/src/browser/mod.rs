//! Browser pane support: key parsing, the URL policy, pane geometry and tabs, and the CDP layer that
//! the pane's page answers to. The child webviews are created in `ipc::browser`.

pub mod act;
pub mod cdp;
#[cfg(windows)]
pub mod cdp_webview2;
pub mod dialogs;
pub mod elements;
pub mod keys;
pub mod observe;
pub mod pages;
pub mod pane;
pub mod policy;
pub mod safety;
pub mod trace;
