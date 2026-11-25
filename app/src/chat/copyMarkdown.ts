import type React from "react";

/** Copying part of a rendered reply gives back Markdown, so lists, code, links and emphasis
 * survive a paste into a plain text editor. The HTML stays on the clipboard for rich editors. */

const SKIPPED_TAGS = new Set(["BUTTON", "SCRIPT", "STYLE", "svg", "SVG", "INPUT"]);

const isSkipped = (element: Element) =>
  SKIPPED_TAGS.has(element.tagName) ||
  element.hasAttribute("data-copy-skip") ||
  element.getAttribute("aria-hidden") === "true";

/** Text of an element, leaving out what is skipped, such as a code block's header. */
function plainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return "";
  if (node instanceof Element && isSkipped(node)) return "";
  return [...node.childNodes].map(plainText).join("");
}

const block = (text: string) => `\n\n${text.trim()}\n\n`;

const fence = (code: string, language = "") => {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const marks = "`".repeat(longest + 1);
  return `\n\n${marks}${language}\n${code.replace(/\n$/, "")}\n${marks}\n\n`;
};

const wrap = (inner: string, mark: string) => (inner.trim() ? `${mark}${inner}${mark}` : inner);

const tidy = (text: string) => text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

function children(node: Node): string {
  return [...node.childNodes].map(convert).join("");
}

function list(element: Element): string {
  const ordered = element.tagName === "OL";
  let number = Number(element.getAttribute("start") ?? 1);
  const items: string[] = [];

  for (const item of element.children) {
    if (item.tagName !== "LI") continue;
    const box = item.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox]");
    const task = box ? ((box as HTMLInputElement).checked ? "[x] " : "[ ] ") : "";
    const marker = ordered ? `${number++}.` : "-";
    // A tight item holds no paragraphs, and its nested list follows on the next line.
    const tight = !item.querySelector(":scope > p");
    const text = tidy(children(item));
    const body = (tight ? text.replace(/\n\n/g, "\n") : text).replace(/\n/g, `\n${" ".repeat(marker.length + 1)}`);
    items.push(`${marker} ${task}${body}`);
  }

  return `\n\n${items.join("\n")}\n\n`;
}

function table(element: Element): string {
  const rows = [...element.querySelectorAll("tr")].map((row) =>
    [...row.children].map((cell) =>
      tidy(children(cell)).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " "),
    ),
  );
  if (rows.length === 0) return "";

  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const [head, ...body] = rows;
  return block([line(head), line(head.map(() => "---")), ...body.map(line)].join("\n"));
}

function convert(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    // The line breaks Markdown rendering leaves between blocks are not content.
    if (/^\s*\n\s*$/.test(text)) return "";
    // A <br> already wrote the break that follows it in the source.
    return node.previousSibling?.nodeName === "BR" ? text.replace(/^\n/, "") : text;
  }
  if (!(node instanceof Element)) return children(node);
  if (isSkipped(node)) return "";

  if (node.classList.contains("katex-display") || node.classList.contains("katex")) {
    const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? node.textContent ?? "";
    return node.classList.contains("katex-display") ? block(`$$\n${tex}\n$$`) : `$${tex}$`;
  }

  const language = node.getAttribute("data-code");
  if (language !== null) return fence(plainText(node), language);

  const tag = node.tagName;
  const heading = /^H([1-6])$/.exec(tag);
  if (heading) return block(`${"#".repeat(Number(heading[1]))} ${tidy(children(node))}`);

  switch (tag) {
    case "P":
    case "DIV":
    case "SECTION":
      return block(children(node));
    case "STRONG":
    case "B":
      return wrap(children(node), "**");
    case "EM":
    case "I":
      return wrap(children(node), "*");
    case "DEL":
    case "S":
      return wrap(children(node), "~~");
    case "CODE":
      return `\`${node.textContent ?? ""}\``;
    case "PRE":
      return node.querySelector("[data-code]") ? children(node) : fence(plainText(node));
    case "A": {
      const href = node.getAttribute("href");
      const text = children(node);
      return href && text !== href ? `[${text}](${href})` : text;
    }
    case "IMG":
      return `![${node.getAttribute("alt") ?? ""}](${node.getAttribute("src") ?? ""})`;
    case "BR":
      return "\n";
    case "HR":
      return block("---");
    case "BLOCKQUOTE":
      return block(tidy(children(node)).replace(/^/gm, "> "));
    case "UL":
    case "OL":
      return list(node);
    case "TABLE":
      return table(node);
    default:
      return children(node);
  }
}

/** Markdown for a rendered piece of reply. */
export function toMarkdown(root: Node): string {
  return tidy(children(root));
}

/** Copy handler for a rendered reply. A selection inside one run of text is left to the browser. */
export function copyAsMarkdown(event: React.ClipboardEvent) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

  const holder = document.createElement("div");
  for (let index = 0; index < selection.rangeCount; index++) {
    holder.appendChild(selection.getRangeAt(index).cloneContents());
  }
  if (!holder.querySelector("*")) return;

  const markdown = toMarkdown(holder);
  if (!markdown) return;

  event.clipboardData.setData("text/plain", markdown);
  event.clipboardData.setData("text/html", holder.innerHTML);
  event.preventDefault();
}
