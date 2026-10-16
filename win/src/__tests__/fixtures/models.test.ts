// Golden fixtures for the model metadata logic. Each case drives the Electron/TypeScript reference (electron/ggufParser.cjs,
// mmproj.cjs, draftModel.cjs, draftPairing.cjs, shards.cjs, src/modelKinds.ts, modelRecommendations.ts, vram.ts) and checks
// what it returns. core/crates/models/tests/fixtures.rs runs the same inputs against the Rust port, so both must agree.
// Whole numbers in expected output are decimal strings, so 64-bit values survive JSON; `canon` applies the same rule here.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { cannotGenerate, isEmbeddingModel, isImageModel, selectableModels } from "../../modelKinds";
import * as recs from "../../modelRecommendations";
import { FIT_STATUS, RUNTIME_OVERHEAD_GB, USABLE_UNIFIED_FRACTION, USABLE_VRAM_FRACTION, describeFit, describeSplit } from "../../vram";

const require = createRequire(import.meta.url);
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../shared/fixtures/models");

// RUNNERS START
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Case = { name: string; input: unknown; expected: unknown };
type Target = recs.RuntimeTarget;

const gguf = require("../../../electron/ggufParser.cjs") as {
  parseGgufBuffer: (buf: Buffer | null) => unknown;
  parseGgufHeader: (file: string) => unknown;
  readChatTemplate: (file: string) => string | null;
  capabilitiesFromTemplate: (template: string | null) => string[];
};
const mmproj = require("../../../electron/mmproj.cjs") as {
  companionName: (filename: string) => string;
  isCompanionFile: (name: string) => boolean;
  findCompanion: (dir: string, filename: string) => string | null;
  markRefused: (file: string) => void;
  wasRefused: (dir: string, filename: string) => boolean;
};
const draftModel = require("../../../electron/draftModel.cjs") as {
  draftCompanionName: (filename: string) => string;
  isCompanionDraft: (name: string) => boolean;
  findCompanionDraft: (dir: string, filename: string) => string | null;
  markRefused: (file: string) => void;
  wasRefused: (dir: string, filename: string) => boolean;
  resetForTests: () => void;
};
const draftPairing = require("../../../electron/draftPairing.cjs") as {
  FAMILY_DRAFTS: { family: string; vocab: number | null; repo: string; file: string }[];
  familyDraftFor: (header: unknown) => { family: string; vocab: number | null; repo: string; file: string } | null;
  skipReason: (header: unknown, modelBytes: number) => string | null;
  planDraft: (modelPath: string) => unknown;
};
const shards = require("../../../electron/shards.cjs") as {
  parseShard: (filename: string) => unknown;
  shardNames: (filename: string) => string[];
};

/** Whole numbers become decimal strings, everything else stays a JSON number. Mirrors the generator. */
function canon(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite output ${value}`);
    return Number.isInteger(value) ? BigInt(value).toString() : value;
  }
  if (Array.isArray(value)) return value.map((item) => canon(item));
  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = canon(item);
    }
    return out;
  }
  return value as Json;
}

/** Inputs carry plain numbers, except the strings NaN, Infinity and -Infinity for non-finite values. */
function num(value: unknown): number {
  if (value === "NaN") return Number.NaN;
  if (value === "Infinity") return Number.POSITIVE_INFINITY;
  if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
  return value as number;
}

function withTempDir<T>(body: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `draggy-models-${crypto.randomUUID().slice(0, 8)}-`));
  try {
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A file of `size` bytes: `bytes` at the start, zeros after (a sparse file when it is large). */
function writeSized(file: string, size: number, bytes: Buffer = Buffer.alloc(0)): void {
  fs.writeFileSync(file, bytes);
  if (size <= bytes.length) return;
  // NTFS gives the whole length real disk blocks on truncate unless the file is marked sparse first.
  if (process.platform === "win32") spawnSync("fsutil", ["sparse", "setflag", file], { windowsHide: true });
  fs.truncateSync(file, size);
}

function runGguf(input: { hex: string | null }): unknown {
  return withTempDir((dir) => {
    const bytes = input.hex === null ? null : Buffer.from(input.hex, "hex");
    const file = path.join(dir, bytes === null ? "missing.gguf" : "model.gguf");
    if (bytes !== null) fs.writeFileSync(file, bytes);
    const chatTemplate = gguf.readChatTemplate(file);
    return {
      buffer: bytes === null ? null : gguf.parseGgufBuffer(bytes),
      header: gguf.parseGgufHeader(file),
      chatTemplate,
      capabilities: gguf.capabilitiesFromTemplate(chatTemplate),
    };
  });
}

type SequenceStep =
  | { op: "find"; model: string }
  | { op: "wasRefused"; model: string }
  | { op: "refuse"; file: string }
  | { op: "write"; file: string; size: number };

/** Runs the steps in order in one models folder and returns one result per step. */
function runSequence(input: { files?: { name: string; size: number }[]; steps: SequenceStep[] }, kind: "mmproj" | "draft"): unknown[] {
  return withTempDir((dir) => {
    if (kind === "draft") draftModel.resetForTests();
    for (const file of input.files ?? []) writeSized(path.join(dir, file.name), file.size);
    return input.steps.map((step) => {
      if (step.op === "find") {
        const found = kind === "mmproj" ? mmproj.findCompanion(dir, step.model) : draftModel.findCompanionDraft(dir, step.model);
        return found ? path.basename(found) : null;
      }
      if (step.op === "wasRefused") {
        return kind === "mmproj" ? mmproj.wasRefused(dir, step.model) : draftModel.wasRefused(dir, step.model);
      }
      if (step.op === "refuse") {
        if (kind === "mmproj") mmproj.markRefused(path.join(dir, step.file));
        else draftModel.markRefused(path.join(dir, step.file));
        return null;
      }
      writeSized(path.join(dir, step.file), step.size);
      return null;
    });
  });
}

function runMmproj(input: { op: string } & Record<string, unknown>): unknown {
  if (input.op === "companionName") return mmproj.companionName(input.filename as string);
  if (input.op === "isCompanionFile") return mmproj.isCompanionFile(input.name as string);
  return runSequence(input as never, "mmproj");
}

function runDraftModel(input: { op: string } & Record<string, unknown>): unknown {
  if (input.op === "draftCompanionName") return draftModel.draftCompanionName(input.filename as string);
  if (input.op === "isCompanionDraft") return draftModel.isCompanionDraft(input.name as string);
  return runSequence(input as never, "draft");
}

type PlanFile = { name: string; size: number; hex?: string };

function runPlanDraft(input: { files: PlanFile[]; model: string }): unknown {
  return withTempDir((dir) => {
    for (const file of input.files) {
      const bytes = file.hex === undefined ? Buffer.alloc(0) : Buffer.from(file.hex, "hex");
      writeSized(path.join(dir, file.name), file.size, bytes);
    }
    return draftPairing.planDraft(path.join(dir, input.model));
  });
}

function runDraftPairing(input: { op: string } & Record<string, unknown>): unknown {
  if (input.op === "familyDraftFor") {
    const entry = draftPairing.familyDraftFor(input.header);
    return entry === null ? null : { family: entry.family, vocab: entry.vocab, repo: entry.repo, file: entry.file };
  }
  if (input.op === "skipReason") return draftPairing.skipReason(input.header, input.modelBytes as number) ?? null;
  if (input.op === "table") {
    return draftPairing.FAMILY_DRAFTS.map((e) => ({ family: e.family, vocab: e.vocab, repo: e.repo, file: e.file }));
  }
  return runPlanDraft(input as never);
}

function runShards(input: { filename: string }): unknown {
  return { shard: shards.parseShard(input.filename), names: shards.shardNames(input.filename) };
}

function runModelKinds(input: { op: string } & Record<string, unknown>): unknown {
  const caps = (input.capabilities ?? undefined) as string[] | undefined;
  if (input.op === "cannotGenerate") return cannotGenerate(caps);
  if (input.op === "isEmbeddingModel") return isEmbeddingModel(caps);
  if (input.op === "isImageModel") return isImageModel(caps);
  const models = input.models as { name: string; capabilities: string[] }[];
  return selectableModels(models).map((model) => model.name);
}

function runRecommendations(input: { op: string } & Record<string, unknown>): unknown {
  const target = (input.target ?? {}) as Target;
  if (input.op === "ladder") {
    return recs.ggufLadder.map((r) => ({ vram: r.vram, model: r.model, label: r.label, params: r.params, sizeGB: r.sizeGB }));
  }
  if (input.op === "ladderFor") return recs.ladderFor(target).map((r) => r.model);
  if (input.op === "constants") {
    return { USABLE_RAM_FRACTION: recs.USABLE_RAM_FRACTION, CPU_ONLY_RAM_FRACTION: recs.CPU_ONLY_RAM_FRACTION };
  }
  if (input.op === "getRecommendedModel") return recs.getRecommendedModel(num(input.vram), target);
  if (input.op === "getRecommendedDownload") return recs.getRecommendedDownload(num(input.vram), target);
  if (input.op === "chipClassOf") return recs.chipClassOf(input.cpuModel as string | null);
  return recs.supportsMlx(target);
}

function runVram(input: { op: string } & Record<string, unknown>): unknown {
  if (input.op === "fitStatus") return (FIT_STATUS as Record<string, string | undefined>)[input.tone as string] ?? null;
  if (input.op === "constants") return { RUNTIME_OVERHEAD_GB, USABLE_VRAM_FRACTION, USABLE_UNIFIED_FRACTION };
  const fit = describeFit({
    modelBytes: num(input.modelBytes),
    vramGB: num(input.vramGB),
    unifiedMemory: input.unifiedMemory === true,
  });
  return { fit, split: describeSplit(fit) };
}

const RUNNERS: Record<string, (input: never) => unknown> = {
  "gguf.json": (input) => runGguf(input as { hex: string | null }),
  "mmproj.json": (input) => runMmproj(input as { op: string }),
  "draft-model.json": (input) => runDraftModel(input as { op: string }),
  "draft-pairing.json": (input) => runDraftPairing(input as { op: string }),
  "shards.json": (input) => runShards(input as { filename: string }),
  "model-kinds.json": (input) => runModelKinds(input as { op: string }),
  "model-recommendations.json": (input) => runRecommendations(input as { op: string }),
  "vram.json": (input) => runVram(input as { op: string }),
};
// RUNNERS END

import { windowsCases } from "./windowsScope";

describe("models fixtures", () => {
  for (const file of fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort()) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as { cases: Case[] };
    describe(file, () => {
      for (const testCase of windowsCases(file, fixture.cases)) {
        it(testCase.name, () => {
          const runner = RUNNERS[file];
          if (!runner) throw new Error(`no runner for ${file}`);
          expect(canon(runner(testCase.input as never))).toEqual(testCase.expected);
        });
      }
    });
  }
});
