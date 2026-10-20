import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { SYNTAX_THEME } from "./syntaxTheme";
import {
  DOCUMENT_REMARK_PLUGINS,
  MARKDOWN_COMPONENTS,
  REHYPE_PLUGINS,
} from "./markdown";
import { isCodeFile, prismLanguageOf } from "../canvas/drafts";
import { isHtmlContent, sanitizeHtml } from "./htmlPreview";
import { rehypeCaret } from "./streamReveal";
import { EmberCaret } from "../ui";

const LINE_HEIGHT = 20;
const OVERSCAN = 30;

/** Renders a formatted mini preview for created documents, spreadsheets, slide decks, and code. */

interface FilePreviewProps {
  filename: string;
  content: string;
  t?: (key: string) => string;
  fullHeight?: boolean;
  isWriting?: boolean;
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

const columnLetter = (index: number): string => {
  let name = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) name = String.fromCharCode(65 + (n % 26)) + name;
  return name;
};

export function FilePreview({
  filename,
  content,
  t = (k) => k,
  fullHeight = false,
  isWriting = false,
}: FilePreviewProps) {
  const dot = filename.lastIndexOf(".");
  const hasExt = dot > 0;
  const ext = hasExt ? filename.slice(dot + 1).toLowerCase() : "";

  const isSheet = hasExt && (ext === "xlsx" || ext === "xls" || ext === "csv");
  const isPptx = hasExt && (ext === "pptx" || ext === "ppt");
  const isMarkdown = hasExt && (ext === "md" || ext === "markdown" || ext === "mdx");
  const isWord = hasExt && (ext === "docx" || ext === "doc" || ext === "pdf");
  const isDoc = isMarkdown || isWord;
  const isWebPage = hasExt && (ext === "html" || ext === "htm");

  // A document the model wrote as HTML is shown as that HTML. Handing it to the
  // Markdown renderer indents it into a code block, which is why a .docx used
  // to preview as its own source.
  const asHtml = useMemo(
    () => ((isDoc || isWebPage) && isHtmlContent(content) ? sanitizeHtml(content, isWriting) : null),
    [isDoc, isWebPage, content, isWriting],
  );

  const isCode = isCodeFile(filename) && !isSheet && !isPptx && !asHtml;

  const [scrollTop, setScrollTop] = useState(0);
  const lastScrollTopRef = useRef(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const isScrolledToBottomRef = useRef(true);

  const handleContainerScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    isScrolledToBottomRef.current = distance <= 32;
  };

  const handleContainerWheel = (e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      isScrolledToBottomRef.current = false;
    }
  };

  useEffect(() => {
    if (!isWriting || !isScrolledToBottomRef.current) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content, isWriting]);

  const tableRows = useMemo(() => {
    if (!isSheet) return [];
    const rows = parseCsvRows(content);
    if (rows.length === 0 && isWriting) {
      return [["", "", ""]];
    }
    return rows;
  }, [isSheet, content, isWriting]);

  const slides = useMemo(() => {
    if (!isPptx) return [];
    const parsed = parseSlideCards(content);
    if (parsed.length === 0 && isWriting) {
      return [{ title: "", items: [] }];
    }
    return parsed;
  }, [isPptx, content, isWriting]);

  const docRehypePlugins = useMemo(
    () => (isWriting ? [...(REHYPE_PLUGINS as unknown[]), rehypeCaret] : REHYPE_PLUGINS),
    [isWriting],
  );

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

    return (
      <div className={`flex flex-col w-full overflow-hidden ${fullHeight ? "h-full flex-1" : ""}`}>
        <div className="px-3 py-1.5 bg-[var(--hover-bg)] border-b border-[var(--border-light)] text-[11px] font-medium text-text-secondary flex items-center justify-end">
          <span>
            {tableRows.length} {t("rowCount")} · {header.length} {t("columnCount")}
          </span>
        </div>
        <div
          ref={containerRef}
          onScroll={handleContainerScroll}
          onWheel={handleContainerWheel}
          className={`overflow-y-auto overflow-x-hidden bg-white ${fullHeight ? "flex-1 min-h-0" : "max-h-72"}`}
        >
          <table className="w-full table-fixed border-collapse text-start font-sans text-[13px] text-[#1f1f1f]">
            <thead>
              <tr className="sticky top-0 bg-[#f3f3f3] text-[11px] font-normal text-[#5f5f5f]">
                <th className="w-9 border border-[#d4d4d4] py-0.5 font-normal" />
                {header.map((_, idx) => (
                  <th key={idx} className="border border-[#d4d4d4] py-0.5 text-center font-normal">
                    {columnLetter(idx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rIdx) => {
                const isLastRow = rIdx === tableRows.length - 1;
                return (
                  <tr key={rIdx}>
                    <td className="border border-[#d4d4d4] bg-[#f3f3f3] text-center text-[11px] text-[#5f5f5f]">
                      {rIdx + 1}
                    </td>
                    {header.map((_, cIdx) => {
                      const isLastCellInRow = cIdx === Math.max(0, row.length - 1);
                      const isCurrentCell = isWriting && isLastRow && isLastCellInRow;
                      return (
                        <td
                          key={cIdx}
                          className={`border border-[#d4d4d4] px-2 py-1 align-top break-words ${
                            rIdx === 0 ? "font-semibold bg-[#f9fafb]" : ""
                          } ${
                            isCurrentCell
                              ? "ring-2 ring-emerald-500 ring-inset bg-emerald-50/20"
                              : ""
                          }`}
                        >
                          {row[cIdx] ?? ""}
                          {isCurrentCell && <EmberCaret className="ms-1 inline-block" />}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
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
        <div className="px-3 py-1.5 bg-[var(--hover-bg)] border-b border-[var(--border-light)] text-[11px] font-medium text-text-secondary flex items-center justify-end">
          <span>{slides.length} {t("slideCount")}</span>
        </div>
        <div
          ref={containerRef}
          onScroll={handleContainerScroll}
          onWheel={handleContainerWheel}
          className={`p-4 overflow-y-auto flex flex-col items-center gap-4 bg-[#e9e9ec] ${fullHeight ? "flex-1 min-h-0" : "max-h-96"}`}
        >
          {slides.map((slide, idx) => {
            const isLastSlide = idx === slides.length - 1;
            const isCurrentSlide = isWriting && isLastSlide;
            return (
              <div
                key={idx}
                className={`relative w-full max-w-[560px] aspect-video shrink-0 overflow-hidden bg-white text-[#1f1f1f] shadow-md px-[7%] py-[6%] flex flex-col transition-all ${
                  isCurrentSlide ? "ring-2 ring-[var(--accent)] shadow-lg" : ""
                }`}
              >
                <h4 className={`font-semibold leading-tight ${slide.items.length === 0 ? "m-auto text-center text-2xl" : "text-xl mb-3"}`}>
                  {slide.title || (isCurrentSlide ? t("untitledFile") || "Slide" : "")}
                  {isCurrentSlide && slide.items.length === 0 && (
                    <EmberCaret className="ms-1 inline-block" />
                  )}
                </h4>
                {slide.items.length > 0 && (
                  <ul className="list-disc ps-5 space-y-1.5 text-[13px] text-[#3a3a3a]">
                    {slide.items.map((item, itemIdx) => {
                      const isLastItem = itemIdx === slide.items.length - 1;
                      return (
                        <li key={itemIdx}>
                          {item}
                          {isCurrentSlide && isLastItem && (
                            <EmberCaret className="ms-1 inline-block" />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <span className="absolute bottom-2 end-3 text-[10px] text-[#8a8a8a]">{idx + 1}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (isCode) {
    return (
      // Block flow, not a flex column: the spacer below is unshrinkable, so as a
      // flex child the code itself was squashed to a line and the rest was gap.
      <div
        onScroll={handleScroll}
        className={`${fullHeight ? "h-full flex-1 min-h-0" : "max-h-96"} overflow-auto bg-surface-base text-text-primary font-mono text-[13px]`}
      >
        {visibleRange.isWindowed && topSpacerHeight > 0 && (
          <div style={{ height: `${topSpacerHeight}px` }} />
        )}
        <SyntaxHighlighter
          language={prismLanguageOf(filename)}
          style={SYNTAX_THEME}
          customStyle={{
            margin: 0,
            padding: "1rem",
            background: "transparent",
            fontSize: "13px",
            lineHeight: `${LINE_HEIGHT}px`,
            // This box scrolls. Left to itself the highlighter's own <pre>
            // scrolls too, which is a second bar inside the first.
            overflow: "visible",
          }}
        >
          {visibleText}
        </SyntaxHighlighter>
        {visibleRange.isWindowed && bottomSpacerHeight > 0 && (
          <div style={{ height: `${bottomSpacerHeight}px` }} />
        )}
      </div>
    );
  }

  if (isWord) {
    return (
      <div
        ref={containerRef}
        onScroll={handleContainerScroll}
        onWheel={handleContainerWheel}
        className={`overflow-y-auto bg-[#e9e9ec] p-4 ${fullHeight ? "h-full flex-1 min-h-0" : "max-h-96"}`}
      >
        {asHtml !== null ? (
          <div
            className="mx-auto w-full max-w-[680px] bg-white px-[8%] py-10 font-sans text-[14px] leading-relaxed text-[#1f1f1f] shadow-md markdown-body [--text-primary:#1f1f1f] [--text-secondary:#444444] [--text-tertiary:#6b6b6b] [--rule:#d4d4d4] [--rule-strong:#b5b5b5] [--surface-raised:#f3f3f3] [&_table]:my-3 [&_table]:border-collapse [&_td]:border [&_th]:border [&_td]:border-[#c8c8c8] [&_th]:border-[#c8c8c8] [&_td]:px-2 [&_th]:px-2 [&_td]:py-1 [&_th]:py-1 [&_th]:bg-[#f3f3f3] [&_blockquote]:border-s-4 [&_blockquote]:border-[#c8c8c8] [&_blockquote]:ps-3 [&_blockquote]:text-[#555] [&_pre]:bg-[#f3f3f3] [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: asHtml }}
          />
        ) : (
          <div className="mx-auto w-full max-w-[680px] bg-white px-[8%] py-10 font-sans text-[14px] leading-relaxed text-[#1f1f1f] shadow-md markdown-body [--text-primary:#1f1f1f] [--text-secondary:#444444] [--text-tertiary:#6b6b6b] [--rule:#d4d4d4] [--rule-strong:#b5b5b5] [--surface-raised:#f3f3f3] [&_table]:my-3 [&_table]:border-collapse [&_td]:border [&_th]:border [&_td]:border-[#c8c8c8] [&_th]:border-[#c8c8c8] [&_td]:px-2 [&_th]:px-2 [&_td]:py-1 [&_th]:py-1 [&_th]:bg-[#f3f3f3] [&_blockquote]:border-s-4 [&_blockquote]:border-[#c8c8c8] [&_blockquote]:ps-3 [&_blockquote]:text-[#555] [&_pre]:bg-[#f3f3f3] [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto">
            {content.trim().length === 0 && isWriting ? (
              <span className="ember-caret" aria-hidden="true" />
            ) : (
              <ReactMarkdown
                remarkPlugins={DOCUMENT_REMARK_PLUGINS}
                rehypePlugins={docRehypePlugins as never}
                components={MARKDOWN_COMPONENTS}
              >
                {content}
              </ReactMarkdown>
            )}
          </div>
        )}
      </div>
    );
  }

  if (isMarkdown) {
    return (
      <div
        ref={containerRef}
        onScroll={handleContainerScroll}
        onWheel={handleContainerWheel}
        className={`p-4 bg-[var(--bg-base)] text-[var(--text-main)] overflow-y-auto ${fullHeight ? "h-full flex-1 min-h-0" : "max-h-72"} text-sm leading-relaxed markdown-body max-w-none`}
      >
        {content.trim().length === 0 && isWriting ? (
          <span className="ember-caret" aria-hidden="true" />
        ) : (
          <ReactMarkdown
            remarkPlugins={DOCUMENT_REMARK_PLUGINS}
            rehypePlugins={docRehypePlugins as never}
            components={MARKDOWN_COMPONENTS}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    );
  }

  if (asHtml !== null) {
    return (
      <div
        ref={containerRef}
        onScroll={handleContainerScroll}
        onWheel={handleContainerWheel}
        className={`p-4 bg-[var(--bg-base)] text-[var(--text-main)] overflow-y-auto ${fullHeight ? "h-full flex-1 min-h-0" : "max-h-72"} text-sm leading-relaxed markdown-body max-w-none`}
        dangerouslySetInnerHTML={{ __html: asHtml }}
      />
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
