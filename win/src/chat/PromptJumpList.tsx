import { useEffect, useRef } from "react";

/** Past this many prompts a session is long enough to need a way back to an earlier one. */
export const JUMP_LIST_MIN_PROMPTS = 8;

export interface PromptMark {
  id: string;
  text: string;
}

/** A slim column of ticks along the transcript's end edge, one per prompt you sent. Local models
 * write no chapter markers, so your own turns are the anchors. */
export function PromptJumpList({
  prompts,
  current,
  onJump,
  t,
}: {
  prompts: PromptMark[];
  current: string | null;
  onJump: (id: string) => void;
  t: (key: string) => string;
}) {
  const list = useRef<HTMLElement>(null);

  // More ticks than fit scroll, so keep the one for the prompt on screen centred as the chat moves.
  useEffect(() => {
    const nav = list.current;
    const tick = nav?.querySelector<HTMLElement>("[aria-current]")?.parentElement;
    if (!nav || !tick || nav.scrollHeight <= nav.clientHeight) return;
    nav.scrollTop = tick.offsetTop - (nav.clientHeight - tick.offsetHeight) / 2;
  }, [current, prompts.length]);

  if (prompts.length < JUMP_LIST_MIN_PROMPTS) return null;

  return (
    <nav
      ref={list}
      aria-label={t("yourPrompts")}
      className="absolute end-5 top-10 bottom-14 w-6 flex flex-col overflow-y-auto [scrollbar-width:none]"
    >
      <ol className="my-auto flex flex-col">
        {prompts.map((prompt, index) => {
          const label = `${index + 1}. ${prompt.text.replace(/\s+/g, " ").trim().slice(0, 80) || t("attachments")}`;
          const here = prompt.id === current;
          return (
            <li key={prompt.id} className="flex">
              <button
                type="button"
                onClick={() => onJump(prompt.id)}
                aria-label={label}
                aria-current={here ? "location" : undefined}
                title={label}
                className="group relative w-full flex justify-end items-center py-1.5 cursor-pointer"
              >
                <span
                  className={`block h-1 rounded-full transition-[width,background-color] duration-120 motion-reduce:transition-none ${
                    here ? "w-5 bg-text-primary" : "w-3 bg-rule-strong group-hover:w-5 group-hover:bg-text-secondary"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
