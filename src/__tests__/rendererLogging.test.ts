import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

/** Local asset loads that carry no engine or provider traffic, and the logger's own wrapper. */
const FETCH_ALLOWED = new Map([
  ["logger.ts", "the loggedFetch wrapper itself"],
  ["chat/ImageCard.tsx", "reads an in-memory blob or data URL; loggedFetch would put the payload in the log line"],
  ["voice/supertonicWorker.ts", "worker: no access to the renderer logger"],
  ["voice/vadWorker.ts", "worker: no access to the renderer logger"],
]);

function codeLines(file: string): Array<{ no: number; text: string }> {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((text, index) => ({ no: index + 1, text }))
    .filter(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text));
}

describe("renderer logging rules", () => {
  it("has no console.* call in src outside tests", () => {
    const hits = sources(SRC).flatMap((file) =>
      codeLines(file)
        .filter(({ text }) => /\bconsole\s*\.\s*(log|warn|error|info|debug|trace)\s*\(/.test(text))
        .map(({ no }) => `${rel(file)}:${no}`),
    );
    expect(hits).toEqual([]);
  });

  it("has no raw fetch outside the allowlist", () => {
    const hits = sources(SRC)
      .filter((file) => !FETCH_ALLOWED.has(rel(file)))
      .flatMap((file) =>
        codeLines(file)
          .filter(({ text }) => /(^|[^.\w])fetch\s*\(/.test(text))
          .map(({ no }) => `${rel(file)}:${no}`),
      );
    expect(hits).toEqual([]);
  });

  it("keeps every allowlisted file real", () => {
    for (const file of FETCH_ALLOWED.keys()) expect(fs.existsSync(path.join(SRC, file))).toBe(true);
  });
});
