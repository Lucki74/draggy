/** What a settings save changed, for one log line. Harmless keys carry old and new value; every
 * other key (instructions, URLs, anything free text) is named and nothing more. */

const HARMLESS = new Set([
  "theme",
  "fontSize",
  "language",
  "modelName",
  "codeModel",
  "imageModel",
  "embedModel",
  "thinkingMode",
  "codeThinkingMode",
  "slowModelThinking",
  "colibriLossy",
  "webMode",
  "browserActions",
  "codeWebMode",
  "codePermissionMode",
  "voiceEngine",
  "neuralVoice",
  "cloudProvider",
  "voiceRate",
  "voiceSounds",
  "interfaceSounds",
  "searchProvider",
  "libraryEnabled",
  "showMetrics",
  "autoUpdate",
  "compactLimit",
  "fixedContextSize",
]);

function parse(raw) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function scalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value) ? value : "[set]";
}

/** `{ key: { from, to } }` for harmless keys and `{ key: null }` for the rest. Empty when nothing moved. */
function describeChange(before, after) {
  const old = parse(before);
  const next = parse(after);
  const changed = {};

  for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
    if (JSON.stringify(old[key]) === JSON.stringify(next[key])) continue;
    changed[key] = HARMLESS.has(key) ? { from: scalar(old[key] ?? null), to: scalar(next[key] ?? null) } : null;
  }

  return changed;
}

/** A key written outside the settings blob: its name, never its value. */
function describeKeySave(key) {
  return { key: String(key) };
}

module.exports = { HARMLESS, describeChange, describeKeySave };
