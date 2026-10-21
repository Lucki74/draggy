import { useEffect, useRef, useState } from "react";
import { swallowed } from "../logger";

interface WordPreviewProps {
  base64: string;
  onFail: () => void;
}

function bytesOf(base64: string): Uint8Array {
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** A .docx drawn by a Word layout engine: page boxes, page breaks, the file's own fonts and styles. */
export function WordPreview({ base64, onFail }: WordPreviewProps) {
  const pages = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const host = pages.current;
    if (!host) return;

    void (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        await renderAsync(bytesOf(base64), host, undefined, {
          className: "word-page",
          inWrapper: true,
          breakPages: true,
          ignoreWidth: false,
          ignoreHeight: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
        });
        if (!cancelled) setReady(true);
      } catch (failure) {
        swallowed("preview.word", "the file falls back to its text")(failure);
        if (!cancelled) onFail();
      }
    })();

    return () => {
      cancelled = true;
      host.replaceChildren();
    };
  }, [base64, onFail]);

  return <div ref={pages} data-ready={ready} className="word-pages" />;
}
