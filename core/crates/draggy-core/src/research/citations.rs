//! Checks that quotes attributed to a source actually appear in the fetched page text.
//! Both sides go through the same normalisation so typography differences cannot cause false misses.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CitationVerdict {
    Verified,
    Near,
    Unverified,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Citable {
    pub id: String,
    pub claim: String,
    pub quote: String,
    pub source_id: String,
}

const MIN_QUOTE_WORDS: usize = 3;
/// Capped so a huge scraped page cannot make the quadratic scan run for seconds.
const MAX_PAGE_CHARS: usize = 400_000;
const NEAR_THRESHOLD: f64 = 0.6;

/// Reduces text to lowercase letters, digits and single spaces so typography cannot break a match.
/// NFKC folding is not applied: draggy-core has no normalisation crate, so fullwidth forms do not fold.
pub fn normalise_for_match(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.to_lowercase().chars() {
        match c {
            '\'' | '‘' | '’' | '‚' | '‛' | '′' => {}
            c if c.is_alphanumeric() => out.push(c),
            _ => out.push(' '),
        }
    }
    split_words(&out).join(" ")
}

/// True when the quote appears verbatim in the page as whole words after normalisation.
pub fn quote_appears(quote: &str, page: &str) -> bool {
    let needle = normalise_for_match(quote);
    if needle.is_empty() || split_words(&needle).len() < MIN_QUOTE_WORDS {
        return false;
    }
    // Space padding stops a short quote from matching inside a longer word.
    format!(" {} ", normalise_for_match(page)).contains(&format!(" {needle} "))
}

/// Returns the longest contiguous run of quote words found in the page, as a share of the quote.
pub fn best_match_ratio(quote: &str, page: &str) -> f64 {
    let normalised_quote = normalise_for_match(quote);
    let quote_words = split_words(&normalised_quote);
    if quote_words.is_empty() {
        return 0.0;
    }
    let capped: String = page.chars().take(MAX_PAGE_CHARS).collect();
    let normalised_page = normalise_for_match(&capped);
    let page_words = split_words(&normalised_page);

    let width = page_words.len() + 1;
    let mut prev = vec![0u32; width];
    let mut curr = vec![0u32; width];
    let mut best = 0u32;
    for word in &quote_words {
        curr.iter_mut().for_each(|cell| *cell = 0);
        for j in 1..width {
            if *word == page_words[j - 1] {
                curr[j] = prev[j - 1] + 1;
                best = best.max(curr[j]);
            }
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    f64::from(best) / quote_words.len() as f64
}

/// Verified when the quote appears verbatim, near when most of its words do, otherwise unverified.
pub fn judge_citation(quote: &str, page: &str) -> CitationVerdict {
    judge_citation_at(quote, page, NEAR_THRESHOLD)
}

/// As `judge_citation`, with an explicit share of words that counts as near.
pub fn judge_citation_at(quote: &str, page: &str, near_threshold: f64) -> CitationVerdict {
    if quote_appears(quote, page) {
        return CitationVerdict::Verified;
    }
    if split_words(&normalise_for_match(quote)).len() < MIN_QUOTE_WORDS {
        return CitationVerdict::Unverified;
    }
    if best_match_ratio(quote, page) >= near_threshold {
        CitationVerdict::Near
    } else {
        CitationVerdict::Unverified
    }
}

/// Judges every note against the page of its source. A missing page is unverified.
pub fn verify_citations(notes: &[Citable], pages: &HashMap<String, String>) -> HashMap<String, CitationVerdict> {
    notes
        .iter()
        .map(|note| {
            let verdict = match pages.get(&note.source_id) {
                Some(page) => judge_citation(&note.quote, page),
                None => CitationVerdict::Unverified,
            };
            (note.id.clone(), verdict)
        })
        .collect()
}

fn split_words(normalised: &str) -> Vec<&str> {
    normalised.split(' ').filter(|word| !word.is_empty()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalise_for_match_collapses_whitespace_and_strips_punctuation() {
        assert_eq!(normalise_for_match("  Hello,   world!\n\tagain.  "), "hello world again");
    }

    #[test]
    #[ignore = "needs NFKC folding; unicode-normalization is not a draggy-core dependency"]
    fn normalise_for_match_folds_fullwidth_forms_through_nfkc() {
        assert_eq!(normalise_for_match("ＡＢＣ test"), "abc test");
    }

    #[test]
    fn quote_appears_ignores_whitespace_and_punctuation_differences() {
        let page = "The results however were clear and widely reported.";
        assert!(quote_appears("The  results,   however: were clear", page));
    }

    #[test]
    fn quote_appears_matches_curly_quotes_against_straight_quotes() {
        let page = "She said it's a \"fine\" result today in the report.";
        assert!(quote_appears("she said it’s a “fine” result today", page));
    }

    #[test]
    fn quote_appears_matches_en_dash_against_hyphen() {
        assert!(quote_appears(
            "state–of–the–art research methods",
            "We use state-of-the-art research methods here."
        ));
    }

    #[test]
    fn quote_appears_ignores_case_differences() {
        assert!(quote_appears("THE GREAT WALL stands", "the great wall stands tall"));
    }

    #[test]
    fn quote_appears_rejects_a_two_word_quote() {
        assert!(!quote_appears("climate change", "Climate change is real and urgent."));
    }

    #[test]
    fn quote_appears_rejects_a_reworded_quote() {
        let page = "Members decided to postpone the decision until spring.";
        assert!(!quote_appears("the council voted to delay the vote", page));
    }

    #[test]
    fn quote_appears_does_not_match_inside_a_longer_word() {
        assert!(!quote_appears("cat sat down", "concat sat down there"));
    }

    #[test]
    fn quote_appears_rejects_an_empty_quote() {
        assert!(!quote_appears("", "some page text here"));
        assert!(!quote_appears("   ", "some page text here"));
    }

    #[test]
    fn quote_appears_matches_french_accents_and_apostrophes() {
        let page = "Hier, le café où l’élève réfléchit longtemps, près de la gare.";
        assert!(quote_appears("Le café où l'élève réfléchit longtemps", page));
    }

    #[test]
    #[ignore = "needs NFKC composition; unicode-normalization is not a draggy-core dependency"]
    fn quote_appears_matches_decomposed_and_composed_french_accents() {
        assert!(quote_appears("le café est ouvert", "Ici le café est ouvert le matin."));
    }

    #[test]
    fn quote_appears_matches_russian_cyrillic_text() {
        let page = "Сегодня: привет мир, это тестовая цитата в статье.";
        assert!(quote_appears("Привет, мир! Это тестовая цитата.", page));
    }

    #[test]
    fn best_match_ratio_returns_1_for_a_verbatim_quote() {
        assert_eq!(best_match_ratio("one two three four", "x one two three four y"), 1.0);
    }

    #[test]
    fn best_match_ratio_returns_0_when_no_words_overlap() {
        assert_eq!(best_match_ratio("alpha beta gamma", "delta epsilon zeta"), 0.0);
    }

    #[test]
    fn best_match_ratio_returns_0_for_an_empty_quote() {
        assert_eq!(best_match_ratio("", "some page"), 0.0);
    }

    #[test]
    fn best_match_ratio_ignores_text_beyond_the_400000_character_cap() {
        let page = "a".repeat(400_000) + " the quick brown fox jumps";
        assert_eq!(best_match_ratio("the quick brown fox jumps", &page), 0.0);
    }

    #[test]
    fn judge_citation_gives_near_when_one_word_at_the_end_changed() {
        let quote = "the committee approved the new budget for the coming fiscal year";
        let page = "the committee approved the new budget for the coming fiscal quarter";
        assert_eq!(judge_citation(quote, page), CitationVerdict::Near);
    }

    #[test]
    fn judge_citation_gives_unverified_when_the_near_threshold_is_not_reached() {
        let quote = "the committee approved the new budget for the coming fiscal year";
        let page = "the committee adopted the new budget for the coming fiscal year";
        assert_eq!(judge_citation_at(quote, page, 0.9), CitationVerdict::Unverified);
    }

    #[test]
    fn judge_citation_gives_verified_for_an_exact_quote() {
        assert_eq!(
            judge_citation("the new budget was approved", "Yes: the new budget was approved."),
            CitationVerdict::Verified
        );
    }

    fn sample_notes() -> Vec<Citable> {
        let note = |id: &str, claim: &str, quote: &str, source_id: &str| Citable {
            id: id.to_owned(),
            claim: claim.to_owned(),
            quote: quote.to_owned(),
            source_id: source_id.to_owned(),
        };
        vec![
            note("n1", "c1", "the new budget was approved", "s1"),
            note("n2", "c2", "an exact sentence from nowhere", "s2"),
            note("n3", "c3", "some quote text here", "missing"),
        ]
    }

    #[test]
    fn verify_citations_judges_each_note_against_its_source_page() {
        let pages = HashMap::from([
            ("s1".to_owned(), "Report: the new budget was approved in May.".to_owned()),
            ("s2".to_owned(), "Completely unrelated content about gardens.".to_owned()),
        ]);
        let verdicts = verify_citations(&sample_notes(), &pages);
        assert_eq!(verdicts.get("n1"), Some(&CitationVerdict::Verified));
        assert_eq!(verdicts.get("n2"), Some(&CitationVerdict::Unverified));
    }

    #[test]
    fn verify_citations_marks_a_note_with_no_page_as_unverified() {
        let verdicts = verify_citations(&sample_notes(), &HashMap::new());
        assert_eq!(verdicts.get("n3"), Some(&CitationVerdict::Unverified));
        assert_eq!(verdicts.len(), 3);
    }

    #[test]
    fn quote_appears_matches_a_hyphenated_phrase_against_spaced_words() {
        assert!(quote_appears("a well-known result here", "It is a well known result here."));
    }

    #[test]
    fn judge_citation_gives_unverified_for_a_two_word_quote_even_when_it_appears() {
        assert_eq!(judge_citation("borrow checker", "The borrow checker runs."), CitationVerdict::Unverified);
    }
}
