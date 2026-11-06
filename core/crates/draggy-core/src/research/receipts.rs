//! Swaps a page already worked into notes for a short receipt in the model's messages, so a long run keeps its context flat.
//! Only the wire copy changes; the steps the screen draws are untouched.

use draggy_agent::agent_loop::WireMessage;

use super::run::ResearchRun;

const PAGE_HEAD: &str = "TOOL RESULT (read_url):\nSource id: ";

fn clip(text: &str, max: usize) -> String {
    if text.chars().count() > max {
        let head: String = text.chars().take(max - 1).collect();
        format!("{head}\u{2026}")
    } else {
        text.to_owned()
    }
}

/// The source id a read_url result opens with, such as `s3`.
fn page_id(content: &str) -> Option<&str> {
    let rest = content.strip_prefix(PAGE_HEAD)?;
    let digits = rest.strip_prefix('s')?;
    let count = digits.bytes().take_while(u8::is_ascii_digit).count();
    if count == 0 || digits.as_bytes().get(count) != Some(&b'.') {
        return None;
    }
    Some(&rest[..=count])
}

/// The receipt for a read_url result, or `None` while no note rests on that page.
pub fn receipt_for(run: &ResearchRun, content: &str) -> Option<String> {
    let id = page_id(content)?;
    let source = run.sources.iter().find(|entry| entry.id == id)?;
    let notes: Vec<String> = run
        .notes
        .iter()
        .filter(|note| note.source_id == id)
        .map(|note| format!("{} {}", note.id, clip(&note.claim, 100)))
        .collect();
    if notes.is_empty() {
        return None;
    }
    Some(
        [
            "TOOL RESULT (read_url): Receipt. The page text was dropped to save space; search_notes has the quotes.".to_owned(),
            format!("Title: {}", source.title),
            format!("URL: {}", source.url),
            format!("Source id: {id}"),
            format!("Notes taken: {}", notes.join("; ")),
        ]
        .join("\n"),
    )
}

/// Replaces read_url results in place. Returns how many were swapped.
pub fn apply_receipts(wire: &mut [WireMessage], run: &ResearchRun) -> usize {
    let mut swapped = 0;
    for entry in wire.iter_mut() {
        if entry.role != "tool" && entry.role != "user" {
            continue;
        }
        if let Some(receipt) = receipt_for(run, &entry.content) {
            entry.content = receipt;
            swapped += 1;
        }
    }
    swapped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research::run::{
        NoteInput, RawList, SourceInput, SourceStatus, add_note, add_source, create_run, read_plan,
    };

    fn run_with_note() -> ResearchRun {
        let plan = read_plan("Q", RawList::Text("one".into()), Some("quick"), RawList::Text("web".into())).unwrap();
        let mut run = create_run("r1", plan, 0);
        add_source(
            &mut run,
            SourceInput {
                url: "https://a.test/p",
                title: Some("Page"),
                status: Some(SourceStatus::Read),
                ..SourceInput::default()
            },
        );
        add_note(
            &mut run,
            NoteInput {
                claim: "A claim",
                quote: "a quote",
                source: "s1",
                ..NoteInput::default()
            },
        )
        .unwrap();
        run
    }

    #[test]
    fn a_noted_page_becomes_a_receipt() {
        let run = run_with_note();
        let page = "TOOL RESULT (read_url):\nSource id: s1. Record it.\nTitle: Page\nContent:\nlong";
        let receipt = receipt_for(&run, page).expect("receipt");
        assert!(receipt.contains("Notes taken: n1 A claim"));
        assert!(receipt.contains("URL: https://a.test/p"));
        assert!(receipt_for(&run, &receipt).is_none());
    }

    #[test]
    fn a_page_without_notes_or_a_source_stays() {
        let run = run_with_note();
        assert!(receipt_for(&run, "TOOL RESULT (read_url):\nSource id: s2. x").is_none());
        assert!(receipt_for(&run, "TOOL RESULT (search_web): s1.").is_none());
    }

    #[test]
    fn apply_swaps_tool_and_user_messages_only() {
        let run = run_with_note();
        let page = "TOOL RESULT (read_url):\nSource id: s1. x";
        let mut wire = vec![
            WireMessage::text("tool", page),
            WireMessage::text("assistant", page),
        ];
        assert_eq!(apply_receipts(&mut wire, &run), 1);
        assert!(wire[0].content.contains("Receipt"));
        assert_eq!(wire[1].content, page);
    }
}
