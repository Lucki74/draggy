pub fn detect_system_locale() -> String {
    let lang = std::env::var("LANG").unwrap_or_else(|_| "en".to_string());
    if lang.starts_with("fr") {
        "fr".to_string()
    } else if lang.starts_with("es") {
        "es".to_string()
    } else if lang.starts_with("zh") {
        "zh".to_string()
    } else {
        "en".to_string()
    }
}
