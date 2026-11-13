import { useEffect, useRef, useState } from "react";
import BrowserBar from "../BrowserBar";
import { EMPTY_BROWSER_STATE, type BrowserState } from "./browserState";
import { Icon } from "../ui/icons/Icon";
import { overlapsOverlay, subscribeOverlays } from "../ui/overlays";

/** The Browser pane. The page is a native view main lays over the body of this pane; this component
 * only reports where the body is and whether the page should show. A native view draws above all
 * HTML, so the page steps aside while a menu or dialog overlaps it. */
export default function BrowserPane({ t }: { t: (key: string) => string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<BrowserState>(EMPTY_BROWSER_STATE);
  const hasPage = page.loading || (Boolean(page.url) && page.url !== "about:blank");
  // A failed load has no page to show, so the native view steps aside for the error panel.
  const showPage = hasPage && !page.error;

  useEffect(() => {
    const api = window.draggy?.browserPane;
    const body = bodyRef.current;
    if (!api || !body) return;

    let shown: boolean | null = null;
    let last = "";

    const sync = () => {
      const rect = body.getBoundingClientRect();
      const key = `${rect.left},${rect.top},${rect.width},${rect.height}`;
      if (key !== last) {
        last = key;
        api.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      }
      const next = showPage && rect.width > 0 && rect.height > 0 && !overlapsOverlay(rect);
      if (next !== shown) {
        shown = next;
        api.setVisible(next);
      }
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(body);
    // A dock sliding in or the window resizing moves the body without resizing it.
    window.addEventListener("resize", sync);
    document.addEventListener("transitionend", sync, true);
    const unsubscribe = subscribeOverlays(sync);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      document.removeEventListener("transitionend", sync, true);
      unsubscribe();
      api.setVisible(false);
    };
  }, [showPage]);

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <div className="flex h-full flex-col bg-surface-canvas">
      <BrowserBar t={t} embedded onState={setPage} />
      {page.loading && (
        <div role="progressbar" aria-label={t("browserLoading")} className="h-0.5 w-full animate-pulse bg-accent-ink" />
      )}
      <div ref={bodyRef} className="relative min-h-0 flex-1" data-browser-body>
        {!hasPage && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Icon name="globe-simple" size={20} className="text-text-tertiary" />
            <p className="max-w-64 text-[13px] leading-5 text-text-secondary">{t("browserEmpty")}</p>
          </div>
        )}
        {hasPage && page.error && (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Icon name="warning" size={20} className="text-text-tertiary" />
            <p className="max-w-72 text-[13px] leading-5 text-text-secondary">
              {offline ? t("browserOffline") : t("browserLoadFailed")}
            </p>
            <button
              type="button"
              onClick={() => window.draggy?.browserNavigate(page.url)}
              className="h-7 rounded-pill bg-surface-raised px-3 text-[12px] font-medium text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] hover:bg-surface-base focus-visible:ring-2 focus-visible:ring-focus"
            >
              {t("browserRetry")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
