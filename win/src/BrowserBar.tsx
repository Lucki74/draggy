import { useEffect, useRef, useState } from "react";
import { IconButton } from "./ui/IconButton";
import { Icon } from "./ui/icons/Icon";
import { Menu, type MenuEntry } from "./ui/Menu";
import { EMPTY_BROWSER_STATE, type BrowserState } from "./browser/browserState";
import type { BrowserConsentAsk } from "./types";

/** The chrome above an opened page. The page itself is a separate view in the web session, so the
 * bar keeps the app's policy and the page gets none of it. Everything below goes through IPC.
 *
 * Two homes: the header of the Browser pane (`embedded`), and the top of the separate browser
 * window, which still opens when the user pops a page out. */

type Action = "back" | "forward" | "reload" | "stop" | "navigate" | "external" | "popout";

const AGENT_STEP_KEYS: Record<string, string> = {
  navigating: "browserAgentNavigating",
  reading: "browserAgentReading",
  clicking: "browserAgentClicking",
  typing: "browserAgentTyping",
  pressing: "browserAgentPressing",
};

interface BrowserBarProps {
  t: (key: string) => string;
  /** In the Browser pane rather than its own window. Adds "Pop out" and leaves menu room alone. */
  embedded?: boolean;
  onState?: (state: BrowserState) => void;
}

export default function BrowserBar({ t, embedded = false, onState }: BrowserBarProps) {
  const [state, setState] = useState<BrowserState>(EMPTY_BROWSER_STATE);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /** Whether the address bar belongs to the user now. A ref, because the subscription is registered
   * once and would close over the first value. */
  const editingRef = useRef(false);
  const onStateRef = useRef(onState);
  useEffect(() => {
    onStateRef.current = onState;
  });

  useEffect(() => {
    const api = window.electronAPI?.browserBar;
    if (!api) return;

    return api.onState((next: BrowserState) => {
      setState(next);
      onStateRef.current?.(next);
      // A page finishing its load must not overwrite a half-typed address.
      if (!editingRef.current) setDraft(next.url);
    });
  }, []);

  const [agent, setAgent] = useState<{ active: boolean; step: string | null }>({ active: false, step: null });
  useEffect(() => {
    // Only the pane is driven by the agent; the separate window has no agent step to show.
    const api = window.electronAPI?.browserAgent;
    if (!embedded || !api) return;
    return api.onState(setAgent);
  }, [embedded]);

  const [ask, setAsk] = useState<BrowserConsentAsk | null>(null);
  useEffect(() => {
    const api = window.electronAPI?.browserAgent;
    if (!embedded || !api) return;
    return api.onConsent(setAsk);
  }, [embedded]);
  const answer = (choice: "session" | "once" | "always" | "deny") => {
    if (ask) void window.electronAPI?.browserAgent.answerConsent(ask.id, choice);
    setAsk(null);
  };

  const act = (name: Action, value?: string) => window.electronAPI?.browserBar.action(name, value);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    editingRef.current = false;
    inputRef.current?.blur();
    act("navigate", draft);
  };

  const hasPage = Boolean(state.url) && state.url !== "about:blank";

  const items: MenuEntry[] = [
    {
      id: "adblock",
      label: t("adBlocker"),
      icon: <Icon name="shield" size={16} />,
      checked: state.adblock,
      toggle: true,
      onSelect: () => window.electronAPI?.browserBar.setAdblock(!state.adblock),
    },
    { type: "separator", id: "sep" },
    {
      id: "external",
      label: t("browserOpenExternal"),
      icon: <Icon name="globe-simple" size={16} />,
      disabled: !/^https?:\/\//i.test(state.url),
      onSelect: () => act("external"),
    },
    ...(embedded
      ? [
          {
            id: "popout",
            label: t("browserPopOut"),
            icon: <Icon name="arrow-square-out" size={16} />,
            disabled: !hasPage,
            onSelect: () => act("popout"),
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-10 w-full flex-shrink-0 items-center gap-0.5 border-b border-rule bg-surface-canvas px-1.5">
      <IconButton
        name="arrow-left"
        size="dense"
        mirrored
        label={t("browserBack")}
        disabled={!state.canGoBack}
        onClick={() => act("back")}
      />
      <IconButton
        name="arrow-right"
        size="dense"
        mirrored
        label={t("browserForward")}
        disabled={!state.canGoForward}
        onClick={() => act("forward")}
      />
      <IconButton
        name={state.loading ? "x" : "arrow-clockwise"}
        size="dense"
        label={state.loading ? t("browserStop") : t("browserReload")}
        disabled={!hasPage && !state.loading}
        onClick={() => act(state.loading ? "stop" : "reload")}
      />

      <form onSubmit={submit} className="min-w-0 flex-1 px-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => {
            editingRef.current = true;
            event.target.select();
          }}
          onBlur={() => {
            editingRef.current = false;
            setDraft(state.url);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft(state.url);
              inputRef.current?.blur();
            }
          }}
          placeholder={t("browserAddress")}
          aria-label={t("browserAddress")}
          className="h-7 w-full truncate rounded-md border border-rule-control bg-surface-base px-2.5 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-focus"
        />
      </form>

      {ask && (
        <div
          role="alertdialog"
          aria-label={t(ask.kind === "site" ? "browserConsentSite" : "browserConsentAction")}
          className="flex min-w-0 flex-shrink items-center gap-2 text-[12px] text-text-primary"
        >
          <span className="truncate">
            {t(ask.kind === "site" ? "browserConsentSite" : "browserConsentAction")} <strong>{ask.host}</strong>
            {ask.detail ? `: ${ask.detail}` : ""}
          </span>
          {(ask.kind === "site" ? (["session", "always"] as const) : (["once", "always"] as const)).map((choice) => (
            <button key={choice} type="button" onClick={() => answer(choice)} className="h-7 flex-shrink-0 rounded-md border border-rule-control px-2 text-[12px] text-text-primary hover:bg-surface-raised">
              {t(choice === "session" ? "browserConsentSession" : choice === "once" ? "browserConsentOnce" : "browserConsentTrust")}
            </button>
          ))}
          <button type="button" onClick={() => answer("deny")} className="h-7 flex-shrink-0 rounded-md border border-rule-control px-2 text-[12px] text-text-primary hover:bg-surface-raised">
            {t("browserConsentDeny")}
          </button>
        </div>
      )}
      {agent.active && !ask && (
        <>
          <span role="status" className="flex-shrink-0 truncate text-[12px] text-text-secondary">
            {t(AGENT_STEP_KEYS[agent.step ?? ""] ?? "browserAgentWorking")}
          </span>
          <button
            type="button"
            onClick={() => window.electronAPI?.browserAgent.stop()}
            className="h-7 flex-shrink-0 rounded-md border border-rule-control px-2 text-[12px] text-text-primary hover:bg-surface-raised"
          >
            {t("browserAgentTakeOver")}
          </button>
        </>
      )}
      <Menu
        label={t("browserSettings")}
        align="end"
        items={items}
        // The separate window draws the menu inside the toolbar view, which has to grow to fit it.
        onOpenChange={embedded ? undefined : (open) => window.electronAPI?.browserBar.setMenuOpen(open)}
        trigger={(props) => <IconButton {...props} name="dots-three" size="dense" label={t("browserSettings")} />}
      />
    </div>
  );
}
