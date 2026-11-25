import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { DiffLine, ParsedFileDiff } from "./diffParser";
import { SYNTAX_THEME } from "../chat/syntaxTheme";
import { prismLanguageOf } from "../canvas/drafts";

/** A run of text and the Prism token classes around it. */
export interface Segment {
  text: string;
  classes: string[];
}

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

interface Highlighter {
  registered: (language: string) => boolean;
  highlight: (value: string, language: string) => HastNode;
}

let loading: Promise<Highlighter> | null = null;

/** Refractor loads on first use, so the chat bundle does not carry it. */
function loadHighlighter(): Promise<Highlighter> {
  loading ??= Promise.all([
    import("refractor"),
    import("refractor/jsx"),
    import("refractor/tsx"),
    import("refractor/toml"),
    import("refractor/powershell"),
    import("refractor/docker"),
  ]).then(([core, ...languages]) => {
    for (const language of languages) core.refractor.register(language.default);
    return core.refractor as unknown as Highlighter;
  });
  return loading;
}

function flatten(node: HastNode, classes: string[], out: Segment[]) {
  if (node.type === "text") {
    out.push({ text: node.value ?? "", classes });
    return;
  }
  const own = node.properties?.className;
  const next = Array.isArray(own) ? [...classes, ...own.map(String)] : classes;
  for (const child of node.children ?? []) flatten(child, next, out);
}

/** Highlights lines together, so strings and comments that span lines keep their colour. */
export function highlightLines(highlighter: Highlighter, language: string, lines: string[]): Segment[][] {
  const flat: Segment[] = [];
  flatten(highlighter.highlight(lines.join("\n"), language), [], flat);
  const result: Segment[][] = [[]];
  for (const segment of flat) {
    segment.text.split("\n").forEach((part, index) => {
      if (index > 0) result.push([]);
      if (part) result[result.length - 1].push({ text: part, classes: segment.classes });
    });
  }
  while (result.length < lines.length) result.push([]);
  return result;
}

export const LINE_TINTS: Record<DiffLine["kind"], string> = {
  added: "bg-[color-mix(in_srgb,var(--ok)_12%,transparent)]",
  removed: "bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]",
  context: "",
};

export const LINE_MARKS: Record<DiffLine["kind"], string> = {
  added: "text-ok",
  removed: "text-danger",
  context: "text-text-tertiary",
};

const styleCache = new Map<string, CSSProperties>();

export function segmentStyle(classes: string[]): CSSProperties | undefined {
  if (classes.length === 0) return undefined;
  const key = classes.join(" ");
  const cached = styleCache.get(key);
  if (cached) return cached;
  const style: CSSProperties = Object.assign({}, ...classes.map((name) => SYNTAX_THEME[name] ?? {}));
  styleCache.set(key, style);
  return style;
}

/** Token runs for every line of a file diff, or null while the highlighter loads or for plain text. */
export function useDiffHighlight(fileDiff: ParsedFileDiff): Map<DiffLine, Segment[]> | null {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const language = prismLanguageOf(fileDiff.newPath || fileDiff.oldPath);

  useEffect(() => {
    if (language === "text") return;
    let live = true;
    loadHighlighter().then(
      (loaded) => live && setHighlighter(() => loaded),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [language]);

  return useMemo(() => {
    if (!highlighter || !highlighter.registered(language)) return null;
    const map = new Map<DiffLine, Segment[]>();
    for (const hunk of fileDiff.hunks) {
      // The old side first, then the new one, which leaves context lines with the new side's runs.
      for (const left of ["added", "removed"] as const) {
        const lines = hunk.lines.filter((line) => line.kind !== left);
        const runs = highlightLines(highlighter, language, lines.map((line) => line.text));
        lines.forEach((line, index) => map.set(line, runs[index]));
      }
    }
    return map;
  }, [highlighter, language, fileDiff]);
}
