import { useContext, useEffect, useState } from "react";
import { Icon } from "../ui";
import { translate } from "../i18n";
import { copyText } from "../utils";
import { logSwallow } from "../logger";
import { isDarkTheme, renderMermaid, svgDataUrl, svgToPng, svgWithBackground } from "./mermaid";
import { MermaidStreamingContext } from "./mermaidStreaming";

/** A ```mermaid block: a diagram by default, the source on request. Failures keep the source visible. */

const TOOLBAR_BUTTON =
  "flex items-center gap-1.5 h-7 px-2 rounded-xs text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-raised disabled:opacity-50 disabled:pointer-events-none";

function useDarkTheme(): boolean {
  const [dark, setDark] = useState(isDarkTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDarkTheme()));
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

async function saveFile(format: "svg" | "png", svg: string): Promise<boolean> {
  try {
    const content = format === "svg" ? svgWithBackground(svg) : (await svgToPng(svg)).split(",")[1] ?? "";
    const out = await window.draggy?.exportChat({ defaultName: `mermaid-diagram.${format}`, content, ext: format });
    return out?.saved === true;
  } catch (error) {
    logSwallow("chat", error, "the diagram was not saved");
    return false;
  }
}

export function MermaidBlock({ source }: { source: string }) {
  const streaming = useContext(MermaidStreamingContext);
  const dark = useDarkTheme();
  const [view, setView] = useState<"diagram" | "source">("diagram");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<{ key: string; out: Awaited<ReturnType<typeof renderMermaid>> } | null>(null);
  const key = `${dark ? "d" : "l"}\n${source}`;

  useEffect(() => {
    if (streaming) return;
    let live = true;
    renderMermaid(source, () => !live).then((out) => {
      if (live) setResult({ key, out });
    });
    return () => {
      live = false;
    };
    // key already covers source and theme
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, streaming]);

  const lang = typeof document !== "undefined" ? document.documentElement.lang || "en" : "en";
  const t = (name: string) => translate(lang, name);
  const current = result?.key === key ? result.out : null;

  if (streaming) {
    return (
      <div dir="ltr" data-mermaid="streaming" className="my-4 rounded-md overflow-hidden border border-rule bg-surface-base max-w-full">
        <pre className="m-0 p-4 overflow-x-auto font-mono text-[13px] text-text-secondary whitespace-pre">{source}</pre>
      </div>
    );
  }

  const copySource = async () => {
    const done = await copyText(source);
    setFailed(!done);
    if (!done) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const save = async (format: "svg" | "png") => {
    if (busy || !current?.ok) return;
    setBusy(true);
    setFailed(false);
    setFailed(!(await saveFile(format, current.svg)));
    setBusy(false);
  };

  const ok = current?.ok === true;
  const showSource = view === "source" || (current !== null && !current.ok);
  const label = source.split("\n").find((line) => line.trim()) ?? "";

  return (
    <div dir="ltr" data-mermaid={current === null ? "loading" : current.ok ? "diagram" : "error"} className="my-4 rounded-md overflow-hidden border border-rule bg-surface-base max-w-full">
      <div data-copy-skip className="flex items-center justify-between h-9 ps-4 pe-2 border-b border-rule">
        <span className="font-mono text-[12px] text-text-secondary">mermaid</span>
        <div className="flex items-center gap-1">
          <button type="button" aria-pressed={view === "source"} disabled={!ok} onClick={() => setView(view === "diagram" ? "source" : "diagram")} className={TOOLBAR_BUTTON}>
            <Icon name={view === "diagram" ? "code" : "eye"} size={14} />
            <span>{view === "diagram" ? t("mermaidShowSource") : t("mermaidShowDiagram")}</span>
          </button>
          <button type="button" onClick={copySource} className={TOOLBAR_BUTTON}>
            <Icon name={copied ? "check" : "copy"} size={14} />
            <span>{copied ? t("codeCopied") : t("copyCode")}</span>
          </button>
          <button type="button" disabled={!ok || busy} onClick={() => save("svg")} className={TOOLBAR_BUTTON}>
            <Icon name="download-simple" size={14} />
            <span>{t("mermaidSaveSvg")}</span>
          </button>
          <button type="button" disabled={!ok || busy} onClick={() => save("png")} className={TOOLBAR_BUTTON}>
            <Icon name="image" size={14} />
            <span>{t("mermaidSavePng")}</span>
          </button>
        </div>
      </div>
      {current === null ? (
        <div role="status" className="flex items-center min-h-[120px] p-4 text-[13px] text-text-secondary">{t("mermaidLoading")}</div>
      ) : null}
      {failed ? (
        <div role="status" className="px-4 pt-3 text-[13px] text-text-secondary">{t("mermaidActionFailed")}</div>
      ) : null}
      {current !== null && !current.ok ? (
        <div role="alert" className="flex items-center gap-2 px-4 pt-3 text-[13px] text-text-secondary">
          <Icon name="warning" size={14} />
          <span>{t("mermaidError")}: {current.error}</span>
        </div>
      ) : null}
      {showSource && current !== null ? (
        <pre className="m-0 p-4 overflow-x-auto font-mono text-[13px] text-text-primary whitespace-pre">{source}</pre>
      ) : null}
      {current?.ok && view === "diagram" ? (
        <div className="p-4 flex justify-center overflow-x-auto">
          <img
            src={svgDataUrl(current.svg)}
            alt={`${t("mermaidDiagram")}: ${label}`}
            className="max-w-full max-h-[480px] w-auto h-auto"
          />
        </div>
      ) : null}
    </div>
  );
}
