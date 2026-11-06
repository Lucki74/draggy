import SiteBadge from "./SiteBadge";
import { hostnameOf } from "../utils";
import { citedSources, dayOf, type ResearchRunView } from "../research/runView";

/** The report's source list. Numbers match the citation chips, which count the sources that have notes. */
export function ResearchSourceList({ run, t }: { run: ResearchRunView; t: (key: string) => string }) {
  const cited = citedSources(run);
  if (cited.length === 0) return null;
  return (
    <section aria-label={t("researchSourceList")} className="mt-3 border-t border-rule pt-2">
      <h4 className="mb-1 text-[12px] font-medium text-text-secondary">{t("researchSourceList")}</h4>
      <ol className="flex flex-col">
        {cited.map((source, index) => {
          const host = hostnameOf(source.url);
          const title = source.title === source.url ? host || source.url : source.title;
          return (
            <li key={source.id}>
              <button
                type="button"
                title={host}
                onClick={() => window.open(source.url, "_blank")}
                className="flex w-full items-start gap-2 rounded-sm px-1 py-1 text-start outline-none hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus"
              >
                <span className="w-5 flex-shrink-0 text-end text-[12px] tabular-nums text-text-tertiary">{index + 1}</span>
                <SiteBadge hostname={host} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-5 text-text-primary">{title}</span>
                  <span className="block truncate text-[12px] text-text-tertiary">
                    {[source.site || host, source.published ? dayOf(source.published) : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
