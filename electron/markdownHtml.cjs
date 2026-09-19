const { isHtml } = require("./htmlDocument.cjs");

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/** Emphasis, code spans and links. Code spans come out first and go back last, so a document about
 * Markdown can show the syntax it is describing. */
function inlineHtml(text) {
  const spans = [];

  let working = String(text).replace(/`([^`]+)`/g, (whole, code) => {
    spans.push(`<code>${escapeHtml(code)}</code>`);
    // A NUL sentinel, not a number in spaces: "I have 3 apples" would
    // otherwise put the fourth code span in the middle of a sentence.
    return `\u0000${spans.length - 1}\u0000`;
  });

  working = escapeHtml(working);

  working = working
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // Only http and https become links. A `javascript:` or `file:` href in a
  // document nobody wrote by hand is never what was meant.
  working = working.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (whole, label, href) =>
      /^https?:\/\//i.test(href)
        ? `<a href="${href}">${label}</a>`
        : label,
  );

  // The NUL is the point: nothing a model writes can collide with it.
  // eslint-disable-next-line no-control-regex
  return working.replace(/\u0000(\d+)\u0000/g, (whole, index) => spans[Number(index)]);
}

function tableRowCells(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const ALIGNMENT_ROW = /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/;

function isTableRow(line) {
  return line.includes("|") && line.trim().length > 0;
}

/** Turns a document into HTML, one block at a time. A line walk, not a parser: the only state
 * carried is whether a list or fence is open. */
function markdownToHtml(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];

  let listTag = null;
  let index = 0;

  const closeList = () => {
    if (listTag) {
      out.push(`</${listTag}>`);
      listTag = null;
    }
  };

  const openList = (tag) => {
    if (listTag !== tag) {
      closeList();
      out.push(`<${tag}>`);
      listTag = tag;
    }
  };

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trim();

    // Fenced code, kept verbatim to the closing fence or the end.
    const fence = line.match(/^```+\s*([a-zA-Z0-9+#-]*)\s*$/);
    if (fence) {
      closeList();
      const body = [];
      index++;
      while (index < lines.length && !/^```+\s*$/.test(lines[index].trim())) {
        body.push(lines[index]);
        index++;
      }
      index++;

      const language = fence[1] ? ` data-language="${escapeHtml(fence[1])}"` : "";
      out.push(`<pre${language}><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    if (line === "") {
      closeList();
      index++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      closeList();
      out.push("<hr />");
      index++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineHtml(heading[2])}</h${level}>`);
      index++;
      continue;
    }

    // A table needs its separator row to be a table at all; without it those
    // pipes are just punctuation in a sentence.
    if (
      isTableRow(line) &&
      index + 1 < lines.length &&
      ALIGNMENT_ROW.test(lines[index + 1]) &&
      lines[index + 1].includes("-")
    ) {
      closeList();

      const header = tableRowCells(line);
      index += 2;

      const body = [];
      while (index < lines.length && isTableRow(lines[index]) && lines[index].trim()) {
        body.push(tableRowCells(lines[index]));
        index++;
      }

      const head = header.map((cell) => `<th>${inlineHtml(cell)}</th>`).join("");
      const rows = body
        .map(
          (cells) =>
            `<tr>${cells.map((cell) => `<td>${inlineHtml(cell)}</td>`).join("")}</tr>`,
        )
        .join("");

      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inlineHtml(quote[1])}</blockquote>`);
      index++;
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      openList("ol");
      out.push(`<li>${inlineHtml(ordered[1])}</li>`);
      index++;
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      openList("ul");
      out.push(`<li>${inlineHtml(bullet[1])}</li>`);
      index++;
      continue;
    }

    closeList();
    out.push(`<p>${inlineHtml(line)}</p>`);
    index++;
  }

  closeList();
  return out.join("\n");
}

/** The stylesheet the PDF is laid out with. Aimed at print: page breaks kept out of headings and
 * code, and tables that repeat their header across pages. */
const PRINT_STYLES = `
  @page { size: A4; margin: 18mm 16mm 16mm 16mm; }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: Aptos, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.55;
    color: #111;
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: "Aptos Display", Aptos, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #0f4761;
    line-height: 1.25;
    margin: 1.4em 0 0.5em;
    break-after: avoid;
    page-break-after: avoid;
  }

  h1 { font-size: 20pt; margin-top: 0; }
  h2 { font-size: 15pt; }
  h3 { font-size: 12.5pt; }
  h4, h5, h6 { font-size: 11pt; }

  p { margin: 0 0 0.75em; orphans: 2; widows: 2; }

  ul, ol { margin: 0 0 0.9em; padding-left: 1.6em; }
  li { margin: 0.2em 0; }

  a { color: #0b5cad; text-decoration: none; }

  code {
    font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
    font-size: 9.5pt;
    background: #f2f2f4;
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }

  pre {
    background: #f6f6f8;
    border: 1px solid #dcdce2;
    border-radius: 6px;
    padding: 10px 12px;
    overflow-wrap: break-word;
    white-space: pre-wrap;
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0 0 1em;
  }

  pre code { background: none; padding: 0; font-size: 9pt; }

  blockquote {
    margin: 0 0 0.9em;
    padding: 0.1em 0 0.1em 0.9em;
    border-left: 3px solid #ccccd4;
    color: #444;
  }

  hr { border: none; border-top: 1px solid #d8d8de; margin: 1.4em 0; }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 1em;
    font-size: 10pt;
  }

  thead { display: table-header-group; }

  th, td {
    border: 1px solid #d0d0d8;
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
  }

  th { background: #f2f2f4; font-weight: 600; }

  tr { break-inside: avoid; page-break-inside: avoid; }
`;

// A closing tag with junk before the ">", like </script foo> or one broken across a newline, still
// ends the element as far as a real browser is concerned; matching only "</script>" exactly let one
// of those survive the strip with the opening tag intact.
const SCRIPT_ELEMENT = /<script\b[^<]*(?:(?!<\/script\b)<[^<]*)*<\/script\b[^>]*>/gi;

/** Takes every <script> element out of `html`. Removing one can join the text either side of it into
 * another (`<scr<script></script>ipt>` leaves `<script>`), so each is replaced by a space, which
 * separates what was either side of it, and the strip repeats until nothing changes. What is left of a
 * script tag after that is not a whole element, an unclosed one for instance, and is escaped rather than
 * left as a tag a browser would run to the end of the page. */
function stripScripts(html) {
  let current = String(html ?? "");
  for (let previous = ""; previous !== current; ) {
    previous = current;
    current = current.replace(SCRIPT_ELEMENT, " ");
  }
  return current.replace(/<(\/?script)\b/gi, "&lt;$1");
}

/** The complete page handed to Chromium. Direct HTML is framed with print styles;
 * Markdown is converted block by block. The policy prevents any network fetch. */
function buildDocument(content, title) {
  const safeTitle = escapeHtml(title || "Document");
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;" />`;

  if (isHtml(content)) {
    const raw = stripScripts(content);
    if (/<!doctype\b/i.test(raw) || /<html\b/i.test(raw)) {
      if (/<head\b/i.test(raw)) {
        return raw.replace(/<head\b[^>]*>/i, (match) => `${match}\n${csp}\n<style>${PRINT_STYLES}</style>`);
      }
      return `${csp}\n<style>${PRINT_STYLES}</style>\n${raw}`;
    }
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
${csp}
<title>${safeTitle}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
${raw}
</body>
</html>`;
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
${csp}
<title>${safeTitle}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
${markdownToHtml(content)}
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  inlineHtml,
  markdownToHtml,
  buildDocument,
  PRINT_STYLES,
};
