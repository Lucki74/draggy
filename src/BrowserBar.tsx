import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  RotateCw,
  Settings2,
  Shield,
  X,
} from "lucide-react";
import { translations } from "./translations";

/**
 * The chrome above a page the user opened.
 *
 * It is a separate view from the page below it, which is the whole point:
 * the toolbar keeps the app's protocol, policy and styling, and the page
 * gets none of them. Everything here goes through IPC to the window that
 * owns both views, because this view cannot reach the page directly.
 */

interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  adblock: boolean;
}

const EMPTY: BrowserState = {
  url: "",
  title: "",
  canGoBack: false,
  canGoForward: false,
  loading: false,
  adblock: true,
};

export default function BrowserBar({ language }: { language: string }) {
  const t = useCallback(
    (key: string) =>
      translations[language]?.[key] || translations["en"][key] || key,
    [language],
  );

  const [state, setState] = useState<BrowserState>(EMPTY);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * Whether the address bar belongs to the user right now. A ref rather than
   * state because the subscription below is registered once and would
   * otherwise close over the value it saw on the first render.
   */
  const editingRef = useRef(false);

  useEffect(() => {
    const api = window.electronAPI?.browserBar;
    if (!api) return;

    api.onState((next: BrowserState) => {
      setState(next);
      // A page finishing its load must not overwrite a half-typed address.
      if (!editingRef.current) setDraft(next.url);
    });

    return () => api.offState();
  }, []);

  /**
   * Opening the menu also asks for the room to draw it, since the toolbar is
   * its own view and clips anything past its bounds. Every path that changes
   * the menu goes through here so the two can never disagree.
   */
  const showMenu = useCallback((open: boolean) => {
    setMenuOpen(open);
    window.electronAPI?.browserBar.setMenuOpen(open);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        showMenu(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") showMenu(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, showMenu]);

  type Action = "back" | "forward" | "reload" | "stop" | "navigate";

  const act = (name: Action, value?: string) =>
    window.electronAPI?.browserBar.action(name, value);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    editingRef.current = false;
    inputRef.current?.blur();
    act("navigate", draft);
  };

  const toggleAdblock = () => {
    window.electronAPI?.browserBar.setAdblock(!state.adblock);
    showMenu(false);
  };

  return (
    <div className="h-12 w-full flex items-center gap-1.5 px-2 bg-[var(--bg-base)] border-b-[3px] border-[var(--border-light)]">
      <IconButton
        onClick={() => act("back")}
        disabled={!state.canGoBack}
        label={t("browserBack")}
      >
        <ArrowLeft className="w-4 h-4" />
      </IconButton>

      <IconButton
        onClick={() => act("forward")}
        disabled={!state.canGoForward}
        label={t("browserForward")}
      >
        <ArrowRight className="w-4 h-4" />
      </IconButton>

      <IconButton
        onClick={() => act(state.loading ? "stop" : "reload")}
        label={state.loading ? t("browserStop") : t("browserReload")}
      >
        {state.loading ? (
          <X className="w-4 h-4" />
        ) : (
          <RotateCw className="w-4 h-4" />
        )}
      </IconButton>

      <form onSubmit={submit} className="flex-1 min-w-0 px-1">
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
          className="w-full px-3 py-1.5 ui-input text-xs font-bold truncate"
        />
      </form>

      <div className="relative flex-shrink-0" ref={menuRef}>
        <IconButton
          onClick={() => showMenu(!menuOpen)}
          label={t("browserSettings")}
          active={menuOpen}
        >
          <Settings2 className="w-4 h-4" />
        </IconButton>

        {menuOpen && (
          <div className="absolute top-full right-0 mt-1.5 z-50 ui-box p-1 w-60">
            <button
              type="button"
              onClick={toggleAdblock}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-[var(--hover-bg)] transition-colors"
            >
              <Shield className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 min-w-0 text-[11px] font-bold">
                {t("adBlocker")}
              </span>
              <span
                className={`flex items-center justify-center w-4 h-4 rounded flex-shrink-0 border-2 ${
                  state.adblock
                    ? "bg-[var(--bg-inverted)] border-transparent text-[var(--text-inverted)]"
                    : "border-[var(--border-light)]"
                }`}
              >
                {state.adblock && <Check className="w-3 h-3" />}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({
  onClick,
  disabled,
  label,
  active,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active
          ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
          : "text-[var(--text-main)] hover:bg-[var(--hover-bg)]"
      }`}
    >
      {children}
    </button>
  );
}
