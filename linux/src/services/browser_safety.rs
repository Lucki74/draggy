pub struct BrowserSafety;

impl BrowserSafety {
    pub fn is_allowed_scheme(url: &str) -> bool {
        url.starts_with("http://") || url.starts_with("https://")
    }
}
