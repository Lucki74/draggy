use super::browser_safety::BrowserSafety;
use webkit6::prelude::*;
use webkit6::WebView;

pub struct BrowserControl;

impl BrowserControl {
    pub fn navigate(view: &WebView, url: &str) {
        if BrowserSafety::is_allowed_scheme(url) {
            view.load_uri(url);
        }
    }

    pub fn reload(view: &WebView) {
        view.reload();
    }

    pub fn go_back(view: &WebView) {
        if view.can_go_back() {
            view.go_back();
        }
    }

    pub fn go_forward(view: &WebView) {
        if view.can_go_forward() {
            view.go_forward();
        }
    }
}
