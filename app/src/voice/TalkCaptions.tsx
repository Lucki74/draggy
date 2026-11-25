import { useEffect, useRef } from "react";
import type { Utterance } from "./conversation";

/** Both sides of the conversation as text. Two lines under the dragon while talking, or the whole
 * history when asked for. Required for anyone who cannot hear the voice (section 9). */

interface TalkCaptionsProps {
  turns: Utterance[];
  /** What the user is saying right now, before it becomes a turn. */
  draft: string;
  history: boolean;
  t: (key: string) => string;
}

export default function TalkCaptions({ turns, draft, history, t }: TalkCaptionsProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (history) endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, draft, history]);

  if (history) {
    return (
      <div className="flex max-h-72 w-full max-w-2xl flex-col gap-3 overflow-y-auto px-6" aria-label={t("transcript")}>
        {turns.map((turn) => (
          <p
            key={turn.id}
            className={`text-[15px] leading-6 ${turn.role === "user" ? "text-text-secondary" : "text-text-primary"}`}
          >
            <span className="me-2 text-[12px] text-text-tertiary">{turn.role === "user" ? t("talkYou") : "Draggy"}</span>
            {turn.text}
            {turn.cut && <span className="text-text-tertiary"> {t("interrupted")}</span>}
          </p>
        ))}
        {draft && <p className="text-[15px] leading-6 text-text-tertiary">{draft}</p>}
        <div ref={endRef} />
      </div>
    );
  }

  const last = draft
    ? { text: draft, mine: true }
    : turns.length
      ? { text: turns[turns.length - 1].text, mine: turns[turns.length - 1].role === "user" }
      : null;

  return (
    // Polite, so a screen reader reads each settled line without talking over the voice.
    // The box is two lines tall and pinned to its bottom, so a growing reply shows its latest words.
    <div className="flex h-[60px] w-full max-w-2xl flex-col justify-end overflow-hidden px-6" aria-live="polite">
      {last && (
        <p className={`text-center text-[20px] leading-[30px] ${last.mine ? "text-text-secondary" : "text-text-primary"}`}>
          {last.text}
        </p>
      )}
    </div>
  );
}
