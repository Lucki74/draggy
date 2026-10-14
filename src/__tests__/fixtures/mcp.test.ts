// Golden fixtures for the MCP catalogue, registry parsing, OAuth helpers and the streamable HTTP transport. Each case drives the
// Electron/CJS reference with fakes for the network and the random bytes, and checks what it returns. core/crates/mcp/tests/fixtures.rs
// runs the same inputs against the Rust port, so both must agree. The registry's cache and the sign-in redirect listener are not
// fixtures: they are stateful or need a socket, so core/crates/mcp/tests covers them with fakes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../shared/fixtures/mcp");

// RUNNERS START
type Case = { name: string; input: unknown; expected: unknown };
type Input = Record<string, unknown>;
type Reply = { status?: number; headers?: Record<string, string>; body?: unknown; fail?: string };
type Op = { op: "send" | "notify" | "close"; method?: string; params?: unknown };

const catalogue = require("../../../electron/mcpCatalogue.cjs") as {
  listCatalogue: () => unknown;
  findEntry: (id: string) => unknown;
  searchCatalogue: (term: unknown) => { id: string }[];
  missingRequirements: (entry: unknown, config: unknown) => unknown;
  commandFor: (entry: unknown, config: unknown) => unknown;
  isSecretField: (id: string, field: string) => boolean;
  docsUrl: (entry: unknown) => unknown;
};
const registry = require("../../../electron/mcpRegistry.cjs") as {
  parseServers: (payload: unknown) => unknown;
  toEntry: (server: unknown) => unknown;
  idFor: (name: unknown) => string;
};
const oauth = require("../../../electron/mcpOauth.cjs") as {
  pkce: () => { verifier: string; challenge: string };
  authorizeUrl: (input: unknown) => string;
  discover: (server: string, fetchImpl: (url: string) => Promise<Response>) => Promise<unknown>;
  register: (metadata: unknown, redirectUri: string, fetchImpl: (url: string, init: RequestInit) => Promise<Response>) => Promise<unknown>;
  exchange: (input: unknown, fetchImpl: (url: string, init: RequestInit) => Promise<Response>) => Promise<unknown>;
  refresh: (input: unknown, fetchImpl: (url: string, init: RequestInit) => Promise<Response>) => Promise<unknown>;
  expiryOf: (tokens: unknown, now: number) => number | null;
  isExpired: (stored: unknown, now: number) => boolean;
};
const http = require("../../../electron/mcpHttp.cjs") as {
  readEventStream: (response: Response) => Promise<unknown[]>;
  createHttpTransport: (options: Record<string, unknown>) => {
    send: (method: string, params?: unknown) => Promise<unknown>;
    notify: (method: string, params?: unknown) => Promise<void>;
    close: () => Promise<void>;
    readonly sessionId: string | null;
  };
};

const MCP_URL = "https://tools.example/mcp";
const encoder = new TextEncoder();

/** A message the caller can compare: a thrown error is reported by its text, a SyntaxError as the Rust port words it. */
function messageOf(error: unknown): string {
  if (error instanceof SyntaxError) return "invalid json";
  return error instanceof Error ? error.message : String(error);
}

/** Wraps a runner so that a throw becomes {error}, the same shape the Rust runner reports. */
function guarded(run: (input: Input) => unknown) {
  return async (input: Input) => {
    try {
      return await run(input);
    } catch (error) {
      return { error: messageOf(error) };
    }
  };
}

/** The fixture's null means absent: a field the reference never sees. */
const orUndefined = (value: unknown) => (value === null || value === undefined ? undefined : value);

/** An entry given by id is looked up; an entry given as an object is used as it is. */
const resolveEntry = (entry: unknown) => (typeof entry === "string" ? catalogue.findEntry(entry) : (entry ?? null));

function bodyText(body: unknown): string {
  if (body === undefined || body === null) return "";
  return typeof body === "string" ? body : JSON.stringify(body);
}

/** A scripted reply as a fetch Response. A reply with fail throws, as a refused connection does. */
function replyOf(reply: Reply): Response {
  if (reply.fail) throw new Error(reply.fail);
  return new Response(bodyText(reply.body), { status: reply.status ?? 200, headers: reply.headers ?? {} });
}

function formFields(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(init.body)));
}

const RUNNERS: Record<string, (input: Input) => Promise<unknown>> = {
  "catalogue-list.json": guarded(() => catalogue.listCatalogue()),
  "catalogue-find.json": guarded((input) => catalogue.findEntry(String(input.id))),
  "catalogue-search.json": guarded((input) => catalogue.searchCatalogue(input.term).map((entry) => entry.id)),
  "catalogue-missing.json": guarded((input) =>
    catalogue.missingRequirements(resolveEntry(input.entry), input.config ?? {}),
  ),
  "catalogue-command.json": guarded((input) => catalogue.commandFor(resolveEntry(input.entry), input.config ?? {})),
  "catalogue-secret.json": guarded((input) => catalogue.isSecretField(String(input.id), String(input.field))),
  "catalogue-docs.json": guarded((input) => catalogue.docsUrl(resolveEntry(input.entry))),

  "registry-parse.json": guarded((input) => registry.parseServers(input.payload)),
  "registry-entry.json": guarded((input) => registry.toEntry(input.server)),
  "registry-id.json": guarded((input) => registry.idFor(input.name)),

  "oauth-pkce.json": guarded((input) => {
    const spy = vi.spyOn(crypto, "randomBytes").mockReturnValueOnce(Buffer.from(String(input.randomBytes), "hex") as never);
    try {
      return oauth.pkce();
    } finally {
      spy.mockRestore();
    }
  }),
  "oauth-url.json": guarded((input) =>
    oauth.authorizeUrl({
      metadata: { authorization_endpoint: input.endpoint },
      clientId: orUndefined(input.clientId),
      redirectUri: orUndefined(input.redirectUri),
      challenge: orUndefined(input.challenge),
      state: orUndefined(input.state),
      scope: orUndefined(input.scope),
      resource: orUndefined(input.resource),
    }),
  ),
  "oauth-expiry.json": guarded((input) => oauth.expiryOf(input.tokens, input.now as number)),
  "oauth-stale.json": guarded((input) => oauth.isExpired(input.stored, input.now as number)),
  "oauth-token.json": async (input) => {
    let sent: Record<string, string> = {};
    const fetchImpl = async (_url: string, init: RequestInit) => {
      sent = formFields(init);
      return replyOf(input.reply as Reply);
    };
    const metadata = { token_endpoint: input.endpoint };
    try {
      const result =
        input.grant === "refresh_token"
          ? await oauth.refresh(
              {
                metadata,
                clientId: orUndefined(input.clientId),
                clientSecret: orUndefined(input.clientSecret),
                refreshToken: orUndefined(input.refreshToken),
                resource: orUndefined(input.resource),
              },
              fetchImpl,
            )
          : await oauth.exchange(
              {
                metadata,
                clientId: orUndefined(input.clientId),
                clientSecret: orUndefined(input.clientSecret),
                code: orUndefined(input.code),
                redirectUri: orUndefined(input.redirectUri),
                verifier: orUndefined(input.verifier),
                resource: orUndefined(input.resource),
              },
              fetchImpl,
            );
      return { sent, result };
    } catch (error) {
      return { sent, error: messageOf(error) };
    }
  },
  "oauth-register.json": async (input) => {
    let sent: unknown = null;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return replyOf(input.reply as Reply);
    };
    const registered = await oauth.register(
      { registration_endpoint: orUndefined(input.endpoint) },
      String(input.redirectUri),
      fetchImpl,
    );
    return { sent, registered };
  },
  "oauth-discover.json": async (input) => {
    const requests: string[] = [];
    const routes = input.routes as Record<string, Reply>;
    const fetchImpl = async (url: string) => {
      requests.push(url);
      const reply = routes[url];
      return reply ? replyOf(reply) : new Response("", { status: 404 });
    };
    try {
      const metadata = await oauth.discover(String(input.server), fetchImpl);
      return { requests, metadata };
    } catch (error) {
      return { requests, error: messageOf(error) };
    }
  },

  "http-sse.json": guarded(async (input) => {
    const chunks = input.chunks as string[];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return http.readEventStream(new Response(stream));
  }),
  "http-transport.json": async (input) => {
    let token = (input.token ?? null) as string | null;
    const refreshTo = input.refreshTo as string | undefined;
    const requests: unknown[] = [];
    const replies = [...((input.responses ?? []) as Reply[])];
    const fetchImpl = async (url: string, init: RequestInit) => {
      requests.push({
        method: init.method,
        url,
        headers: init.headers ?? null,
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      });
      const reply = replies.shift();
      if (!reply) throw new Error("no scripted reply");
      return replyOf(reply);
    };
    const transport = http.createHttpTransport({
      url: MCP_URL,
      fetchImpl,
      getToken: () => token,
      getHeaders: input.headers ? () => input.headers : undefined,
      onUnauthorized:
        refreshTo === undefined
          ? null
          : async () => {
              token = refreshTo;
              return true;
            },
    });
    const results: unknown[] = [];
    for (const op of (input.ops ?? []) as Op[]) {
      try {
        let value: unknown = null;
        if (op.op === "send") value = await transport.send(String(op.method), op.params);
        else if (op.op === "notify") await transport.notify(String(op.method), op.params);
        else await transport.close();
        results.push({ ok: value ?? null });
      } catch (error) {
        results.push({ error: messageOf(error) });
      }
    }
    return { results, requests, sessionId: transport.sessionId ?? null };
  },
};
// RUNNERS END

describe("mcp fixtures", () => {
  // The session files are replayed by mcp-session.test.ts, which has its own runner.
  for (const file of fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json") && !name.startsWith("mcp-session-")).sort()) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as { cases: Case[] };
    describe(file, () => {
      for (const testCase of fixture.cases) {
        it(testCase.name, async () => {
          const runner = RUNNERS[file];
          if (!runner) throw new Error(`no runner for ${file}`);
          expect(await runner(testCase.input as Input)).toEqual(testCase.expected);
        });
      }
    });
  }
});
