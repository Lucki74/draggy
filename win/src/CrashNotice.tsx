import { useEffect, useState } from "react";
import { Button } from "./ui";
import { swallowed } from "./logger";

type Translate = (key: string) => string;

/** Shown once after a run that ended without a clean quit, with a way to the diagnostics export. */
export function CrashNotice({ t, onExport }: { t: Translate; onExport: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    window.electronAPI?.diagnostics
      ?.crashNotice()
      .then((result) => setVisible(Boolean(result?.show)))
      .catch(swallowed("lifecycle", "the notice is optional"));
  }, []);

  if (!visible) return null;
  return (
    <div role="status" className="fixed bottom-4 start-4 z-40 flex max-w-sm flex-col gap-3 rounded-md bg-surface-base p-4 text-[13px] leading-5 text-text-primary shadow-[0_0_0_1px_var(--rule-strong)]">
      <p>{t("diagCrashNotice")}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="dense" onClick={() => setVisible(false)}>
          {t("dismiss")}
        </Button>
        <Button
          variant="secondary"
          size="dense"
          onClick={() => {
            setVisible(false);
            onExport();
          }}
        >
          {t("diagExport")}
        </Button>
      </div>
    </div>
  );
}
