// Runs the shared secrets fixtures (shared/fixtures/secrets/*.json) against electron/secrets.cjs, the reference.
// core/crates/storage/tests/secrets.rs reads the same files; a case must pass in both runners.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const secrets = require("../../../electron/secrets.cjs") as SecretsApi;

const FIXTURES = fileURLToPath(new URL("../../../../shared/fixtures/secrets/", import.meta.url));

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface Vault {
  encryptionAvailable?: boolean | "throws";
  backend?: string | null | "throws";
  encrypt?: "throws";
  decrypt?: "throws";
}

interface Op {
  call: string;
  args?: Json[];
}

interface CaseInput {
  vault?: Vault;
  container?: string;
  ops?: Op[];
  blob?: string;
  password?: string;
  scheme?: "linux" | "macos";
}

interface FixtureCase {
  name: string;
  input: CaseInput;
  expected: unknown;
}

interface FixtureFile {
  area: string;
  description: string;
  cases: FixtureCase[];
}

/** The part of electron/secrets.cjs the runner calls. */
interface SecretsApi {
  init(dir: string, vault: unknown): string;
  close(): void;
  available(): boolean;
  get(owner: string): unknown;
  set(owner: string, values: unknown): boolean;
  remove(owner: string): boolean;
  owners(): string[];
  withSecrets(owner: string, env: unknown): unknown;
  adopt(records: unknown, isSecret: (field: string, owner: string) => boolean): { moved: number; records: unknown };
}

const files = fs
  .readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".json"))
  .sort();

for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8")) as FixtureFile;

  describe(`secrets fixtures: ${file}`, () => {
    for (const fixtureCase of fixture.cases) {
      it(fixtureCase.name, () => {
        expect(runCase(fixtureCase.input)).toEqual(fixtureCase.expected);
      });
    }
  });
}

/** Mirrors the fake in electron/secrets.test.js: base64 both ways, with the availability, backend and failures the case sets. */
function fakeVault(spec: Vault): Record<string, unknown> {
  const vault: Record<string, unknown> = {
    isEncryptionAvailable: () => {
      if (spec.encryptionAvailable === "throws") throw new Error("keystore check failed");
      return spec.encryptionAvailable ?? true;
    },
    encryptString: (text: string) => {
      if (spec.encrypt === "throws") throw new Error("keystore refused to encrypt");
      return Buffer.from(text, "utf8").toString("base64");
    },
    decryptString: (buffer: Buffer) => {
      if (spec.decrypt === "throws") throw new Error("keystore refused the blob");
      return Buffer.from(String(buffer), "base64").toString("utf8");
    },
  };
  if (spec.backend !== undefined && spec.backend !== null) {
    vault.getSelectedStorageBackend = () => {
      if (spec.backend === "throws") throw new Error("Linux only");
      return spec.backend;
    };
  }
  return vault;
}

function runCase(input: CaseInput): unknown {
  if (input.blob !== undefined) return decryptV10(input.blob, input.password ?? "", input.scheme ?? "linux");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-secrets-fixture-"));
  const vault = fakeVault(input.vault ?? {});
  try {
    if (input.container !== undefined) fs.writeFileSync(path.join(dir, "secrets.bin"), input.container);
    secrets.init(dir, vault);
    return runOps(dir, vault, input.ops ?? []);
  } finally {
    secrets.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs the ops in order and returns each result. `container` and `fileContains` read the store file itself. */
function runOps(dir: string, vault: Record<string, unknown>, ops: Op[]): unknown[] {
  const file = path.join(dir, "secrets.bin");
  return ops.map(({ call, args = [] }) => {
    switch (call) {
      case "set":
        return secrets.set(args[0] as string, args[1]);
      case "get":
        return secrets.get(args[0] as string);
      case "remove":
        return secrets.remove(args[0] as string);
      case "owners":
        return secrets.owners();
      case "withSecrets":
        return secrets.withSecrets(args[0] as string, args[1]);
      case "adopt": {
        const marker = args[1] as string;
        const { moved, records } = secrets.adopt(args[0], (field) => field.toUpperCase().includes(marker));
        return { moved, records };
      }
      case "available":
        return secrets.available();
      case "reopen":
        secrets.close();
        secrets.init(dir, vault);
        return null;
      case "close":
        secrets.close();
        return null;
      case "container":
        return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      case "fileContains":
        return fs.existsSync(file) && fs.readFileSync(file).includes(String(args[0]));
      case "writeContainer":
        fs.writeFileSync(file, String(args[0]));
        return null;
      case "makeDirectory":
        fs.mkdirSync(file);
        return null;
      default:
        throw new Error(`unknown call ${call}`);
    }
  });
}

/**
 * Electron's v10 blobs have no TS decoder, so Node's crypto stands in for Chromium. Each answer is re-derived from the
 * scheme: the prefix, the block length, then AES-128-CBC with the PBKDF2 key, an IV of spaces, and PKCS#7 padding.
 * The macOS scheme runs 1003 PBKDF2 rounds, the Linux scheme one.
 */
function decryptV10(blobBase64: string, password: string, scheme: "linux" | "macos"): unknown {
  const blob = Buffer.from(blobBase64, "base64");
  if (!blob.subarray(0, 3).equals(Buffer.from("v10"))) return { error: "not_v10" };
  const body = blob.subarray(3);
  if (body.length === 0 || body.length % 16 !== 0) return { error: "bad_length" };

  const rounds = scheme === "macos" ? 1003 : 1;
  const key = crypto.pbkdf2Sync(password, "saltysalt", rounds, 16, "sha1");
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  try {
    return { plaintext: Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8") };
  } catch {
    return { error: "bad_padding" };
  }
}
