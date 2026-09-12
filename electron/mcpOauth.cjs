const crypto = require("crypto");
const http = require("http");

/**
 * Signing in to a remote MCP server. OAuth 2.1 as the MCP specification asks
 * for it: metadata discovered rather than configured, a client registered on
 * the spot when the server allows it, and PKCE on every authorisation so the
 * code is useless to anything but the request that asked for it.
 *
 * Draggy is a desktop app, so there is no secret worth keeping in the client
 * and no server of ours in the loop: the redirect lands on a port on this
 * machine, open for the seconds it takes and closed again.
 */

const CLIENT_NAME = "Draggy";

/** How long the user has to finish signing in before the port is given up. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

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

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Where to send the user, and where to swap the code for a token. Asked of the
 * server itself first, since the MCP specification has it point at whichever
 * authorisation server it trusts; the well-known path on its own origin is the
 * fallback, and the conventional endpoints are the last resort.
 */
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

/**
 * Registers Draggy with the authorisation server, which is how a desktop app
 * gets a client id without the user copying one out of a dashboard.
 */
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

    if (!response.ok) return null;

    const registered = await response.json();
    return registered?.client_id ? registered : null;
  } catch {
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
    throw new Error(
      `The sign-in server answered ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  return JSON.parse(text);
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

/**
 * A port on this machine, open only while the user is signing in. The page the
 * browser lands on says one sentence and nothing else: whatever the server put
 * in the query string is not put back into the response.
 */
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

    if (code) settle({ code, state });
    else fail(new Error(error ? `Sign-in failed: ${error}` : "Sign-in was refused."));
  });

  const timer = setTimeout(() => {
    fail(new Error("Sign-in was not finished in time."));
  }, timeoutMs);

  const ready = new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}/callback`),
    );
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
