import { useEffect, useRef, useState } from "react";
import { Button } from "../ui";
import type { BrowserConsentAsk } from "../types";

type Choice = "session" | "once" | "deny";

/** Main denies a question nobody answered after this long, so the card goes with it. */
const CONSENT_WAIT_MS = 120_000;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** The browser agent asking to act on a site, in the chat where the user is looking. Allow for the
 * session, allow this once, or deny. The always-allow list lives in Settings. */
export default function BrowserConsentCard({ t }: { t: (key: string) => string }) {
  const [ask, setAsk] = useState<BrowserConsentAsk | null>(null);
  const [sending, setSending] = useState(false);
  const firstChoice = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const api = window.electronAPI?.browserAgent;
    if (!api?.onConsent) return;
    return api.onConsent((next: BrowserConsentAsk | null) => {
      setAsk(next);
      setSending(false);
    });
  }, []);

  const askId = ask?.id;
  useEffect(() => {
    if (!askId) return;
    if (!isTyping(document.activeElement)) firstChoice.current?.focus({ preventScroll: false });
    const timer = setTimeout(() => setAsk(null), CONSENT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [askId]);

  if (!ask) return null;

  const answer = async (choice: Choice) => {
    setSending(true);
    try {
      await window.electronAPI?.browserAgent.answerConsent(ask.id, choice);
    } finally {
      setAsk(null);
    }
  };

  const question = t(ask.kind === "site" ? "browserConsentSite" : "browserConsentAction");

  return (
    <div
      role="alertdialog"
      aria-live="polite"
      aria-label={question}
      data-consent={ask.id}
      className="mb-4 rounded-md border border-rule-strong bg-surface-base p-4"
    >
      <p className="text-[13px] text-warn">{question}</p>
      <p className="mt-2 text-[15px] font-medium text-text-primary break-all">{ask.host}</p>
      {ask.detail && <p className="mt-1 text-[13px] text-text-secondary break-words">{ask.detail}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button ref={firstChoice} variant="primary" size="dense" disabled={sending} onClick={() => answer("session")}>
          {t("browserConsentSession")}
        </Button>
        <Button variant="secondary" size="dense" disabled={sending} onClick={() => answer("once")}>
          {t("browserConsentOnce")}
        </Button>
        <Button variant="ghost" size="dense" className="!text-danger" disabled={sending} onClick={() => answer("deny")}>
          {t("browserConsentDeny")}
        </Button>
      </div>
    </div>
  );
}
