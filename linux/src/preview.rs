//! HTML a model wrote, made safe to show. The preview runs no scripts and loads nothing from the network: the policy
//! allows inline styles and pictures that are part of the page, and nothing else.

/// Whether a code block's language is one to preview.
pub fn is_html(language: &str) -> bool {
    matches!(
        language.trim().to_ascii_lowercase().as_str(),
        "html" | "htm"
    )
}

const POLICY: &str = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/// The document to load into the preview: the model's markup under a policy that blocks scripts and requests.
pub fn page(code: &str) -> String {
    format!(
        "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"{POLICY}\">{code}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_blocks_are_previewed_in_any_case() {
        assert!(is_html("html"));
        assert!(is_html(" HTML "));
        assert!(!is_html("rust"));
        assert!(!is_html(""));
    }

    #[test]
    fn the_policy_comes_before_the_markup() {
        let page = page("<p>hi</p><script>x()</script>");
        let policy = page.find("Content-Security-Policy").unwrap();
        assert!(policy < page.find("<p>").unwrap());
        assert!(page.contains("default-src 'none'"));
    }
}
