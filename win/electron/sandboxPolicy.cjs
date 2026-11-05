/** What a sandboxed command may see. Mirrors core/crates/tools/src/sandbox.rs; the scrub rules are pinned by
 * shared/fixtures/tools/sandbox-env.json. */

const SECRET_SEGMENTS = new Set(["KEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD", "CREDENTIAL", "CREDENTIALS", "AUTH"]);
const SECRET_PREFIXES = ["AWS_", "AZURE_", "GCP_", "DRAGGY_"];

/** True when the name looks like a key, token or credential: matched per `_` segment, case-insensitively. */
function isSecretName(name) {
  const upper = String(name).toUpperCase();
  if (SECRET_PREFIXES.some((prefix) => upper.startsWith(prefix))) return true;
  return upper.split("_").some((part) => SECRET_SEGMENTS.has(part)) || upper.endsWith("APIKEY");
}

function scrubEnv(env) {
  const out = {};
  for (const [name, value] of Object.entries(env || {})) {
    if (value !== undefined && !isSecretName(name)) out[name] = value;
  }
  return out;
}

module.exports = { isSecretName, scrubEnv };
