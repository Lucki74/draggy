import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  DOCUMENT_REMARK_PLUGINS,
  MARKDOWN_COMPONENTS,
  REHYPE_PLUGINS,
} from "./markdown";
import { isCodeFile, prismLanguageOf } from "../canvas/drafts";
import { isHtmlContent, sanitizeHtml } from "./htmlPreview";

const LINE_HEIGHT = 20;
const OVERSCAN = 30;

/** Renders a formatted mini preview for created documents, spreadsheets, slide decks, and code. */

interface FilePreviewProps {
  filename: string;
  content: string;
  t?: (key: string) => string;
  fullHeight?: boolean;
}

function parseCsvRows(text: string): string[][] {
  if (typeof window !== "undefined" && window.DOMParser && /<\s*table\b/i.test(text)) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const trs = Array.from(doc.querySelectorAll("tr"));
    if (trs.length > 0) {
      return trs.map((tr) =>
        Array.from(tr.querySelectorAll("th, td")).map((cell) => cell.textContent?.trim() || ""),
      );
    }
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      if (row.some((c) => c.trim().length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((c) => c.trim().length > 0)) rows.push(row);
  }
  return rows;
}

interface SlideItem {
  title: string;
  items: string[];
}

function parseSlideCards(text: string): SlideItem[] {
  if (typeof window !== "undefined" && window.DOMParser && /<\s*section\b/i.test(text)) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const sections = Array.from(doc.querySelectorAll("section"));
    if (sections.length > 0) {
      return sections.map((sec) => {
        const title = sec.querySelector("h1, h2, h3, h4")?.textContent?.trim() || "";
        const items = Array.from(sec.querySelectorAll("li, p"))
          .map((el) => el.textContent?.trim() || "")
          .filter((t) => t && t !== title);
        return { title, items };
      });
    }
  }

  return text
    .split(/\n---\n/)
    .map((chunk) => {
      const lines = chunk
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const titleLine = lines.find((l) => l.startsWith("#"));
      const title = titleLine ? titleLine.replace(/^#+\s*/, "") : lines[0] || "";
      const items = lines
        .filter((l) => l !== titleLine)
        .map((l) => l.replace(/^[-*•]\s+/, ""));
      return { title, items };
    })
    .filter((s) => s.title || s.items.length > 0);
}

export function FilePreview({ filename, content, t = (k) => k, fullHeight = false }: FilePreviewProps) {
  const dot = filename.lastIndexOf(".");
  const hasExt = dot > 0;
  const ext = hasExt ? filename.slice(dot + 1).toLowerCase() : "";

  const isSheet = hasExt && (ext === "xlsx" || ext === "xls" || ext === "csv");
  const isPptx = hasExt && (ext === "pptx" || ext === "ppt");
  const isDoc =
    hasExt &&
    (ext === "md" ||
      ext === "markdown" ||
      ext === "mdx" ||
      ext === "docx" ||
      ext === "doc" ||
      ext === "pdf");
  const isWebPage = hasExt && (ext === "html" || ext === "htm");

  // A document the model wrote as HTML is shown as that HTML. Handing it to the
  // Markdown renderer indents it into a code block, which is why a .docx used
  // to preview as its own source.
  const asHtml = useMemo(
    () => ((isDoc || isWebPage) && isHtmlContent(content) ? sanitizeHtml(content) : null),
    [isDoc, isWebPage, content],
  );

  const isCode = isCodeFile(filename) && !isSheet && !isPptx && !asHtml;

  const [scrollTop, setScrollTop] = useState(0);
  const lastScrollTopRef = useRef(0);

  const tableRows = useMemo(() => {
    if (!isSheet) return [];
    return parseCsvRows(content);
  }, [isSheet, content]);

  const slides = useMemo(() => {
    if (!isPptx) return [];
    return parseSlideCards(content);
  }, [isPptx, content]);

  const lines = useMemo(() => {
    if (isSheet || isPptx || isDoc || asHtml) return [];
    return content.split("\n");
  }, [isSheet, isPptx, isDoc, asHtml, content]);

  const totalLines = lines.length;

  const visibleRange = useMemo(() => {
    if (totalLines <= 100) {
      return { isWindowed: false, startLine: 0, endLine: totalLines };
    }
    const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
    const end = Math.min(totalLines, Math.ceil((scrollTop + 600) / LINE_HEIGHT) + OVERSCAN);
    return { isWindowed: true, startLine: start, endLine: end };
  }, [totalLines, scrollTop]);

  const visibleText = useMemo(() => {
    if (!visibleRange.isWindowed) return content;
    return lines.slice(visibleRange.startLine, visibleRange.endLine).join("\n");
  }, [content, lines, visibleRange]);

  const topSpacerHeight = visibleRange.startLine * LINE_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (totalLines - visibleRange.endLine) * LINE_HEIGHT);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    if (totalLines > 100 && Math.abs(top - lastScrollTopRef.current) > LINE_HEIGHT * 6) {
      lastScrollTopRef.current = top;
      setScrollTop(top);
    }
  };

  if (isSheet) {
    if (tableRows.length === 0) {
      return (
        <div className="p-4 text-xs font-mono text-[var(--text-muted)]">
          {t("previewUnavailable")}
        </div>
      );
    }

    const header = tableRows[0];
    const data = tableRows.slice(1);

    return (
      <div className={`flex flex-col w-full overflow-hidden ${fullHeight ? "h-full flex-1" : ""}`}>
        <div className="px-3 py-1.5 bg-[var(--hover-bg)] border-b border-[var(--border-light)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center justify-between">
          <span>{filename}</span>
          <span>
            {tableRows.length} {t("rowCount")} · {header.length} {t("columnCount")}
          </span>
        </div>
        <div className={`overflow-auto bg-[var(--bg-base)] ${fullHeight ? "flex-1 min-h-0" : "max-h-72"}`}>
          <table className="w-full border-collapse text-left font-mono text-xs">
            <thead>
              <tr className="bg-[var(--bg-panel)] sticky top-0 border-b-2 border-[var(--border-light)]">
                {header.map((col, idx) => (
                  <th
                    key={idx}
                    className="px-3 py-2 font-bold text-[var(--text-main)] border-r border-[var(--border-light)] last:border-r-0 whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className="border-b border-[var(--border-light)] hover:bg-[var(--hover-bg)] transition-colors"
                >
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-3 py-1.5 text-[var(--text-main)] border-r border-[var(--border-light)] last:border-r-0 whitespace-nowrap"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (isPptx) {
    if (slides.length === 0) {
      return (
        <div className="p-4 text-xs font-mono text-[var(--text-muted)]">
          {t("previewUnavailable")}
        </div>
      );
    }

    return (
      <div className={`flex flex-col w-full overflow-hidden ${fullHeight ? "h-full flex-1" : ""}`}>
        <div className="px-3 py-1.5 bg-[var(--hover-bg)] border-b border-[var(--border-light)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center justify-between">
          <span>{filename}</span>
          <span>{slides.length} {t("slideCount")}</span>
        </div>
        <div className={`p-3 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[var(--bg-base)] ${fullHeight ? "flex-1 min-h-0" : "max-h-80"}`}>
          {slides.map((slide, idx) => (
            <div
              key={idx}
              className="rounded-lg border-2 border-[var(--border-light)] p-3 bg-[var(--bg-panel)] flex flex-col justify-between shadow-xs aspect-video"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    {idx + 1}
                  </span>
                </div>
                <h4 className="text-xs font-bold text-[var(--text-main)] line-clamp-2 mb-2">
                  {slide.title}
                </h4>
                <ul className="text-[11px] text-[var(--text-muted)] space-y-1">
                  {slide.items.slice(0, 3).map((item, itemIdx) => (
                    <li key={itemIdx} className="truncate">
                      • {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isCode) {
    return (
      <div
        onScroll={handleScroll}
        className={`flex flex-col ${fullHeight ? "h-full flex-1 min-h-0" : "max-h-96"} overflow-auto bg-[#1e1e1e] font-mono text-[13px]`}
      >
        {visibleRange.isWindowed && topSpacerHeight > 0 && (
          <div style={{ height: `${topSpacerHeight}px`, flexShrink: 0 }} />
        )}
        <SyntaxHighlighter
          language={prismLanguageOf(filename)}
          style={atomDark}
          customStyle={{
            margin: 0,
            padding: "1rem",
            background: "transparent",
            fontSize: "13px",
            lineHeight: `${LINE_HEIGHT}px`,
          }}
        >
          {visibleText}
        </SyntaxHighlighter>
        {visibleRange.isWindowed && bottomSpacerHeight > 0 && (
          <div style={{ height: `${bottomSpacerHeight}px`, flexShrink: 0 }} />
        )}
      </div>
    );
  }

  if (asHtml !== null) {
    return (
      <div
        className={`p-4 bg-[var(--bg-base)] text-[var(--text-main)] overflow-y-auto ${fullHeight ? "h-full flex-1 min-h-0" : "max-h-72"} text-sm leading-relaxed markdown-body max-w-none`}
        dangerouslySetInnerHTML={{ __html: asHtml }}
      />
    );
  }

  if (isDoc) {
    return (
      <div className={`p-4 bg-[var(--bg-base)] text-[var(--text-main)] overflow-y-auto ${fullHeight ? "h-full flex-1 min-h-0" : "max-h-72"} text-sm leading-relaxed markdown-body max-w-none`}>
        <ReactMarkdown
          remarkPlugins={DOCUMENT_REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div
      onScroll={handleScroll}
      className={`flex flex-col ${fullHeight ? "h-full flex-1 min-h-0" : "max-h-96"} overflow-auto bg-[var(--bg-base)] p-4`}
    >
      {visibleRange.isWindowed && topSpacerHeight > 0 && (
        <div style={{ height: `${topSpacerHeight}px`, flexShrink: 0 }} />
      )}
      <pre className="whitespace-pre font-mono text-xs leading-5 m-0 p-0 text-[var(--text-main)]">
        {visibleText}
      </pre>
      {visibleRange.isWindowed && bottomSpacerHeight > 0 && (
        <div style={{ height: `${bottomSpacerHeight}px`, flexShrink: 0 }} />
      )}
    </div>
  );
}

export default FilePreview;
