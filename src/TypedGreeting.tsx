import { useEffect, useState } from "react";

/**
 * How long each character waits its turn. Slow enough to read as typing
 * rather than a flicker, quick enough not to keep anyone waiting.
 */
const CHARACTER_MS = 45;

interface TypedGreetingProps {
  text: string;
  className?: string;
}

/**
 * Types a line out one character at a time, with a caret blinking after it.
 *
 * The component holds no memory of earlier text: give it a `key` of the line
 * itself and a new greeting arrives as a fresh component, which starts the
 * typing over without having to reset anything by hand.
 *
 * The animated copy is hidden from screen readers, which are given the whole
 * line at once instead — a greeting delivered a letter at a time is no use to
 * anyone listening.
 */
export default function TypedGreeting({ text, className = "" }: TypedGreetingProps) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= text.length) return;

    const timer = setTimeout(() => setShown(shown + 1), CHARACTER_MS);
    return () => clearTimeout(timer);
  }, [shown, text]);

  return (
    <p className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{text.slice(0, shown)}</span>
      <span aria-hidden="true" className="typing-caret">
        |
      </span>
    </p>
  );
}
