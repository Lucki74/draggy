/** The text rules for background tasks: what the model reads from a task's output, and how a command's
 * final folder and environment are carried to the next one. Pure functions, pinned by
 * shared/fixtures/tools/task-*.json so the Rust port stays identical. */

const MAX_OUTPUT_CHARS = 30_000;
const HEAD_CHARS = 8_000;

// CSI sequences (colors, cursor moves), OSC sequences (titles, hyperlinks), and lone two-byte escapes.
// eslint-disable-next-line no-control-regex -- escape characters are what is removed
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex -- control characters are what is removed
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Output as a person would see it at the end: no color codes, progress bars reduced to their last
 * frame, and runs of identical lines folded into `line (x37)`. */
function cleanOutput(text) {
  const plain = String(text).replace(ANSI, "").replace(/\r\n/g, "\n");
  const lines = plain.split("\n").map((line) => {
    const frames = line.split("\r");
    // A trailing carriage return leaves an empty last frame; the one before it is the line.
    let last = frames.length - 1;
    while (last > 0 && frames[last] === "") last -= 1;
    return frames[last].replace(CONTROL, "");
  });

  const folded = [];
  for (let i = 0; i < lines.length; ) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j += 1;
    const count = j - i;
    folded.push(count > 2 && lines[i].trim() !== "" ? `${lines[i]} (x${count})` : lines.slice(i, j).join("\n"));
    i = j;
  }
  return folded.join("\n");
}

/** The start and the end of a long output, then where the rest lives. */
function clipWithPointer(text, taskId) {
  if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };

  const tail = MAX_OUTPUT_CHARS - HEAD_CHARS;
  const cut = text.length - HEAD_CHARS - tail;
  const body = `${text.slice(0, HEAD_CHARS)}\n\n[... ${cut} characters cut ...]\n\n${text.slice(-tail)}`;
  const footer = taskId ? `\n\nFull log: task ${taskId}, read it with task_output.` : "";
  return { text: body + footer, truncated: true };
}

/** The part of `raw` a reader has not seen. `since` is the character offset it last read to. */
function sliceSince(raw, since) {
  const total = raw.length;
  const from = Number.isFinite(since) ? Math.min(Math.max(Math.floor(since), 0), total) : 0;
  return { text: raw.slice(from), next: total };
}

/** The last `count` lines of a text. */
function tailLines(text, count) {
  const lines = text.split("\n");
  const n = Math.max(1, Math.floor(count));
  return lines.length <= n ? text : lines.slice(-n).join("\n");
}

/** The lines of a text matching a pattern, each with its line number. An invalid pattern is an error. */
function grepLines(text, pattern, limit = 200) {
  let regex;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    return { error: "That pattern is not a valid regular expression." };
  }
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && hits.length < limit; i += 1) {
    if (regex.test(lines[i])) hits.push(`${i + 1}: ${lines[i]}`);
  }
  return { text: hits.join("\n"), matches: hits.length };
}

// Variables the shell itself rewrites on every run; carrying them over would only be noise.
const VOLATILE_ENV = new Set(["_", "PWD", "OLDPWD", "SHLVL", "PS1", "PS2", "PROMPT_COMMAND", "COLUMNS", "LINES", "RANDOM", "SECONDS"]);

/** Shells whose final state can be captured; cmd cannot report its exit code and state together. */
function supportsState(shell) {
  return ["bash", "sh", "zsh", "pwsh", "powershell"].includes(shell);
}

/** Text appended to the model's command so the shell reports where it ended up. The marker is random per
 * run, so output that merely looks like it cannot pass for the report. The command's exit code is kept. */
function stateEpilogue(shell, marker) {
  if (shell === "pwsh" || shell === "powershell") {
    return [
      "",
      "$__dgOk = $?; $__dgRc = $LASTEXITCODE",
      `Write-Output "${marker}:cwd:$((Get-Location).Path)"`,
      `Get-ChildItem Env: | ForEach-Object { Write-Output "${marker}:env:$($_.Name)=$($_.Value)" }`,
      `Write-Output "${marker}:end"`,
      "if ($__dgRc) { exit $__dgRc } elseif (-not $__dgOk) { exit 1 }",
    ].join("\n");
  }
  if (supportsState(shell)) {
    return [
      "",
      "__dg_rc=$?",
      `printf '\\n%s\\n' "${marker}:cwd:$(pwd -W 2>/dev/null || pwd)"`,
      `env | sed "s/^/${marker}:env:/"`,
      `printf '%s\\n' "${marker}:end"`,
      "exit $__dg_rc",
    ].join("\n");
  }
  return null;
}

/** Splits a finished command's output into what the model reads and the state the shell reported.
 * `state` is null when the command never reached the epilogue (it exited early or was killed). */
function parseState(output, marker) {
  const text = String(output);
  const endTag = `${marker}:end`;
  const endAt = text.lastIndexOf(endTag);
  const firstReport = text.indexOf(`${marker}:cwd:`);
  if (endAt === -1 || firstReport === -1 || firstReport > endAt) {
    return { output: text, state: null };
  }

  // The report starts on its own line; a newline the epilogue added before it is not the command's.
  let cut = firstReport;
  if (cut > 0 && text[cut - 1] === "\n") cut -= 1;
  if (cut > 0 && text[cut - 1] === "\r") cut -= 1;
  const before = text.slice(0, cut);
  const report = text.slice(firstReport, endAt).split(/\r?\n/);

  let cwd = null;
  const env = {};
  for (const line of report) {
    if (line.startsWith(`${marker}:cwd:`)) {
      cwd = line.slice(marker.length + 5);
    } else if (line.startsWith(`${marker}:env:`)) {
      const entry = line.slice(marker.length + 5);
      const eq = entry.indexOf("=");
      if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
  }
  return { output: before, state: cwd ? { cwd, env } : null };
}

/** Hides the state report from output that is still arriving in pieces. `push` returns the text that is
 * safe to show; a marker split across two pieces is held back until it can be told from ordinary text. */
function createStateFilter(marker) {
  const tag = `${marker}:cwd:`;
  let held = "";
  let hidden = false;
  return {
    push(chunk) {
      if (hidden) return "";
      held += String(chunk);
      const at = held.indexOf(tag);
      if (at !== -1) {
        hidden = true;
        const shown = held.slice(0, at).replace(/\r?\n$/, "");
        held = "";
        return shown;
      }
      const keep = Math.min(held.length, tag.length - 1);
      const shown = held.slice(0, held.length - keep);
      held = held.slice(held.length - keep);
      return shown;
    },
    end() {
      const rest = hidden ? "" : held;
      held = "";
      return rest;
    },
  };
}

/** What changed in the environment, as variables to set and variables to remove. */
function envDiff(before, after) {
  const set = {};
  const unset = [];
  for (const [key, value] of Object.entries(after)) {
    if (VOLATILE_ENV.has(key) || key.startsWith("__dg")) continue;
    if (before[key] !== value) set[key] = value;
  }
  for (const key of Object.keys(before)) {
    if (VOLATILE_ENV.has(key) || key.startsWith("__dg")) continue;
    if (!(key in after)) unset.push(key);
  }
  return { set, unset: unset.sort() };
}

/** The environment a diff produces on top of a base. */
function applyEnvDiff(base, diff) {
  const env = { ...base, ...diff.set };
  for (const key of diff.unset) delete env[key];
  return env;
}

module.exports = {
  cleanOutput,
  clipWithPointer,
  sliceSince,
  tailLines,
  grepLines,
  supportsState,
  stateEpilogue,
  parseState,
  createStateFilter,
  envDiff,
  applyEnvDiff,
  MAX_OUTPUT_CHARS,
  HEAD_CHARS,
};
