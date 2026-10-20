/**
 * Shows the HTML a model wrote for a document, without letting it be a web page.
 *
 * The converters that turn this markup into .docx and .xlsx read inline styles
 * and nothing else, so a <style> block is dropped here too: the preview is then
 * what the document will look like rather than what a browser would draw.
 */

const ALLOWED_TAGS = new Set([
  "a", "article", "aside", "b", "blockquote", "br", "button", "caption", "circle", "code",
  "col", "colgroup", "dd", "details", "div", "dl", "dt", "em", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img",
  "input", "label", "li", "line", "main", "mark", "nav", "ol", "option", "p", "path",
  "polygon", "polyline", "pre", "rect", "s", "section", "select", "small", "span",
  "strong", "sub", "summary", "sup", "svg", "table", "tbody", "td", "textarea",
  "tfoot", "th", "thead", "tr", "u", "ul",
]);

/** Everything not here is dropped, which is what keeps an event handler out. */
const ALLOWED_ATTRIBUTES = new Set([
  "align", "alt", "bgcolor", "checked", "class", "color", "cols", "colspan",
  "cx", "cy", "d", "disabled", "fill", "for", "height", "href", "id", "name",
  "placeholder", "points", "r", "rows", "rowspan", "rx", "ry", "selected", "src",
  "stroke", "stroke-linecap", "stroke-linejoin", "stroke-width", "style", "title",
  "type", "value", "viewbox", "width", "x", "x1", "x2", "xmlns", "y", "y1", "y2",
]);

const SAFE_URL = /^(https?:|mailto:|data:image\/(png|jpe?g|gif|webp|bmp);base64,)/i;

/** A style that fetches or scripts rather than styles. */
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|javascript:|@import/i;

function scopeCss(css: string): string {
  let cleanCss = css
    .replace(/@import\b[^;]*;?/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/javascript:/gi, "");

  cleanCss = cleanCss.replace(/(^|[\s,}])(body|html)\b/gi, "$1:scope");
  return `@scope (.chrome-html-canvas) {\n${cleanCss}\n}`;
}

export function isHtmlContent(content: string): boolean {
  const trimmed = content.trim();
  return (
    /^\s*<!doctype\s+html/i.test(trimmed) ||
    /<\s*(?:html|head|style|body|div|p|h[1-6]|table|section|article|ul|ol|span|strong|em)\b/i.test(trimmed)
  );
}

/** The markup with everything that could act rather than show stripped out of it. */
export function sanitizeHtml(html: string, injectCaret = false, allowStyles = false): string {
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

  if (allowStyles && parsed.head) {
    const headStyles = Array.from(parsed.head.querySelectorAll("style"));
    for (const styleEl of headStyles) {
      body.insertBefore(styleEl, body.firstChild);
    }
  }

  if (allowStyles) {
    for (const styleEl of Array.from(body.querySelectorAll("style"))) {
      const raw = styleEl.textContent || "";
      styleEl.textContent = scopeCss(raw);
    }
  }

  const clean = (node: Element) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();

      if (tag === "style" && allowStyles) {
        continue;
      }

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
