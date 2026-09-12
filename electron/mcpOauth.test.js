import crypto from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const oauth = require("./mcpOauth.cjs");

/**
 * Signing in to a remote extension. The parts worth pinning down: the code is
 * bound to this machine by PKCE, the token is asked for the one server it is
 * meant for, and a desktop app never has to hold a client secret.
 */

let server;
let origin;
let routes;
let seen;

beforeEach(async () => {
  seen = [];
  routes = {};

  server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const url = new URL(request.url, origin);
      seen.push({ path: url.pathname, method: request.method, body });

      const route = routes[url.pathname];
      if (!route) {
        response.writeHead(404);
        response.end();
        return;
      }

      route(request, response, body);
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const json = (response, payload) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
};

describe("proof that the code belongs to this machine", () => {
  it("makes a challenge the verifier answers", () => {
    const { verifier, challenge } = oauth.pkce();

    const expected = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(challenge).toBe(expected);
  });

  it("makes a different one every time", () => {
    expect(oauth.pkce().verifier).not.toBe(oauth.pkce().verifier);
  });
});

describe("finding out where to sign in", () => {
  it("asks the server which authorisation server it trusts", async () => {
    routes["/.well-known/oauth-protected-resource"] = (request, response) =>
      json(response, { authorization_servers: [`${origin}/auth`] });

    routes["/auth/.well-known/oauth-authorization-server"] = (request, response) =>
      json(response, {
        authorization_endpoint: `${origin}/auth/authorize`,
        token_endpoint: `${origin}/auth/token`,
        registration_endpoint: `${origin}/auth/register`,
      });

    const metadata = await oauth.discover(`${origin}/mcp`);

    expect(metadata.token_endpoint).toBe(`${origin}/auth/token`);
    expect(metadata.registration_endpoint).toBe(`${origin}/auth/register`);
    expect(metadata.discovered).toBe(true);
  });

  it("falls back to the server's own well-known path", async () => {
    routes["/.well-known/oauth-authorization-server"] = (request, response) =>
      json(response, { token_endpoint: `${origin}/token` });

    const metadata = await oauth.discover(`${origin}/mcp`);

    expect(metadata.token_endpoint).toBe(`${origin}/token`);
  });

  it("reads an OpenID document when that is all there is", async () => {
    routes["/.well-known/openid-configuration"] = (request, response) =>
      json(response, {
        authorization_endpoint: `${origin}/oidc/authorize`,
        token_endpoint: `${origin}/oidc/token`,
      });

    const metadata = await oauth.discover(`${origin}/mcp`);

    expect(metadata.authorization_endpoint).toBe(`${origin}/oidc/authorize`);
  });

  it("guesses the usual endpoints when the server says nothing", async () => {
    const metadata = await oauth.discover(`${origin}/mcp`);

    expect(metadata.authorization_endpoint).toBe(`${origin}/authorize`);
    expect(metadata.discovered).toBe(false);
  });
});

describe("registering on the spot", () => {
  const metadata = () => ({ registration_endpoint: `${origin}/register` });

  it("asks for a client with no secret to keep", async () => {
    routes["/register"] = (request, response) =>
      json(response, { client_id: "client-123" });

    const registered = await oauth.register(
      metadata(),
      "http://127.0.0.1:9/callback",
    );

    expect(registered.client_id).toBe("client-123");

    const asked = JSON.parse(seen[0].body);
    expect(asked.token_endpoint_auth_method).toBe("none");
    expect(asked.redirect_uris).toEqual(["http://127.0.0.1:9/callback"]);
    expect(asked.grant_types).toContain("refresh_token");
  });

  it("says nothing when the server does not offer registration", async () => {
    expect(await oauth.register({}, "http://127.0.0.1:9/callback")).toBeNull();
  });

  it("says nothing when registration is refused", async () => {
    routes["/register"] = (request, response) => {
      response.writeHead(403);
      response.end();
    };

    expect(
      await oauth.register(metadata(), "http://127.0.0.1:9/callback"),
    ).toBeNull();
  });
});

describe("the address the user is sent to", () => {
  it("carries the challenge, the state and the server it is for", () => {
    const url = new URL(
      oauth.authorizeUrl({
        metadata: { authorization_endpoint: "https://auth.example/authorize" },
        clientId: "client-123",
        redirectUri: "http://127.0.0.1:41234/callback",
        challenge: "the-challenge",
        state: "the-state",
        scope: "mcp:read",
        resource: "https://tools.example/mcp",
      }),
    );

    expect(url.searchParams.get("code_challenge")).toBe("the-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("resource")).toBe("https://tools.example/mcp");
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});

describe("swapping the code for a token", () => {
  beforeEach(() => {
    routes["/token"] = (request, response) =>
      json(response, {
        access_token: "token-abc",
        refresh_token: "refresh-abc",
        expires_in: 3600,
      });
  });

  const metadata = () => ({ token_endpoint: `${origin}/token` });

  it("sends the verifier, not the challenge", async () => {
    const tokens = await oauth.exchange({
      metadata: metadata(),
      clientId: "client-123",
      code: "the-code",
      verifier: "the-verifier",
      redirectUri: "http://127.0.0.1:9/callback",
      resource: `${origin}/mcp`,
    });

    expect(tokens.access_token).toBe("token-abc");

    const sent = new URLSearchParams(seen[0].body);
    expect(sent.get("code_verifier")).toBe("the-verifier");
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("resource")).toBe(`${origin}/mcp`);
  });

  it("refreshes with the refresh token", async () => {
    await oauth.refresh({
      metadata: metadata(),
      clientId: "client-123",
      refreshToken: "refresh-abc",
    });

    const sent = new URLSearchParams(seen[0].body);
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("refresh_token")).toBe("refresh-abc");
  });

  it("reports what a refusal said", async () => {
    routes["/token"] = (request, response) => {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end('{"error":"invalid_grant"}');
    };

    await expect(
      oauth.exchange({ metadata: metadata(), clientId: "c", code: "x" }),
    ).rejects.toThrow(/invalid_grant/);
  });
});

describe("knowing when a token has gone stale", () => {
  it("expires a little early, so a call is not made with a dead token", () => {
    const at = oauth.expiryOf({ expires_in: 3600 }, 1_000_000);

    expect(at).toBe(1_000_000 + 3600 * 1000 - 60000);
  });

  it("treats a token with no lifetime as one that does not expire", () => {
    expect(oauth.expiryOf({})).toBeNull();
    expect(oauth.isExpired({ expiresAt: null })).toBe(false);
  });

  it("knows a stale one when it sees it", () => {
    expect(oauth.isExpired({ expiresAt: 500 }, 1000)).toBe(true);
    expect(oauth.isExpired({ expiresAt: 5000 }, 1000)).toBe(false);
  });
});

describe("catching the redirect", () => {
  it("takes the code off the callback and closes the port", async () => {
    const listener = oauth.listenForCode();
    const redirectUri = await listener.ready;

    await fetch(`${redirectUri}?code=the-code&state=the-state`);

    expect(await listener.waitForCode).toEqual({
      code: "the-code",
      state: "the-state",
    });

    // The port is given up as soon as it has what it was waiting for.
    await expect(fetch(redirectUri)).rejects.toThrow();
  });

  it("fails when the user refuses rather than waiting forever", async () => {
    const listener = oauth.listenForCode();
    const redirectUri = await listener.ready;

    await fetch(`${redirectUri}?error=access_denied`);

    await expect(listener.waitForCode).rejects.toThrow(/access_denied/);
  });

  it("gives up after its own deadline", async () => {
    const listener = oauth.listenForCode({ timeoutMs: 20 });
    await listener.ready;

    await expect(listener.waitForCode).rejects.toThrow(/in time/);
  });
});
