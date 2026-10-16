import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// This tree ships for Windows only. The macOS and Linux apps live in their own folders, so a
// platform branch creeping back in here is dead code that no one runs.
const BANNED = [
  /\bIS_MAC\b/,
  /\bIS_LINUX\b/,
  /\bhasUnifiedMemory\b/,
  /["'`]darwin["'`]/,
  /["'`]linux["'`]/,
  /\bmacOS\b/,
  /LD_LIBRARY_PATH/,
  /libcudart\.so/,
];

// Shared fixtures pin these cross-platform behaviours, so the code must keep them for now.
const ALLOWED = new Set(["secrets.cjs", "commands.cjs"]);

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "schema" || entry.name === "node_modules" ? [] : sources(full);
    return /\.cjs$/.test(entry.name) && !ALLOWED.has(entry.name) ? [full] : [];
  });
}

export function offences(files, read = (file) => fs.readFileSync(file, "utf8")) {
  return files.flatMap((file) =>
    read(file)
      .split(/\r?\n/)
      .flatMap((line, index) => (BANNED.some((pattern) => pattern.test(line)) ? [`${path.basename(file)}:${index + 1}: ${line.trim()}`] : [])),
  );
}

describe("platform scope", () => {
  it("keeps macOS and Linux branches out of the main process", () => {
    expect(offences(sources(__dirname))).toEqual([]);
  });

  it("notices a platform branch when one comes back", () => {
    expect(offences(["x.cjs"], () => "if (platform.IS_MAC) {}")).toHaveLength(1);
    expect(offences(["x.cjs"], () => 'if (process.platform === "linux") {}')).toHaveLength(1);
    expect(offences(["x.cjs"], () => "if (platform.IS_WINDOWS) {}")).toEqual([]);
  });
});
