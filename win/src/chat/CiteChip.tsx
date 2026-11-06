import { useContext, type ReactNode } from "react";
import { Icon } from "../ui";
import { hostnameOf } from "../utils";
import { uiText } from "../i18n";
import { CitationContext } from "./citationContext";
import { resolveCitation } from "../research/runView";

/** The text of a citation marker back to its reference: "[n3]" gives "n3", "[2]" gives "2". */
function citeRef(children: ReactNode): string {
  const text = Array.isArray(children) ? children.join("") : String(children ?? "");
  return text.replace(/^\[|\]$/g, "");
}

/** `[n1]` in a report as a small numbered chip with the source, date and supporting quote on hover. */
export function CiteChip({ children }: { children?: ReactNode }) {
  const run = useContext(CitationContext);
  const t = uiText;
  const ref = citeRef(children);
  const cite = run ? resolveCitation(run, ref) : null;
  // Outside a research reply, or for an id the run does not have, the marker stays as written.
  if (!cite) return <>{`[${ref}]`}</>;
  const host = hostnameOf(cite.source.url);
  const title = cite.source.title === cite.source.url ? host : cite.source.title;
  const open = () => window.open(cite.source.url, "_blank");

  return (
    <span className="group/cite relative inline-block align-baseline">
      <button
        type="button"
        onClick={open}
        aria-label={`${t("citeSource").replace("{n}", String(cite.n))}: ${title}`}
        className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-pill border border-rule bg-surface-raised px-1 align-baseline text-[11px] font-medium leading-none tabular-nums text-text-secondary outline-none hover:border-rule-strong hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
      >
        {cite.n}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full start-0 z-20 mb-1 flex w-72 max-w-[80vw] flex-col gap-1 rounded-md border border-rule-strong bg-surface-base p-3 text-start text-[12px] leading-5 text-text-secondary opacity-0 shadow-lg transition-opacity group-focus-within/cite:visible group-focus-within/cite:opacity-100 group-hover/cite:visible group-hover/cite:opacity-100"
      >
        <span className="block break-words text-[13px] font-medium text-text-primary">{title}</span>
        <span className="block truncate text-text-tertiary">
          {[cite.source.site || host, cite.source.published?.slice(0, 10)].filter(Boolean).join(" · ")}
        </span>
        <span className="block break-words italic">{cite.quote}</span>
        <span className={`flex items-center gap-1 ${cite.verified ? "text-ok" : "text-text-tertiary"}`}>
          <Icon name={cite.verified ? "check-circle" : "warning-circle"} size={12} />
          {t(cite.verified ? "citeVerified" : "citeNotVerified")}
        </span>
      </span>
    </span>
  );
}
export default CiteChip;
