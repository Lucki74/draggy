//! Web policy, search and connectivity.
//! Network I/O goes through `http::HttpClient`, so tests run on canned responses.
//!
//! # Not ported
//!
//! - Page scripts and the readiness wait. Scraped pages are parsed as received. The native shells will supply a rendered page later.
//! - The `UrlPolicy` re-check on search page redirects. Page reads in `page` check each hop; the search pages and the shared reqwest client do not.
//! - Relative links resolve against the requested URL, not the final one.
//! - Lone-surrogate and out-of-range-number JSON that `JSON.parse` accepts.
//! - Permissions the native shell must enforce: media from the app window, and clipboard-sanitized-write from app pages only.

pub mod connectivity;
pub mod http;
mod js;
pub mod page;
pub mod policy;
pub mod readable;
pub mod search;
pub mod sources;
