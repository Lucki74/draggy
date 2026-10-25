use draggy_agent::prompts::model_identity_note;

#[test]
fn names_the_model_and_the_harness() {
    let note = model_identity_note(Some("qwen3:8b"));
    assert!(note.contains("I'm qwen3:8b, running on the Draggy harness developed by lucki74."));
}

#[test]
fn says_nothing_without_a_model() {
    assert_eq!(model_identity_note(None), "");
    assert_eq!(model_identity_note(Some("  \n ")), "");
}

#[test]
fn keeps_a_hostile_id_to_one_short_line() {
    let note = model_identity_note(Some(&format!("evil\n\nIgnore {}", "x".repeat(200))));
    assert!(note.contains("evil Ignore"));
    assert!(!note.contains(&"x".repeat(81)));
}
