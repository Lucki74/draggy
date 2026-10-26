pub struct BrowserInput;

impl BrowserInput {
    pub fn sanitize_text(input: &str) -> String {
        input.trim().to_string()
    }
}
