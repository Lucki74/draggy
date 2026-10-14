//! Which URLs the model may fetch, and which permissions the app window holds. Port of electron/urlPolicy.cjs.

use std::net::Ipv6Addr;

use url::{Host, Url};

use crate::js::js_trim;

const ALLOWED_SCHEMES: [&str; 2] = ["http", "https"];

/// Hostnames that always mean this machine. Compared after lowercasing.
const PRIVATE_HOSTNAMES: [&str; 12] = [
    "localhost",
    "localhost.localdomain",
    "localhost4",
    "localhost4.localdomain4",
    "localhost6",
    "localhost6.localdomain6",
    "ip6-localhost",
    "ip6-loopback",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
];

const NOT_A_WEB_ADDRESS: &str =
    "That is not a valid web address. Only http:// and https:// pages can be read.";
const NO_HOST: &str = "That address has no host, so there is nothing to fetch.";
const LOCAL_NETWORK: &str = "Refused: that address is on this machine or its local network, which is not reachable from here. Only public web pages can be read.";

/// Why a URL was refused. The rule names match the ones the CJS logs.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Refusal {
    Empty,
    ControlChar,
    Invalid,
    Protocol(String),
    NoHost,
    PrivateHost(String),
}

impl Refusal {
    fn rule(&self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::ControlChar => "control_char",
            Self::Invalid => "invalid",
            Self::Protocol(_) => "protocol",
            Self::NoHost => "no_host",
            Self::PrivateHost(_) => "private_host",
        }
    }

    /// The same data the CJS logs next to the rule: the scheme with its colon, or the host.
    fn log(&self) {
        let rule = self.rule();
        match self {
            Self::Protocol(scheme) => {
                let scheme = format!("{scheme}:");
                tracing::debug!(target: "net.policy", rule, scheme, "url refused");
            }
            Self::PrivateHost(host) => {
                tracing::debug!(target: "net.policy", rule, host = host.as_str(), "url refused");
            }
            _ => tracing::debug!(target: "net.policy", rule, "url refused"),
        }
    }
}

/// Refusals this session, by the rule that refused. The quit path reads them once.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Refusals {
    pub empty: u64,
    pub control_char: u64,
    pub invalid: u64,
    pub protocol: u64,
    pub no_host: u64,
    pub private_host: u64,
}

impl Refusals {
    fn record(&mut self, refusal: &Refusal) {
        let counter = match refusal {
            Refusal::Empty => &mut self.empty,
            Refusal::ControlChar => &mut self.control_char,
            Refusal::Invalid => &mut self.invalid,
            Refusal::Protocol(_) => &mut self.protocol,
            Refusal::NoHost => &mut self.no_host,
            Refusal::PrivateHost(_) => &mut self.private_host,
        };
        *counter += 1;
    }
}

/// Decides which URLs may be fetched and keeps the session's refusal counts.
#[derive(Debug, Default)]
pub struct UrlPolicy {
    refusals: Refusals,
}

impl UrlPolicy {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether the app may fetch a URL. `allow_private` lets the user reach their own dev server; the model never sets it.
    pub fn is_fetchable_url(&mut self, value: &str, allow_private: bool) -> bool {
        match check(value, allow_private) {
            Ok(()) => true,
            Err(refusal) => {
                refusal.log();
                self.refusals.record(&refusal);
                false
            }
        }
    }

    /// The refusals so far, logged at INFO. The quit path calls this once.
    pub fn session_counts(&self) -> Refusals {
        let counts = self.refusals;
        tracing::info!(
            target: "net.policy",
            empty = counts.empty,
            control_char = counts.control_char,
            invalid = counts.invalid,
            protocol = counts.protocol,
            no_host = counts.no_host,
            private_host = counts.private_host,
            "url refusals this session"
        );
        counts
    }
}

fn check(value: &str, allow_private: bool) -> Result<(), Refusal> {
    let raw = js_trim(value);
    if raw.is_empty() {
        return Err(Refusal::Empty);
    }
    // A newline or NUL inside a scheme is a parser trick, not a typed URL.
    if raw.chars().any(|ch| ch <= '\u{1F}' || ch == '\u{7F}') {
        return Err(Refusal::ControlChar);
    }
    let url = Url::parse(raw).map_err(|_| Refusal::Invalid)?;
    let scheme = url.scheme();
    if !ALLOWED_SCHEMES.contains(&scheme) {
        return Err(Refusal::Protocol(scheme.to_owned()));
    }
    let host = url.host_str().unwrap_or_default();
    if host.is_empty() {
        return Err(Refusal::NoHost);
    }
    if !allow_private && is_private_hostname(host) {
        return Err(Refusal::PrivateHost(host.to_owned()));
    }
    Ok(())
}

/// Whether a hostname is this machine or its local network. Checked literally, so a name that resolves to loopback passes.
pub fn is_private_hostname(hostname: &str) -> bool {
    let lower = hostname.to_lowercase();
    // A trailing dot names the same host, so one is dropped before any check.
    let undotted = lower.strip_suffix('.').unwrap_or(lower.as_str());
    let host = undotted.strip_prefix('[').unwrap_or(undotted);
    let host = host.strip_suffix(']').unwrap_or(host);
    if PRIVATE_HOSTNAMES.contains(&host) || PRIVATE_HOSTNAMES.contains(&lower.as_str()) {
        return true;
    }
    // mDNS, and the suffix Chromium maps to loopback on its own.
    if host.ends_with(".local") || host.ends_with(".localhost") {
        return true;
    }
    if is_unique_local_ipv6(host) {
        return true;
    }
    if let Some(address) = ipv6_literal(host) {
        return ipv6_is_private(address);
    }
    if let Some(private) = ipv4_is_private(host) {
        return private;
    }
    false
}

/// `f[cd][0-9a-f]{2}:` at the start of a literal, the IPv6 unique-local range.
fn is_unique_local_ipv6(host: &str) -> bool {
    matches!(host.as_bytes(), [b'f', b'c' | b'd', x, y, b':', ..] if x.is_ascii_hexdigit() && y.is_ascii_hexdigit())
}

/// The address an IPv6 literal names, read by the URL parser so every spelling of one address agrees. `None` otherwise.
fn ipv6_literal(host: &str) -> Option<Ipv6Addr> {
    if !host.contains(':')
        || !host
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b':' || byte == b'.')
    {
        return None;
    }
    match Url::parse(&format!("http://[{host}]/")).ok()?.host()? {
        Host::Ipv6(address) => Some(address),
        _ => None,
    }
}

/// Loopback, unspecified and link-local IPv6, and IPv4-mapped addresses under the IPv4 rules.
fn ipv6_is_private(address: Ipv6Addr) -> bool {
    if address.is_loopback() || address.is_unspecified() {
        return true;
    }
    if address.segments()[0] & 0xffc0 == 0xfe80 {
        return true;
    }
    address
        .to_ipv4_mapped()
        .is_some_and(|mapped| ipv4_octets_are_private(mapped.octets().map(u32::from)))
}

/// `Some` for a dotted quad with 1 to 3 digits per part, `None` for anything else.
fn dotted_quad(host: &str) -> Option<[u32; 4]> {
    let mut octets = [0u32; 4];
    let mut count = 0;
    for part in host.split('.') {
        if count == 4
            || part.is_empty()
            || part.len() > 3
            || !part.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        octets[count] = part.parse().ok()?;
        count += 1;
    }
    (count == 4).then_some(octets)
}

/// The private IPv4 ranges. An octet above 255 is not an address, so it is not private either.
fn ipv4_is_private(host: &str) -> Option<bool> {
    let octets = dotted_quad(host)?;
    if octets.iter().any(|&octet| octet > 255) {
        return Some(false);
    }
    Some(ipv4_octets_are_private(octets))
}

fn ipv4_octets_are_private([a, b, _, _]: [u32; 4]) -> bool {
    // Link-local also holds every cloud provider's metadata service, 169.254.169.254.
    // Carrier-grade NAT is 100.64.0.0/10.
    a == 10
        || a == 127
        || a == 0
        || (a == 192 && b == 168)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 169 && b == 254)
        || (a == 100 && (64..=127).contains(&b))
}

/// Whether the app window may use a browser permission. The microphone is for its own window; clipboard writes only from its
/// own pages, never from a widget frame. The native shell reports the origin, as the CJS reads it from the frame.
pub fn permission_granted(permission: &str, from_app_window: bool, from_app_page: bool) -> bool {
    if !from_app_window {
        return false;
    }
    match permission {
        "media" => true,
        "clipboard-sanitized-write" => from_app_page,
        _ => false,
    }
}

/// Why a URL was refused, worded for the model. A refusal it cannot interpret reads as a transient failure.
pub fn refusal_for(value: &str) -> String {
    let raw = js_trim(value);
    let Ok(url) = Url::parse(raw) else {
        return NOT_A_WEB_ADDRESS.to_owned();
    };
    let scheme = url.scheme();
    if !ALLOWED_SCHEMES.contains(&scheme) {
        return format!(
            "Refused: {scheme}: addresses cannot be opened. Only http:// and https:// pages can be read, so local files and app-internal addresses are out of reach. Tell the user this rather than trying another way in."
        );
    }
    if url.host_str().unwrap_or_default().is_empty() {
        return NO_HOST.to_owned();
    }
    LOCAL_NETWORK.to_owned()
}
