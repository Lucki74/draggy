import { useEffect, useState } from "react";

/** How long each character waits its turn. Slow enough to read as typing rather than a flicker,
 * quick enough not to keep anyone waiting. */
const CHARACTER_MS = 45;

interface TypedGreetingProps {
  text: string;
  className?: string;
}

/** Types a line out a character at a time. Keyed by the line, so a new greeting restarts it; screen
 * readers are given the whole line at once instead. */
export default function TypedGreeting({ text, className = "" }: TypedGreetingProps) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= text.length) return;

    let frame = 0;
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        setShown((prev) => Math.min(prev + 1, text.length));
      });
    }, CHARACTER_MS);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [shown, text]);

  return (
    <p className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, shown).split("").map((char, index) => (
          <span key={index} className="typing-char">
            {char}
          </span>
        ))}
      </span>
      <span aria-hidden="true" className="typing-caret">
        |
      </span>
    </p>
  );
}
