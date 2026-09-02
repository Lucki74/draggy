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
 * Types a line out a character at a time. Keyed by the line, so a new greeting
 * restarts it; screen readers are given the whole line at once instead.
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
