/* eslint-disable @typescript-eslint/no-explicit-any -- the drivers take untyped fixture JSON and call CJS modules, so their values are dynamic */
/** Runs the pinned runtimes' installs against a real folder, with the download, the unpacker and npm replaced. Shared
 * by the fixture runner and its generator. Each result lists the files that remain (relative, hashed, with their
 * executable bit) and the progress the install reported; the lockfile copies are left out, as they are the app's own. */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const claudeBin = require("../../../electron/providers/claude/binary.cjs");
const codexBin = require("../../../electron/providers/codex/binary.cjs");
const geminiInstall = require("../../../electron/providers/gemini/install.cjs");

const LOCK_FILES = new Set(["package.json", "package-lock.json"]);

function listFiles(root: string, dir = root, out: { path: string; sha256: string; executable: boolean }[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(root, file, out);
    else {
      const relative = path.relative(root, file).split(path.sep).join("/");
      if (LOCK_FILES.has(relative)) continue;
      const sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      out.push({ path: relative, sha256, executable: (fs.statSync(file).mode & 0o111) !== 0 });
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function seed(root: string, existing: string[] = []) {
  for (const file of existing) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "old");
  }
}

function withRoot<T>(existing: string[], body: (root: string) => Promise<T>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-install-"));
  seed(root, existing);
  return body(root).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

const relativeTo = (root: string, value: string | null) => (value ? path.relative(root, value).split(path.sep).join("/") : null);
const messageOf = (error: any) => (error ? String(error.message) : null);

/** Chunks as written to the staging file, one per download callback. */
function chunkBuffers(chunks: string[]) {
  return chunks.map((chunk) => Buffer.from(chunk));
}

export async function runClaudeInstall(input: any): Promise<any> {
  return withRoot(input.existing ?? [], async (root) => {
    const progress: any[] = [];
    const table: Record<string, [string, number]> = {};
    for (const [target, [sha256, size]] of Object.entries(input.table as Record<string, [string, number]>)) table[target] = [sha256, size];
    const chunks = chunkBuffers(input.chunks ?? []);
    let result: string | null = null;
    let error: string | null = null;
    try {
      result = await claudeBin.ensureClaude(root, {
        platformName: input.platformName,
        arch: input.arch,
        musl: input.musl ?? false,
        assets: table,
        onProgress: (p: any) => progress.push({ completed: p.completed, total: p.total, percent: p.percent }),
        download: async (_url: string, file: string, onBytes: (n: number) => void) => {
          if (input.refuse) throw new Error(input.refuse);
          for (const chunk of chunks) {
            fs.appendFileSync(file, chunk);
            onBytes(chunk.length);
          }
        },
      });
    } catch (caught: any) {
      error = messageOf(caught);
    }
    return { result: relativeTo(root, result), files: listFiles(root), progress, error };
  });
}

export async function runCodexInstall(input: any): Promise<any> {
  return withRoot(input.existing ?? [], async (root) => {
    const progress: any[] = [];
    const table: Record<string, [string, string, number]> = {};
    for (const [target, [name, sha256, size]] of Object.entries(input.table as Record<string, [string, string, number]>)) table[target] = [name, sha256, size];
    const chunks = chunkBuffers(input.chunks ?? []);
    let result: string | null = null;
    let error: string | null = null;
    try {
      result = await codexBin.ensureCodex(root, {
        platformName: input.platformName,
        arch: input.arch,
        assets: table,
        onProgress: (p: any) => progress.push({ completed: p.completed, total: p.total, percent: p.percent }),
        download: async (_url: string, file: string, onBytes: (n: number) => void) => {
          if (input.refuse) throw new Error(input.refuse);
          for (const chunk of chunks) {
            fs.appendFileSync(file, chunk);
            onBytes(chunk.length);
          }
        },
        extract: async (_archive: string, dir: string) => {
          fs.writeFileSync(path.join(dir, "codex-app-server-x86_64-unknown-linux-musl"), "app");
        },
      });
    } catch (caught: any) {
      error = messageOf(caught);
    }
    return { result: relativeTo(root, result), files: listFiles(root), progress, error };
  });
}

export async function runGeminiInstall(input: any): Promise<any> {
  return withRoot(input.existing ?? [], async (root) => {
    let result: string | null = null;
    let error: string | null = null;
    try {
      result = await geminiInstall.ensureGemini(root, {
        pollMs: 1e9,
        resolveNpm: () => (input.npm ? { file: "npm", prefixArgs: [] } : null),
        run: async ({ cwd }: { cwd: string }) => {
          if (input.npmCode !== undefined && input.npmCode !== 0) return { code: input.npmCode, stderr: input.stderr ?? "" };
          const entry = path.join(cwd, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js");
          fs.mkdirSync(path.dirname(entry), { recursive: true });
          fs.writeFileSync(entry, "console.log(1)");
          return { code: 0, stderr: "" };
        },
      });
    } catch (caught: any) {
      error = messageOf(caught);
    }
    const files = listFiles(root).filter((file) => !/^gemini\/cli\/0\.61\.0\/package(-lock)?\.json$/.test(file.path));
    return { result: relativeTo(root, result), files, error };
  });
}
