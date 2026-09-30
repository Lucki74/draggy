/** Names a provider's failure by kind, so the renderer can explain it in the reader's language and
 * link its article. The provider's own words travel with it, for whatever the kinds do not cover. */

const MAX_MESSAGE = 500;

function messageOf(body) {
  if (!body) return "";
  if (typeof body === "string") {
    try {
      return messageOf(JSON.parse(body));
    } catch {
      return body.slice(0, MAX_MESSAGE);
    }
  }
  const error = body.error ?? body;
  if (typeof error === "string") return error.slice(0, MAX_MESSAGE);
  return String(error.message || error.msg || error.detail || JSON.stringify(error)).slice(0, MAX_MESSAGE);
}

function codeOf(body) {
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    const error = parsed?.error ?? parsed;
    return String(error?.code || error?.type || error?.status || "");
  } catch {
    return "";
  }
}

/** Seconds from a Retry-After header, whichever of its two forms it takes. */
function retryAfterSeconds(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.round((at - Date.now()) / 1000));
}

function classify(status, text) {
  const t = text.toLowerCase();
  if (/insufficient_quota|credit|billing|balance|payment|quota exceeded|exceeded your current quota/.test(t) || status === 402) return "provider-no-credit";
  if (/country|region|territor|location is not supported|unsupported_country/.test(t)) return "provider-region-unavailable";
  if (/context.?length|context window|maximum context|too many tokens|prompt is too long|reduce the length/.test(t)) return "provider-context-too-long";
  if (/content.?filter|content policy|safety|flagged|moderation/.test(t)) return "provider-refused";
  if (status === 401 || status === 403 || /invalid.?api.?key|incorrect api key|unauthorized|authentication/.test(t)) return "provider-invalid-key";
  if (status === 404 || /model\b.{0,80}\bnot.?found|does not exist|no such model|unknown model/.test(t)) return "provider-model-not-found";
  if (status === 429 || /rate.?limit/.test(t)) return "provider-rate-limited";
  return "provider-unknown-error";
}

/** A failed HTTP answer, as `{ kind, status, message, retryAfter?, providerMessage }`. */
function fromResponse(status, body, headers = {}) {
  const providerMessage = messageOf(body);
  const kind = classify(status, `${codeOf(body)} ${providerMessage}`);
  const failure = { kind, status, message: providerMessage || `HTTP ${status}`, providerMessage };
  const retryAfter = retryAfterSeconds(typeof headers.get === "function" ? headers.get("retry-after") : headers["retry-after"]);
  if (retryAfter !== undefined) failure.retryAfter = retryAfter;
  return failure;
}

/** A request that never got an answer: refused, unreachable, or cut off. */
function fromNetwork(error) {
  const providerMessage = String(error?.cause?.message || error?.message || "network error").slice(0, MAX_MESSAGE);
  return { kind: "provider-unreachable", status: 0, message: providerMessage, providerMessage };
}

/** Worth trying again: overloaded or rate limited, but never an exhausted quota, which will not recover. */
function isRetryable(failure) {
  if (failure.kind === "provider-no-credit") return false;
  return failure.status === 429 || failure.status === 529 || (failure.status >= 500 && failure.status < 600);
}

module.exports = { fromResponse, fromNetwork, isRetryable, retryAfterSeconds };
