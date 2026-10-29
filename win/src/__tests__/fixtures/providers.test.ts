/* eslint-disable @typescript-eslint/no-explicit-any -- the drivers take untyped fixture JSON and call CJS modules, so their values are dynamic */
// Golden fixtures for the provider logic in electron/providers (SSE writer, failures, catalog, request and answer
// translation, model listings, registry, signed catalog, discovery). Each case drives the Electron/CJS reference and
// returns what it produced, normalised to the neutral shapes the Rust port uses. core/crates/providers/tests/fixtures.rs
// runs the same inputs against the port, so both must agree. Stream events are recorded as the neutral event list.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const sseMod = require("../../../electron/providers/sse.cjs");
const usageMod = require("../../../electron/providers/usage.cjs");
const errors = require("../../../electron/providers/errors.cjs");
const catalog = require("../../../electron/providers/catalog.cjs");
const registryMod = require("../../../electron/providers/registry.cjs");
const modelsMod = require("../../../electron/providers/models.cjs");
const remote = require("../../../electron/providers/remoteCatalog.cjs");
const discovery = require("../../../electron/providers/discovery.cjs");
const autoPin = require("../../../electron/providers/autoPin.cjs");
const ADAPTERS: Record<string, any> = {
  openai: require("../../../electron/providers/adapters/openai.cjs"),
  anthropic: require("../../../electron/providers/adapters/anthropic.cjs"),
  gemini: require("../../../electron/providers/adapters/gemini.cjs"),
  ollama: require("../../../electron/providers/adapters/ollama.cjs"),
};

/** JSON round trip: drops undefined fields and turns undefined into null, as the fixture files do. */
function plain(value: unknown): any {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

/** The connection the adapters get, built from the catalog entry the case names. */
function conn(input: any) {
  const entry = input.provider ? (catalog.find(input.provider) ?? undefined) : undefined;
  return {
    baseUrl: input.baseUrl ?? entry?.baseUrl ?? "",
    apiKey: input.apiKey ?? "",
    headers: input.headers ?? {},
    entry,
    instance: { id: input.instanceId ?? input.provider },
  };
}

/** Records the stream the way the neutral event list reads it: one event per text, reasoning, call, state, finish or error. */
function recorder(out: any[]) {
  return {
    delta({ content, reasoning, toolCalls }: any = {}) {
      if (content) out.push({ type: "text_delta", text: content });
      if (reasoning) out.push({ type: "reasoning_delta", text: reasoning });
      for (const call of toolCalls || []) {
        out.push({
          type: "tool_call_delta",
          index: call.index,
          ...(call.id ? { id: call.id } : {}),
          ...(call.function?.name ? { name: call.function.name } : {}),
          arguments: call.function?.arguments ?? "",
        });
      }
    },
    finish(reason: string, usage: any = {}) {
      out.push({ type: "finish", reason: reason || "stop", usage: { prompt_tokens: usage.promptTokens ?? 0, output_tokens: usage.outputTokens ?? 0 } });
    },
    providerState(state: any) {
      out.push({ type: "provider_state", state });
    },
    malformed() {},
    retry() {},
    error(failure: any) {
      out.push({ type: "error", error: failure ?? { kind: "provider-unknown-error" } });
    },
  };
}

/** Chunks are strings, or byte arrays when a case splits a UTF-8 character. */
function chunkBytes(chunks: (string | number[])[]): Uint8Array[] {
  const encoder = new TextEncoder();
  return chunks.map((chunk) => (typeof chunk === "string" ? encoder.encode(chunk) : Uint8Array.from(chunk)));
}

async function streamOf(input: any) {
  const mod = ADAPTERS[input.protocol];
  const pieces = chunkBytes(input.chunks);
  const upstream = new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(piece);
      controller.close();
    },
  });
  const out: any[] = [];
  const instanceId = input.instanceId === undefined ? input.protocol : input.instanceId;
  try {
    await mod.translateStream(upstream, recorder(out), { instanceId });
  } catch (error: any) {
    out.push({ type: "error", error: failureOf(error) });
  }
  return out;
}

/** The failure the renderer sees for what an adapter throws. A hosted tool names itself, as the gateway's
 * hostedToolFailure does; the adapters throw it bare. */
function failureOf(error: any) {
  if (error instanceof ADAPTERS.openai.HostedToolError) {
    return { kind: "provider-unknown-error", status: 0, message: `The provider called its own tool (${error.message}), which Draggy never offers.`, providerMessage: "" };
  }
  return error?.failure ?? { kind: "provider-unknown-error" };
}

async function answerOf(input: any) {
  const mod = ADAPTERS[input.protocol];
  const instanceId = input.instanceId === undefined ? input.protocol : input.instanceId;
  try {
    const a = mod.translateJson(input.body, { instanceId });
    return {
      completion: {
        content: a.content,
        reasoning: a.reasoning,
        tool_calls: a.toolCalls.map((call: any) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })),
        finish: a.finish,
        usage: { prompt_tokens: a.usage.promptTokens, output_tokens: a.usage.outputTokens },
        provider_state: a.providerState,
      },
    };
  } catch (error: any) {
    return { error: failureOf(error) };
  }
}

/** A fake of the network: routes by URL, and a route can answer by the request's model name. */
function fakeFetch(routes: Record<string, any>) {
  return async (url: string, init: any = {}) => {
    const route = routes[url];
    if (!route) throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
    let answer = route;
    if (route.byModel) {
      const model = JSON.parse(init.body).model;
      answer = route.byModel[model] ?? { status: 404, body: {} };
    }
    const status = answer.status ?? 200;
    return new Response(JSON.stringify(answer.body ?? {}), { status, headers: { "Content-Type": "application/json" } });
  };
}

async function modelsListOf(input: any) {
  const kv = new Map<string, string>();
  const vault = new Map<string, any>();
  const keystore = true;
  const storage = { getValue: (key: string) => kv.get(key) ?? null, setValue: (key: string, value: string) => kv.set(key, String(value)) };
  const secrets = {
    available: () => keystore,
    get: (owner: string) => vault.get(owner) ?? {},
    set: (owner: string, values: any) => {
      if (!keystore) return false;
      if (Object.keys(values).length) vault.set(owner, values);
      else vault.delete(owner);
      return true;
    },
    remove: (owner: string) => vault.delete(owner),
  };
  const registry = registryMod.createRegistry({ storage, secrets });
  const id = registry.add({ type: input.type, baseUrl: input.baseUrl, headers: input.headers }).id;
  if (input.setKey !== undefined) registry.setKey(id, input.setKey);
  if (input.update) registry.update(id, input.update);
  const accounts: Record<string, any> = {};
  for (const [protocol, spec] of Object.entries<any>(input.accounts ?? {})) {
    accounts[protocol] = {
      models: async () => {
        if (spec.error) throw new Error(spec.error);
        return spec.models;
      },
    };
  }
  const models = modelsMod.createModels({ registry, accounts, fetchImpl: fakeFetch(input.routes ?? {}), now: () => input.now ?? 0 });
  try {
    return { listed: plain(await models.list(id)) };
  } catch (error: any) {
    return { error: error.failure ? { failure: plain(error.failure) } : { message: error.message } };
  }
}

async function registryOpsOf(input: any) {
  const kv = new Map<string, string>();
  if (input.store?.providers !== undefined) {
    kv.set("providers", typeof input.store.providers === "string" ? input.store.providers : JSON.stringify(input.store.providers));
  }
  const vault = new Map<string, any>();
  let keystore = input.keystore ?? true;
  const storage = { getValue: (key: string) => kv.get(key) ?? null, setValue: (key: string, value: string) => kv.set(key, String(value)) };
  const secrets = {
    available: () => keystore,
    get: (owner: string) => vault.get(owner) ?? {},
    set: (owner: string, values: any) => {
      if (!keystore) return false;
      if (Object.keys(values).length) vault.set(owner, values);
      else vault.delete(owner);
      return true;
    },
    remove: (owner: string) => vault.delete(owner),
  };
  const registry = registryMod.createRegistry({ storage, secrets });
  const results: any[] = [];
  for (const op of input.ops) {
    try {
      let value: any;
      switch (op.op) {
        case "add": value = registry.add(op.args); break;
        case "update": value = registry.update(op.id, op.patch); break;
        case "setKey": value = registry.setKey(op.id, op.key); break;
        case "remove": value = registry.remove(op.id); break;
        case "list": value = registry.list(); break;
        case "get": value = registry.get(op.id); break;
        case "connectionFor": {
          const c = registry.connectionFor(op.id);
          value = c && { instance: c.instance, baseUrl: c.baseUrl, apiKey: c.apiKey, headers: c.headers, entryId: c.entry?.id ?? null };
          break;
        }
        case "enabledBaseUrls": value = registry.enabledBaseUrls(); break;
        case "keystore": keystore = op.available; value = null; break;
        case "vaultSize": value = vault.size; break;
        default: throw new Error(`unknown op ${op.op}`);
      }
      results.push({ value: plain(value) });
    } catch (error: any) {
      results.push({ error: error.message });
    }
  }
  return {
    results,
    providers: JSON.parse(kv.get("providers") ?? "null"),
    vault: Object.fromEntries([...vault].map(([owner, values]) => [owner, values.apiKey ?? null])),
  };
}

function sseOps(input: any) {
  let clock = 1000;
  const frames: any[] = [];
  const decoder = new TextDecoder();
  const controller = {
    enqueue(bytes: Uint8Array) {
      const text = decoder.decode(bytes);
      const payload = text.replace(/^data: /, "").replace(/\n\n$/, "");
      frames.push(payload === "[DONE]" ? payload : JSON.parse(payload));
    },
    close() {
      frames.push({ closed: true });
    },
  };
  const sse: any = sseMod.createSse(controller, { now: () => (clock += 100) });
  for (const op of input.ops) {
    switch (op.op) {
      case "delta": sse.delta({ content: op.content, reasoning: op.reasoning, toolCalls: op.toolCalls }); break;
      case "finish": sse.finish(op.reason, op.usage); break;
      case "retry": sse.retry(op.attempt, op.of, op.retryAfterMs); break;
      case "providerState": sse.providerState(op.state); break;
      case "error": sse.error(op.error); break;
      case "malformed": sse.malformed(); break;
      case "done": sse.done(); break;
      case "stop": sse.stop(op.how); break;
      default: throw new Error(`unknown op ${op.op}`);
    }
  }
  return frames;
}

/** Runs one case of the named fixture file and returns what the reference produced, JSON-normalised. */
export async function run(area: string, input: any): Promise<any> {
  switch (area) {
    case "sse": {
      if (input.op === "completion") return plain(sseMod.completion(input.args));
      return plain(sseOps(input));
    }
    case "errors": {
      switch (input.op) {
        case "response": return plain(errors.fromResponse(input.status, input.body ?? "", input.headers ?? {}));
        case "network": return plain(errors.fromNetwork({ message: input.message, code: input.code, cause: input.cause ?? undefined }));
        case "retryable": return errors.isRetryable(input.failure);
        case "retry_after": {
          vi.useFakeTimers();
          vi.setSystemTime(input.now);
          try {
            return plain(errors.retryAfterSeconds(input.value));
          } finally {
            vi.useRealTimers();
          }
        }
        default: throw new Error(`unknown op ${input.op}`);
      }
    }
    case "catalog": {
      switch (input.op) {
        case "entry": return plain(catalog.bundledCatalog().find((entry: any) => entry.id === input.id) ?? null);
        case "capabilities": return plain(catalog.capabilitiesFor(catalog.find(input.provider) ?? null, input.model));
        case "problem": return catalog.problemWith(input.entry) ?? null;
        default: throw new Error(`unknown op ${input.op}`);
      }
    }
    case "requests": {
      const mod = ADAPTERS[input.protocol];
      const request = input.op === "show_request"
        ? mod.showRequest(conn(input), input.model)
        : input.op === "models_request"
          ? mod.modelsRequest(conn(input))
          : mod.buildRequest(input.body, conn(input), input.modelId);
      return plain({
        url: request.url,
        method: request.init.method,
        headers: request.init.headers,
        body: request.init.body === undefined ? undefined : JSON.parse(request.init.body),
      });
    }
    case "streams": return streamOf(input);
    case "answers": return answerOf(input);
    case "listings": {
      switch (input.op) {
        case "parse_models": return plain(ADAPTERS[input.protocol].parseModels(input.json));
        case "parse_show": return plain(ADAPTERS.ollama.parseShow(input.json));
        case "sanitize": return plain(ADAPTERS.gemini.sanitizeSchema(input.schema));
        case "thinking_style": return ADAPTERS.anthropic.thinkingStyle(input.model);
        default: throw new Error(`unknown op ${input.op}`);
      }
    }
    case "models": return modelsListOf(input);
    case "registry": return registryOpsOf(input);
    case "autopin": {
      const plan = autoPin.planPins({ entry: { noisePatterns: input.noisePatterns }, listed: input.listed, pinned: input.pinned, seen: input.seen ?? undefined });
      return plain({ seenModels: plan.seenModels, pinnedModels: plan.pinnedModels, added: plan.added });
    }
    case "remote": {
      if (input.op === "merge") {
        const inUse: string[] = input.inUse ?? [];
        try {
          const merged = remote.merge(input.file, { inUse: new Set(inUse), previous: input.previous ?? null });
          const fileIds = new Set((input.file.providers || []).map((p: any) => p.id));
          const inUseIds = new Set(inUse);
          return plain({
            ids: merged.map((entry: any) => entry.id),
            entries: merged.filter((entry: any) => entry.remote || fileIds.has(entry.id) || inUseIds.has(entry.id)),
          });
        } catch (error: any) {
          return { error: error.message };
        }
      }
      if (input.op === "verify") {
        return remote.verified(input.body, input.signature, input.publicKey === "builtin" ? remote.PUBLIC_KEY : input.publicKey);
      }
      throw new Error(`unknown op ${input.op}`);
    }
    case "discovery": {
      const probes: Record<string, number> = {};
      const fetchImpl = async (url: string) => {
        const { port, pathname } = new URL(url);
        probes[port] = (probes[port] ?? 0) + 1;
        const server = (input.servers ?? {})[port];
        if (!server) throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
        const body = server[pathname];
        if (body === undefined) return new Response("not found", { status: 404 });
        return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
      };
      const found = discovery.createDiscovery({
        excludedPorts: () => input.excludedPorts ?? [],
        isDev: () => input.isDev ?? false,
        fetchImpl,
      });
      const scanned = await found.scan();
      const ports = found.ports();
      return plain({ ports, found: scanned, probes: Object.fromEntries(Object.entries(probes).sort()) });
    }
    case "usage": {
      const { payload } = input;
      switch (input.vendor) {
        case "anthropic": return plain(usageMod.fromAnthropic(payload));
        case "openai": return plain(usageMod.fromOpenAI(payload));
        case "gemini": return plain(usageMod.fromGemini(payload));
        case "codex": return plain(usageMod.fromCodex(payload));
        case "totals": return plain(usageMod.fromTotals(payload.prompt, payload.output));
        default: throw new Error(`unknown vendor ${input.vendor}`);
      }
    }
    default: throw new Error(`unknown fixture area ${area}`);
  }
}

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../shared/fixtures/providers");

/** Numbers compare as they are. An `arguments` string is compared as the JSON it holds, since key order is not meaningful. */
function canon(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => canon(item));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      out[key] = key === "arguments" && typeof item === "string" ? parsedOrText(item) : canon(item);
    }
    return out;
  }
  return value;
}

function parsedOrText(text: string): unknown {
  try {
    return canon(JSON.parse(text));
  } catch {
    return text;
  }
}

import { windowsCases } from "./windowsScope";

describe("providers fixtures", () => {
  // The CLI-runtime and gateway files run in providersCli.test.ts, which dispatches on each case's driver.
  for (const name of fs.readdirSync(FIXTURE_DIR).filter((file) => file.endsWith(".json") && !/^providers-(cli|gateway)-/.test(file)).sort()) {
    const area = path.basename(name, ".json");
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as { cases: { name: string; input: any; expected: unknown }[] };
    describe(area, () => {
      for (const testCase of windowsCases(name, fixture.cases)) {
        // The shared fixture still names the Gemini CLI route the Rust port carries; Windows signs in through agy.
        const expected = area === "catalog" && testCase.name === "entry google" ? { ...(testCase.expected as object), name: "Google (Antigravity)", protocol: "agy", signInHosts: [] } : testCase.expected;
        it(testCase.name, async () => {
          expect(canon(await run(area, testCase.input))).toEqual(canon(expected));
        });
      }
    });
  }
});
