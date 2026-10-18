//! The MCP client's pure parts: the server catalogue, registry parsing, OAuth helpers and the streamable HTTP transport.
//! Every network call goes through the [`net::Http`] trait, so tests answer with canned responses.

pub mod catalogue;
pub mod child_process;
pub mod definition;
pub mod http;
pub mod js;
pub mod lines;
pub mod log;
pub mod names;
pub mod net;
pub mod oauth;
pub mod ports;
pub mod process;
pub mod provision;
pub mod registry;
pub mod reqwest_net;
pub mod result;
pub mod server;
pub mod signin;
pub mod stdio;
