//! Which addresses the browser pane may open. Only public http and https pages; the refusal text is
//! worded for the model, as the Electron `urlPolicy` was.

use std::net::{Ipv4Addr, Ipv6Addr};

use tauri::Url;

const PRIVATE_HOSTNAMES: &[&str] = &[
    "localhost",
    "localhost.localdomain",
    "localhost4",
    "localhost4.localdomain4",
    "localhost6",
    "localhost6.localdomain6",
    "ip6-localhost",
    "ip6-loopback",
    "0.0.0.0",
    "127.0.0.1",
    "::1",
];

/// The URL to load, or the sentence to tell the model why it was refused.
pub fn check(raw: &str) -> Result<Url, &'static str> {
    let trimmed = raw.trim();
    if trimmed.chars().any(|c| c.is_ascii_control()) {
        return Err(INVALID);
    }
    let url = Url::parse(trimmed).map_err(|_| INVALID)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(PROTOCOL);
    }
    let Some(host) = url.host_str().filter(|h| !h.is_empty()) else {
        return Err(NO_HOST);
    };
    if is_private_host(host) {
        return Err(PRIVATE);
    }
    Ok(url)
}

pub const INVALID: &str =
    "That is not a valid web address. Only http:// and https:// pages can be read.";
pub const PROTOCOL: &str = "Refused: that address scheme cannot be opened. Only http:// and https:// pages can be read, so local files and app-internal addresses are out of reach. Tell the user this rather than trying another way in.";
pub const NO_HOST: &str = "That address has no host, so there is nothing to fetch.";
pub const PRIVATE: &str = "Refused: that address is on this machine or its local network, which is not reachable from here. Only public web pages can be read.";

/// True for names and literals on this machine or its network. Checked literally, as Electron did.
pub fn is_private_host(host: &str) -> bool {
    let lower = host.to_ascii_lowercase();
    let bare = lower
        .trim_end_matches('.')
        .trim_start_matches('[')
        .trim_end_matches(']');
    if PRIVATE_HOSTNAMES.contains(&lower.as_str()) || PRIVATE_HOSTNAMES.contains(&bare) {
        return true;
    }
    if bare.ends_with(".local") || bare.ends_with(".localhost") {
        return true;
    }
    if let Ok(v4) = bare.parse::<Ipv4Addr>() {
        return private_v4(v4);
    }
    if let Ok(v6) = bare.parse::<Ipv6Addr>() {
        return match v6.to_ipv4_mapped() {
            Some(v4) => private_v4(v4),
            None => private_v6(v6),
        };
    }
    false
}

fn private_v4(addr: Ipv4Addr) -> bool {
    let [a, b, ..] = addr.octets();
    matches!(a, 0 | 10 | 127)
        || (a == 192 && b == 168)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 169 && b == 254)
        || (a == 100 && (64..=127).contains(&b))
}

fn private_v6(addr: Ipv6Addr) -> bool {
    let first = addr.segments()[0];
    addr.is_loopback()
        || addr.is_unspecified()
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_web_addresses_pass() {
        assert!(check("https://example.com/a?b=1").is_ok());
        assert!(check("http://93.184.216.34/").is_ok());
    }

    #[test]
    fn other_schemes_are_refused_with_the_protocol_sentence() {
        assert_eq!(check("file:///C:/Users/x/.aws/credentials"), Err(PROTOCOL));
        assert_eq!(check("tauri://localhost/"), Err(PROTOCOL));
    }

    #[test]
    fn private_and_local_hosts_are_refused() {
        for raw in [
            "http://localhost:8080/",
            "http://127.0.0.1/",
            "http://10.1.2.3/",
            "http://192.168.0.1/",
            "http://172.20.0.1/",
            "http://169.254.169.254/latest",
            "http://100.64.0.1/",
            "http://[::1]/",
            "http://[fd00::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://printer.local/",
            "http://app.localhost/",
            "http://localhost./",
        ] {
            assert_eq!(check(raw), Err(PRIVATE), "{raw}");
        }
    }

    #[test]
    fn malformed_and_control_character_addresses_are_invalid() {
        assert_eq!(check(""), Err(INVALID));
        assert_eq!(check("not a url"), Err(INVALID));
        assert_eq!(check("https://exa\nmple.com/"), Err(INVALID));
    }

    #[test]
    fn public_ranges_next_to_private_ones_pass() {
        assert!(!is_private_host("172.32.0.1"));
        assert!(!is_private_host("100.128.0.1"));
        assert!(!is_private_host("[2001:db8::1]"));
    }
}
