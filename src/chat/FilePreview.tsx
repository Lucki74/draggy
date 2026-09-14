import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { REHYPE_PLUGINS, REMARK_PLUGINS, MARKDOWN_COMPONENTS } from "./markdown";

/** Renders a formatted mini preview for created documents, spreadsheets, slide decks, and code. */

interface FilePreviewProps {
  filename: string;
  content: string;
  t?: (key: string) => string;
}

const CODE_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "py", "css", "scss", "json", "yml", "yaml",
  "sh", "bash", "ps1", "cpp", "c", "h", "cs", "rs", "go", "java", "rb",
  "sql", "toml", "xml", "swift", "kt", "lua", "r",
]);

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
  row.push(cell);
  if (row.some((c) => c.trim().length > 0)) rows.push(row);
  return rows;
}

interface SlideItem {
  title: string;
  items: string[];
}

function parseSlideCards(text: string): SlideItem[] {
  if (typeof window !== "undefined" && window.DOMParser && /<\s*section\b/i.test(text)) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const sections = Array.from(doc.querySelectorAll("section, .slide"));
    if (sections.length > 0) {
      return sections.map((sec, idx) => {
        const titleEl = sec.querySelector("h1, h2, h3");
        const title = titleEl?.textContent?.trim() || `Slide ${idx + 1}`;
        const items = Array.from(sec.querySelectorAll("li, p"))
          .filter((el) => el !== titleEl)
          .map((el) => el.textContent?.trim() || "")
          .filter(Boolean);
        return { title, items };
      });
    }
  }

  const blocks = text.split(/^\s*(?:---|\*\*\*)\s*$/m);
  return blocks
    .map((block, idx) => {
      const lines = block
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const titleLine = lines.find((l) => /^#{1,6}\s+/.test(l));
      const title = titleLine ? titleLine.replace(/^#{1,6}\s+/, "") : `Slide ${idx + 1}`;
      const items = lines
        .filter((l) => l !== titleLine)
        .map((l) => l.replace(/^[-*•]\s+/, ""));
      return { title, items };
    })
    .filter((s) => s.title || s.items.length > 0);
}

export function FilePreview({ filename, content, t = (k) => k }: FilePreviewProps) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const isSheet = ext === "xlsx" || ext === "xls" || ext === "csv";
  const isPptx = ext === "pptx" || ext === "ppt";
  const isCode = CODE_EXTENSIONS.has(ext);

  const tableRows = useMemo(() => {
    if (!isSheet) return [];
    return parseCsvRows(content);
  }, [isSheet, content]);

  const slides = useMemo(() => {
    if (!isPptx) return [];
    return parseSlideCards(content);
  }, [isPptx, content]);

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
      <div className="flex flex-col w-full overflow-hidden">
        <div className="px-3 py-1.5 bg-[var(--hover-bg)] border-b border-[var(--border-light)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center justify-between">
          <span>{filename}</span>
          <span>
            {tableRows.length} {t("rowCount")} · {header.length} {t("columnCount")}
          </span>
        </div>
        <div className="max-h-72 overflow-auto bg-[var(--bg-base)]">
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
      <div className="flex flex-col w-full overflow-hidden">
        <div className="px-3 py-1.5 bg-[var(--hover-bg)] border-b border-[var(--border-light)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center justify-between">
          <span>{filename}</span>
          <span>{slides.length} {t("slideCount")}</span>
        </div>
        <div className="p-3 max-h-80 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[var(--bg-base)]">
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
      <SyntaxHighlighter
        language={ext || "javascript"}
        style={atomDark}
        customStyle={{
          margin: 0,
          padding: "1rem",
          background: "transparent",
          fontSize: "13px",
        }}
        wrapLines
        wrapLongLines
      >
        {content}
      </SyntaxHighlighter>
    );
  }

  return (
    <div className="p-4 bg-[var(--bg-base)] text-[var(--text-main)] overflow-y-auto max-h-72 text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default FilePreview;
