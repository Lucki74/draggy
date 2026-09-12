/**
 * Talking to an MCP server that is not a program on this machine but a URL.
 * The transport is Streamable HTTP: one POST per JSON-RPC message, with the
 * answer arriving either as JSON or as a short server-sent event stream.
 *
 * This is the one part of Draggy that leaves the machine on purpose, so it is
 * never started on its own: a remote server runs only when the user turns it
 * on, and the interface says where it goes.
 */

const PROTOCOL_VERSION = "2025-06-18";

/** How long any single request may take before it is given up on. */
const DEFAULT_TIMEOUT_MS = 60000;

function isEventStream(response) {
  return (response.headers.get("content-type") || "").includes("text/event-stream");
}

/**
 * Pulls JSON-RPC messages out of an event stream. A server may send progress
 * notifications before the answer, so everything is read and the message with
 * the matching id is the one that counts.
 */
async function readEventStream(response) {
  const messages = [];
  const reader = response.body?.getReader();
  if (!reader) return messages;

  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";

    for (const event of events) {
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;

        try {
          messages.push(JSON.parse(line.slice(5).trim()));
        } catch {
          // A keep-alive or a comment line. Not every frame is a message.
        }
      }
    }
  }

  return messages;
}

/**
 * @param options.url        where the server answers
 * @param options.fetchImpl  injected for the tests
 * @param options.getToken   the bearer token, when the server wants one
 * @param options.onUnauthorized  called once on a 401, to refresh and retry
 */
function createHttpTransport(options) {
  const {
    url,
    fetchImpl = fetch,
    getToken = () => null,
    onUnauthorized = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  let sessionId = null;
  let nextId = 1;

  async function post(body, { retrying = false } = {}) {
    const token = await getToken();

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
    };

    if (token) headers.Authorization = `Bearer ${token}`;
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;

    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    // The token expired. One refresh, one retry, and then it is an error like
    // any other rather than a loop.
    if (response.status === 401 && !retrying && onUnauthorized) {
      const refreshed = await onUnauthorized();
      if (refreshed) return post(body, { retrying: true });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `The server answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}.`,
      );
    }

    const session = response.headers.get("mcp-session-id");
    if (session) sessionId = session;

    if (response.status === 202) return null;

    if (isEventStream(response)) {
      const messages = await readEventStream(response);
      return messages.find((message) => message.id === body.id) ?? null;
    }

    const text = await response.text();
    if (!text.trim()) return null;

    return JSON.parse(text);
  }

  return {
    get sessionId() {
      return sessionId;
    },

    async send(method, params) {
      const id = nextId++;
      const answer = await post({ jsonrpc: "2.0", id, method, params });

      if (!answer) {
        throw new Error(`The server gave no answer to ${method}.`);
      }

      if (answer.error) {
        throw new Error(answer.error.message || "The server reported an error.");
      }

      return answer.result;
    },

    async notify(method, params) {
      await post({ jsonrpc: "2.0", method, params });
    },

    async close() {
      if (!sessionId) return;

      // Politeness, and it frees the session on the other side. A server that
      // does not support it says so with a 405, which is not a problem.
      try {
        await fetchImpl(url, {
          method: "DELETE",
          headers: {
            "Mcp-Session-Id": sessionId,
            "MCP-Protocol-Version": PROTOCOL_VERSION,
          },
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Nothing to do about a goodbye that did not arrive.
      }

      sessionId = null;
    },
  };
}

module.exports = { PROTOCOL_VERSION, createHttpTransport, readEventStream };
