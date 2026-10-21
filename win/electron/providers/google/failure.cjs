/** Names a Google account failure by kind from the status, reason and message Google gave, and logs
 * those three. Tokens and prompt text never reach it: only the error object Google answered with. */
const { log } = require("../../logger.cjs");

const MAX_MESSAGE = 300;
// Google's wording when the Gemini CLI route was closed for personal plans (2026-06-18).
const RETIRED = /no longer (supported|available|served)|stop(ped)? serving|has been (retired|discontinued)|migrate to antigravity/i;

/** Pulls `{ status, reason, message }` out of a JSON error body, or out of text that holds one. */
function parseGoogleError(text) {
  const source = typeof text === "string" ? text : JSON.stringify(text ?? "");
  const start = source.indexOf("{");
  let error = null;
  if (start >= 0) {
    try {
      const parsed = JSON.parse(source.slice(start, source.lastIndexOf("}") + 1));
      error = parsed?.error ?? parsed;
    } catch (parseError) {
      log.swallow("providers.google", parseError, "the text is not JSON; the plain-text rules below read it instead");
    }
  }
  const detail = Array.isArray(error?.details) ? error.details.find((d) => d?.reason) : null;
  const code = Number(error?.code);
  const fromText = /\b(40[0-9]|429|50[0-9])\b/.exec(source);
  return {
    status: Number.isInteger(code) && code > 0 ? code : fromText ? Number(fromText[1]) : 0,
    reason: String(detail?.reason || error?.status || "").slice(0, 64),
    message: String(error?.message || (error ? "" : source)).replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE),
  };
}

function failure(kind, status, message, extra = {}) {
  return { kind, status, message, providerMessage: message, ...extra };
}

/** The failure for one Google answer. A 403 or the retirement wording is its own kind, since it is an account matter. */
function googleFailure(input) {
  const parsed = parseGoogleError(input);
  const { status, reason, message } = parsed;
  const text = `${reason} ${message}`;
  log.warn("providers.google", "google request failed", { status, reason, detail: message });
  const shown = message || reason || `HTTP ${status}`;
  if (status === 403 || /PERMISSION_DENIED/i.test(reason) || RETIRED.test(text)) return failure("account-access-denied", status || 403, shown);
  if (status === 401 || /UNAUTHENTICATED|sign ?in|log ?in|credential/i.test(text)) return failure("account-signed-out", status, shown);
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|usage limit|limit reached/i.test(text)) return failure("account-limit-reached", status, shown);
  if (status === 503 || /overloaded|UNAVAILABLE/i.test(text)) return failure("provider-rate-limited", status, shown);
  return failure("provider-unknown-error", status, shown);
}

module.exports = { parseGoogleError, googleFailure };
