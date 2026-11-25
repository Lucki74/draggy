---
name: regex-helper
description: Builds, explains and tests regular expressions for a given flavour (JavaScript, Python, PCRE, .NET, grep), with examples that should and should not match. Use when the user needs a regex, wants one explained, or a pattern is not matching as expected.
---

# Regex helper

## Goal

Deliver a pattern that matches exactly what the user needs, shown against test strings, with a plain explanation and a snippet they can paste.

## When to use

- The user needs a regular expression written.
- The user wants an existing regex explained.
- A pattern is not matching, or matches too much.

## Steps

1. Clarify:
   - The flavour: JavaScript, Python re, PCRE (PHP, grep -P), POSIX grep or sed, .NET, Java, or Go (RE2, no lookarounds). Features differ.
   - What should match and what should not, with examples. Ask for examples if the requirement is fuzzy.
   - Whether it must match the whole string (anchors) or find matches inside text.
2. Start from the simplest pattern that matches the positive examples, then tighten it until the negative examples fail.
3. Prefer explicit character classes to `.`, use `\b` for word boundaries, and anchor with `^` and `$` for whole strings.
4. Use non-greedy quantifiers or negated classes such as `[^"]*` to avoid over-matching.
5. Name groups when the flavour supports it.
6. If regex is the wrong tool (nested HTML, full email validation per RFC), say so and suggest a parser or library.
7. Test:
   - In Code, run the pattern against the examples with `run_command` (javascript or python, matching the flavour), printing each example, whether it matched and what was captured.
   - In Chat, walk through two or three examples by hand.

## Gotchas

- A regex without test cases is a guess. Get examples first.
- Nested quantifiers like `(a+)+` on user input cause catastrophic backtracking.
- The same pattern behaves differently across flavours, for example lookarounds in RE2 or `\d` matching non-ASCII digits in some engines.
- Escaping differs between a regex and a string literal. Double the backslashes in the snippet where the language requires it.
- `.` does not match newlines by default, and `^` and `$` change meaning with the multiline flag.

## Output

1. The pattern in a code block, with flags.
2. A piece-by-piece explanation.
3. A table of test strings with expected and actual results.
4. A ready-to-use snippet in the user's language when relevant, with escaping correct for string literals.
