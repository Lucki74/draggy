import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { logSwallow } from "../logger";

const SEEN_KEY = "draggy_star_notice";
const COUNT_KEY = "draggy_star_replies";
const REPO_URL = "https://github.com/Lucki74/draggy";
/** Finished replies before the card shows: enough that the user has seen the app work. */
export const STAR_AFTER = 5;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    logSwallow("chat", error, "unsaved, the star card may show again next launch");
  }
}

interface Props {
  generating: boolean;
  t: (key: string) => string;
}

/** Shown once, after a few finished replies: a link to the GitHub repo. Nothing is sent unless the user clicks it. */
export default function StarNotice({ generating, t }: Props) {
  const [dismissed, setDismissed] = useState(() => read(SEEN_KEY) === "1");
  const [count, setCount] = useState(() => Number(read(COUNT_KEY)) || 0);
  const wasGenerating = useRef(generating);

  useEffect(() => {
    if (wasGenerating.current && !generating && !dismissed) {
      const next = count + 1;
      write(COUNT_KEY, String(next));
      setCount(next);
    }
    wasGenerating.current = generating;
  }, [generating, dismissed, count]);

  if (dismissed || generating || count < STAR_AFTER) return null;

  const dismiss = () => {
    write(SEEN_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-rule bg-surface-raised">
      <Icon name="star" size={16} className="flex-shrink-0 text-text-secondary" />
      <p className="flex-1 min-w-0 text-xs font-medium">{t("starNotice")}</p>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        onClick={dismiss}
        className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
      >
        <Icon name="arrow-square-out" size={12} />
        {t("starOnGithub")}
      </a>
      <button
        type="button"
        onClick={dismiss}
        className="p-1 text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
        title={t("dismiss")}
        aria-label={t("dismiss")}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
