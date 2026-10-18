//! The URL policy for the shell's browser pane, the same rules the model's page reads follow.

use draggy_web::policy::{UrlPolicy, refusal_for};

/// Whether the browser pane may load an address. Only http and https pages with a host are allowed.
/// `allow_private` lets the user open their own dev server on localhost or the local network; navigation the
/// model starts must pass `false`.
#[uniffi::export]
pub fn web_address_allowed(address: String, allow_private: bool) -> bool {
    UrlPolicy::new().is_fetchable_url(&address, allow_private)
}

/// Why an address was refused, in a sentence for the user. Empty when the address is allowed.
#[uniffi::export]
pub fn web_address_refusal(address: String, allow_private: bool) -> String {
    if web_address_allowed(address.clone(), allow_private) {
        String::new()
    } else {
        refusal_for(&address)
    }
}
