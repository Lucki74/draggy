//! The provider layer: the neutral chat types, the adapters that turn them into each provider's request and back
//! into neutral events, the catalog, model listings, the registry, the signed catalog and local discovery.
//! Network and storage are traits, so the crate never opens a socket or a database on its own.

pub mod account;
pub mod agy;
pub mod adapters;
pub mod catalog;
pub mod claude;
pub mod codex;
pub mod discovery;
pub mod errors;
pub mod gateway;
pub mod http;
pub mod install_fs;
pub mod js;
pub mod models;
pub mod registry;
pub mod remote_catalog;
pub mod rpc;
pub mod sse;
pub mod types;
