import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { MARKDOWN_COMPONENTS, REHYPE_PLUGINS, REMARK_PLUGINS } from "../chat/markdown";

/** Past this many characters the notes start collapsed, with the first lines still showing. */
const COLLAPSE_ABOVE = 240;

interface ReleaseNotesProps {
  notes: string | null;
  t: (key: string) => string;
  /** Without notes the dialog stays quiet, and the settings page says there are none. */
  showEmpty?: boolean;
}

/** What changed in the build on offer, as the release's own Markdown. Collapsed by default. */
export function ReleaseNotes({ notes, t, showEmpty = false }: ReleaseNotesProps) {
  const [open, setOpen] = useState(false);
  const text = notes?.trim() ?? "";

  if (!text) {
    return showEmpty ? <p className="text-xs text-[var(--text-muted)]">{t("noReleaseNotes")}</p> : null;
  }

  const collapsible = text.length > COLLAPSE_ABOVE;
  const collapsed = collapsible && !open;

  return (
    <section aria-label={t("whatsNew")} className="text-sm">
      <h3 className="text-xs font-medium text-text-secondary">{t("whatsNew")}</h3>
      <div
        className={`prose-notes mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)] ${
          collapsed ? "max-h-24 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]" : ""
        }`}
      >
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS as never}
          rehypePlugins={REHYPE_PLUGINS}
          components={MARKDOWN_COMPONENTS as never}
        >
          {text}
        </ReactMarkdown>
      </div>
      {collapsible && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="mt-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          {open ? t("showFewerLines") : t("showMoreLines")}
        </button>
      )}
    </section>
  );
}
