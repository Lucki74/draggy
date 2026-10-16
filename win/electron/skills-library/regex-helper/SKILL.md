---
name: regex-helper
description: Builds, explains and tests regular expressions for a given flavour (JavaScript, Python, PCRE, .NET, grep), with examples that should and should not match. Use when the user needs a regex, wants one explained, or a pattern is not matching as expected.
---

# Regex helper

## Clarify

- The flavour: JavaScript, Python re, PCRE (PHP, grep -P), POSIX grep or sed, .NET, Java, Go (RE2, no lookarounds). Features differ.
- Exactly what should match and what should not, with examples. Ask for examples if the requirement is fuzzy; a regex without test cases is a guess.
- Whether it must match the whole string (anchors) or find matches inside text.

## Build

1. Start from the simplest pattern that matches the positive examples.
2. Tighten it until the negative examples fail.
3. Prefer explicit character classes to `.`; use `\b` for word boundaries; anchor with `^` and `$` for whole strings.
4. Use non-greedy quantifiers or negated classes (`[^"]*`) to avoid over-matching.
5. Avoid catastrophic backtracking: no nested quantifiers like `(a+)+` on user input.
6. Name groups when the flavour supports it.
7. Do not use regex for things it does badly (nested HTML, full email validation per RFC); suggest a parser or library instead.

## Test

- **In Code**, run the pattern against the examples with run_code (javascript or python, matching the flavour), printing each example and whether it matched and what was captured.
- **In Chat**, walk through two or three examples by hand.

## Output

1. The pattern in a code block, with flags.
2. A piece-by-piece explanation.
3. A table of test strings: expected, actual result.
4. A ready-to-use snippet in the user's language when relevant (with escaping correct for string literals).
