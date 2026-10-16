const crypto = require("crypto");
const http = require("http");
const { log } = require("./logger.cjs");

/** OAuth 2.1 for remote MCP: discovered metadata, dynamic registration, PKCE on every code, and a
 * loopback redirect open only while signing in. No client secret. */

const CLIENT_NAME = "Draggy";

/** How long the user has to finish signing in before the port is given up. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/** Which server a step talked to, without a path or query that might carry a code. */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid url";
  }
}

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A verifier and its challenge. The verifier never leaves this machine. */
function pkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash("sha256").update(verifier).digest(),
  );

  return { verifier, challenge };
}

async function readJson(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      log.debug("mcp.oauth", "metadata not served", { host: hostOf(url), status: response.status });
      return null;
    }
    return await response.json();
  } catch (error) {
    log.swallow("mcp.oauth", error, "a server without metadata falls back to conventional endpoints");
    return null;
  }
}

/** Where to authorise and exchange the code. Asks the server first, then its origin's well-known
 * path, then the conventional endpoints. */
async function discover(serverUrl, fetchImpl = fetch) {
  const origin = new URL(serverUrl).origin;

  const resource = await readJson(
    fetchImpl,
    `${origin}/.well-known/oauth-protected-resource`,
  );

  const issuer =
    (Array.isArray(resource?.authorization_servers) &&
      resource.authorization_servers[0]) ||
    origin;

  const metadata =
    (await readJson(
      fetchImpl,
      `${issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`,
    )) ||
    (await readJson(
      fetchImpl,
      `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
    ));

  log.info("mcp.oauth", "discovery done", {
    host: hostOf(issuer),
    discovered: Boolean(metadata || resource),
    registration: Boolean(metadata?.registration_endpoint),
  });

  return {
    issuer,
    authorization_endpoint: metadata?.authorization_endpoint || `${issuer}/authorize`,
    token_endpoint: metadata?.token_endpoint || `${issuer}/token`,
    registration_endpoint: metadata?.registration_endpoint || null,
    scopes_supported: metadata?.scopes_supported || resource?.scopes_supported || [],
    /** Whether any of that was actually answered, or all of it assumed. */
    discovered: Boolean(metadata || resource),
  };
}

/** Registers Draggy with the authorisation server, which is how a desktop app gets a client id
 * without the user copying one out of a dashboard. */
async function register(metadata, redirectUri, fetchImpl = fetch) {
  if (!metadata.registration_endpoint) return null;

  try {
    const response = await fetchImpl(metadata.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      log.warn("mcp.oauth", "registration refused", { host: hostOf(metadata.registration_endpoint), status: response.status });
      return null;
    }

    const registered = await response.json();
    log.info("mcp.oauth", "registered", { host: hostOf(metadata.registration_endpoint), hasClientId: Boolean(registered?.client_id) });
    return registered?.client_id ? registered : null;
  } catch (error) {
    log.fail("mcp.oauth", "registration failed", error, { host: hostOf(metadata.registration_endpoint) });
    return null;
  }
}

function authorizeUrl(input) {
  const url = new URL(input.metadata.authorization_endpoint);

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);

  if (input.scope) url.searchParams.set("scope", input.scope);
  // Which server the token is for, so one stolen elsewhere is not usable here.
  if (input.resource) url.searchParams.set("resource", input.resource);

  return url.toString();
}

async function postForm(fetchImpl, endpoint, fields) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(20000),
  });

  const text = await response.text();

  if (!response.ok) {
    // The body may echo a code or token, so only the status and host are logged.
    log.warn("mcp.oauth", "token endpoint refused", { host: hostOf(endpoint), status: response.status, grant: fields.grant_type });
    throw new Error(
      `The sign-in server answered ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  const tokens = JSON.parse(text);
  log.info("mcp.oauth", fields.grant_type === "refresh_token" ? "token refreshed" : "token exchanged", {
    host: hostOf(endpoint),
    refreshToken: Boolean(tokens?.refresh_token),
    expiresIn: Number(tokens?.expires_in) || null,
  });
  return tokens;
}

async function exchange(input, fetchImpl = fetch) {
  return postForm(fetchImpl, input.metadata.token_endpoint, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code_verifier: input.verifier,
    resource: input.resource,
  });
}

async function refresh(input, fetchImpl = fetch) {
  return postForm(fetchImpl, input.metadata.token_endpoint, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    resource: input.resource,
  });
}

/** When a token set stops being usable, with a minute of room to spare. */
function expiryOf(tokens, now = Date.now()) {
  const seconds = Number(tokens?.expires_in);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  return now + seconds * 1000 - 60000;
}

function isExpired(stored, now = Date.now()) {
  return typeof stored?.expiresAt === "number" && stored.expiresAt <= now;
}

/** A loopback port open only while signing in. The landing page says one sentence and never echoes
 * the query string back. */
function listenForCode({ timeoutMs = SIGN_IN_TIMEOUT_MS } = {}) {
  let settle;
  let fail;

  const waitForCode = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const server = http.createServer((request, response) => {
    const asked = new URL(request.url, "http://127.0.0.1");

    const code = asked.searchParams.get("code");
    const state = asked.searchParams.get("state");
    const error = asked.searchParams.get("error");

    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(
      code
        ? "Signed in. You can close this tab and go back to Draggy."
        : "Draggy did not receive a sign-in code. You can close this tab.",
    );

    if (code) {
      log.info("mcp.oauth", "redirect received", { hasState: Boolean(state) });
      settle({ code, state });
    } else {
      log.warn("mcp.oauth", "redirect without code", { error: error ? String(error).slice(0, 40) : null });
      fail(new Error(error ? `Sign-in failed: ${error}` : "Sign-in was refused."));
    }
  });

  const timer = setTimeout(() => {
    log.warn("mcp.oauth", "sign-in timed out", { timeoutMs });
    fail(new Error("Sign-in was not finished in time."));
  }, timeoutMs);

  const ready = new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      log.debug("mcp.oauth", "listening for redirect", { port: server.address().port });
      resolve(`http://127.0.0.1:${server.address().port}/callback`);
    });
  });

  const close = () => {
    clearTimeout(timer);
    server.close();
  };

  waitForCode.then(close, close);

  return { ready, waitForCode, close };
}

module.exports = {
  CLIENT_NAME,
  authorizeUrl,
  discover,
  exchange,
  expiryOf,
  isExpired,
  listenForCode,
  pkce,
  refresh,
  register,
};
