/**
 * Shows the HTML a model wrote for a document, without letting it be a web page.
 *
 * The converters that turn this markup into .docx and .xlsx read inline styles
 * and nothing else, so a <style> block is dropped here too: the preview is then
 * what the document will look like rather than what a browser would draw.
 */

const ALLOWED_TAGS = new Set([
  "a", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "dd",
  "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2", "h3", "h4",
  "h5", "h6", "hr", "i", "img", "li", "mark", "ol", "p", "pre", "s", "section",
  "small", "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot",
  "th", "thead", "tr", "u", "ul",
]);

/** Everything not here is dropped, which is what keeps an event handler out. */
const ALLOWED_ATTRIBUTES = new Set([
  "align", "alt", "colspan", "rowspan", "src", "href", "style", "title",
  "width", "height", "class", "bgcolor", "color",
]);

const SAFE_URL = /^(https?:|mailto:|data:image\/(png|jpe?g|gif|webp|bmp);base64,)/i;

/** A style that fetches or scripts rather than styles. */
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|javascript:|@import/i;

export function isHtmlContent(content: string): boolean {
  const trimmed = content.trim();
  return (
    /^\s*<!doctype\s+html/i.test(trimmed) ||
    /<\s*(?:html|head|style|body|div|p|h[1-6]|table|section|article|ul|ol|span|strong|em)\b/i.test(trimmed)
  );
}

/** The markup with everything that could act rather than show stripped out of it. */
export function sanitizeHtml(html: string, injectCaret = false): string {
  if (typeof window === "undefined" || !window.DOMParser) return "";

  // Auto-close unclosed <style> or <script> during streaming so subsequent elements aren't swallowed
  let preprocessed = html;
  if (/<style\b/i.test(preprocessed) && !/<\/style>/i.test(preprocessed)) {
    const match = preprocessed.match(/<\/?(?:body|head|div|p|h[1-6]|table|section|ul|ol)\b/i);
    if (match && match.index !== undefined) {
      preprocessed = preprocessed.slice(0, match.index) + "</style>" + preprocessed.slice(match.index);
    } else {
      preprocessed += "</style>";
    }
  }
  if (/<script\b/i.test(preprocessed) && !/<\/script>/i.test(preprocessed)) {
    const match = preprocessed.match(/<\/?(?:body|head|div|p|h[1-6]|table|section|ul|ol)\b/i);
    if (match && match.index !== undefined) {
      preprocessed = preprocessed.slice(0, match.index) + "</script>" + preprocessed.slice(match.index);
    } else {
      preprocessed += "</script>";
    }
  }

  const parsed = new DOMParser().parseFromString(preprocessed, "text/html");
  const body = parsed.body;
  if (!body) return "";

  const clean = (node: Element) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();

      if (!ALLOWED_TAGS.has(tag)) {
        // A <div> wrapper is worth keeping the contents of; a <script> is not.
        if (tag === "script" || tag === "style" || tag === "iframe" || tag === "object" || tag === "embed") {
          child.remove();
        } else {
          child.replaceWith(...child.childNodes);
        }
        continue;
      }

      for (const attribute of [...child.attributes]) {
        const name = attribute.name.toLowerCase();

        if (!ALLOWED_ATTRIBUTES.has(name)) {
          child.removeAttribute(attribute.name);
          continue;
        }
        if ((name === "href" || name === "src") && !SAFE_URL.test(attribute.value.trim())) {
          child.removeAttribute(attribute.name);
          continue;
        }
        if (name === "style" && UNSAFE_STYLE.test(attribute.value)) {
          child.removeAttribute(attribute.name);
        }
      }

      clean(child);
    }
  };

  clean(body);

  if (injectCaret) {
    const caret = parsed.createElement("span");
    caret.className = "ember-caret";
    caret.setAttribute("aria-hidden", "true");
    if (body.children.length === 0) {
      const p = parsed.createElement("p");
      p.appendChild(caret);
      body.appendChild(p);
    } else {
      let target: Element = body;
      while (target.lastElementChild && !target.lastElementChild.classList.contains("ember-caret")) {
        target = target.lastElementChild;
      }
      target.appendChild(caret);
    }
  }

  return body.innerHTML;
}
