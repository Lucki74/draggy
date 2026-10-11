// Detects runaway token loops and degenerate repetitive phrases in model streams.
export interface RepetitionResult {
  hasLoop: boolean;
  pattern?: string;
  repeatCount?: number;
  trimmedText: string;
}

const REDACTED_MARKER = /==\s*\[REDACTED\]\s*==/gi;
// Whitespace is allowed so a spaced separator such as `| :--- | :--- |` counts as structure, not as a loop.
const REPEATED_CHAR_LINE = /^[\s\-=~*#_`|/\\.,;:{}()[\]<>]+$/;
// A comparison table repeats its cells legitimately, so a row must repeat far more before it is a loop.
const TABLE_ROW_MIN_REPEATS = 20;

/** Scans the end of a stream for degenerate repetition and returns the cleaned text. */
export function detectRepetition(text: string): RepetitionResult {
  if (!text || text.length < 20) {
    return { hasLoop: false, trimmedText: text };
  }

  // Refusal or redaction loops where a model repeatedly emits safety placeholders.
  const redactedMatches = [...text.matchAll(REDACTED_MARKER)];
  if (redactedMatches.length >= 2) {
    const firstIdx = redactedMatches[0].index ?? 0;
    const trimmed = text.slice(0, firstIdx).trimEnd();
    return {
      hasLoop: true,
      pattern: "== [REDACTED] ==",
      repeatCount: redactedMatches.length,
      trimmedText: trimmed || text.slice(0, redactedMatches[1].index ?? 0).trimEnd(),
    };
  }

  const lines = text.split("\n");
  if (lines.length >= 3) {
    let endIdx = lines.length - 1;
    while (endIdx >= 0 && !lines[endIdx].trim()) {
      endIdx--;
    }

    if (endIdx >= 2) {
      const lastLine = lines[endIdx].trim();
      if (lastLine.length >= 4 && !REPEATED_CHAR_LINE.test(lastLine)) {
        let count = 0;
        let scanIdx = endIdx;
        while (scanIdx >= 0) {
          const current = lines[scanIdx].trim();
          if (current === lastLine) {
            count++;
            scanIdx--;
          } else if (current === "") {
            scanIdx--;
          } else {
            break;
          }
        }

        if (count >= 3) {
          const keepLines = lines.slice(0, scanIdx + 2);
          return {
            hasLoop: true,
            pattern: lastLine,
            repeatCount: count,
            trimmedText: keepLines.join("\n").trimEnd(),
          };
        }
      }

      // Multi-line block repetition loops (e.g. repeated question/answer or table rows).
      for (const blockSize of [2, 3]) {
        if (endIdx + 1 >= blockSize * 3) {
          const block = lines.slice(endIdx - blockSize + 1, endIdx + 1).map((l) => l.trim()).join("\n");
          if (block.length >= 8) {
            let blockCount = 1;
            let checkIdx = endIdx - blockSize;
            while (checkIdx - blockSize + 1 >= 0) {
              const prevBlock = lines.slice(checkIdx - blockSize + 1, checkIdx + 1).map((l) => l.trim()).join("\n");
              if (prevBlock === block) {
                blockCount++;
                checkIdx -= blockSize;
              } else {
                break;
              }
            }
            if (blockCount >= 3) {
              const firstEnd = endIdx - (blockCount - 1) * blockSize;
              const keepLines = lines.slice(0, firstEnd + 1);
              return {
                hasLoop: true,
                pattern: block,
                repeatCount: blockCount,
                trimmedText: keepLines.join("\n").trimEnd(),
              };
            }
          }
        }
      }
    }
  }

  // Trailing phrase repetition loop within the most recent window.
  const windowSize = Math.min(text.length, 1000);
  const tail = text.slice(-windowSize);
  const minRepeats = text.slice(text.lastIndexOf("\n") + 1).trimStart().startsWith("|") ? TABLE_ROW_MIN_REPEATS : 3;

  for (let len = 4; len <= 120; len++) {
    if (tail.length < len * minRepeats) break;
    const candidate = tail.slice(-len);
    const trimmedCandidate = candidate.trim();

    if (trimmedCandidate.length < 3 || REPEATED_CHAR_LINE.test(trimmedCandidate)) {
      continue;
    }

    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:${escaped}\\s*){${minRepeats},}$`);
    const match = tail.match(regex);
    if (match && match.index !== undefined) {
      const matchStartInTail = match.index;
      const fullMatchStart = text.length - windowSize + matchStartInTail;
      const trimmed = text.slice(0, fullMatchStart) + candidate;
      return {
        hasLoop: true,
        pattern: trimmedCandidate,
        repeatCount: 3,
        trimmedText: trimmed.trimEnd(),
      };
    }
  }

  return { hasLoop: false, trimmedText: text };
}
