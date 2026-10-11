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

  useEffect(() => {
    const api = window.electronAPI?.browserPane;
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
      const next = hasPage && rect.width > 0 && rect.height > 0 && !overlapsOverlay(rect);
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
  }, [hasPage]);

  return (
    <div className="flex h-full flex-col bg-surface-canvas">
      <BrowserBar t={t} embedded onState={setPage} />
      <div ref={bodyRef} className="relative min-h-0 flex-1" data-browser-body>
        {!hasPage && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Icon name="globe-simple" size={20} className="text-text-tertiary" />
            <p className="max-w-64 text-[13px] leading-5 text-text-secondary">{t("browserEmpty")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
