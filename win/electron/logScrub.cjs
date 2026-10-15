/** What must never reach a log file, and what an exported bundle must not carry.
 * Pure functions: the logger and the diagnostics bundle both call them. */

const SECRET_PATTERNS = [
  // A header keeps its name so the line still reads; the value goes.
  [/(authorization["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic|Token)\s+)?[^\s"',;]+/gi, "$1[secret:authorization]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [secret:bearer]"],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "[secret:anthropic-key]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[secret:sk-key]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[secret:google-key]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[secret:github-token]"],
  [/\bhf_[A-Za-z0-9]{20,}/g, "[secret:hf-token]"],
  [/\bxox[bp]-[A-Za-z0-9-]{10,}/g, "[secret:slack-token]"],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[secret:jwt]"],
  // OAuth codes, client secrets and presigned-URL signatures travel in the same places as keys.
  [
    /([?&](?:key|token|access_token|refresh_token|id_token|api_key|apikey|code|client_secret|code_verifier|signature|sig|policy|key-pair-id|x-amz-[a-z-]+|x-goog-[a-z-]+|x-xet-cas-uid)=)[^&\s"'#]+/gi,
    "$1[secret:query]",
  ],
];

/** Field names whose value is dropped whatever it looks like. No hash: a hash of a short secret can be guessed. */
const SECRET_KEY_PATTERN =
  /^(?:api[-_]?key|apikey|token|access[-_]?token|refresh[-_]?token|id[-_]?token|secret|client[-_]?secret|password|passwd|authorization|cookie|set-cookie|code[-_]?verifier|credentials?)$/i;

const MIN_KNOWN_SECRET = 6;
const knownSecrets = new Set();

/** The keystore tells the logger every value it holds, so a stored secret is dropped even when
 * it matches no pattern. */
function registerSecret(value) {
  if (typeof value === "string" && value.length >= MIN_KNOWN_SECRET) knownSecrets.add(value);
}

function forgetSecrets() {
  knownSecrets.clear();
}

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(key);
}

function scrubSecrets(text) {
  if (typeof text !== "string" || text.length < 6) return text;
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, replacement);
  }
  for (const secret of knownSecrets) {
    if (out.includes(secret)) out = out.split(secret).join("[secret:stored]");
  }
  return out;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Home directory becomes `~`, the user name `<user>`. Covers the separators and the JSON-escaped
 * backslashes a Windows path takes inside a .jsonl file. */
function scrubPaths(text, { home, user } = {}) {
  if (typeof text !== "string") return text;
  let out = text;
  if (home) {
    const forward = home.replace(/\\/g, "/");
    const variants = new Set([home, forward, home.replace(/\\/g, "\\\\")]);
    for (const variant of variants) {
      out = out.replace(new RegExp(escapeRegExp(variant), "gi"), "~");
    }
  }
  if (user && user.length >= 3) {
    out = out.replace(new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(user)}(?![A-Za-z0-9_])`, "gi"), "<user>");
  }
  return out;
}

module.exports = {
  SECRET_PATTERNS,
  registerSecret,
  forgetSecrets,
  isSecretKey,
  scrubSecrets,
  scrubPaths,
};
