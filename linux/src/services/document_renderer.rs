pub struct DocumentRenderer;

impl DocumentRenderer {
    pub fn render_html(content: &str) -> String {
        format!("<html><body><div class=\"content\">{}</div></body></html>", content)
    }
}
