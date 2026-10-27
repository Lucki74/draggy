pub struct BrowserDialogs;

impl BrowserDialogs {
    pub fn handle_alert(msg: &str) {
        println!("Browser Alert: {}", msg);
    }
}
