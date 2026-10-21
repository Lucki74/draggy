/** A Google account through the Antigravity CLI (`agy`) in headless mode: one process per turn, text only.
 * Draggy's tools are not offered to it, and `--dangerously-skip-permissions` is never passed (google/MODE.md). */
const fs = require("node:fs");
const path = require("node:path");
const platform = require("../../platform.cjs");
const { googleFailure, parseGoogleError } = require("../google/failure.cjs");
const { flatten, textOf } = require("./claude.cjs");
const { log } = require("../../logger.cjs");

const PRINT_TIMEOUT = "5m";
// The CLI's own timeout plus a minute, for a process that hangs past it.
const WATCHDOG_MS = 6 * 60_000;
const PROBE_MS = 15_000;
// Windows allows 32767 characters on a command line; the rest is the flags and the path.
const MAX_PROMPT = 24_000;
const MAX_STDERR = 8_000;
const VERIFY_PROMPT = "Reply with the single word ok.";

const failure = (kind, message, extra = {}) => ({ kind, status: 0, message, providerMessage: message, ...extra });
const fail = (f) => Object.assign(new Error(f.message), { failure: f });

/** The first `agy` on the search path, or the one named by DRAGGY_AGY_PATH. Only an .exe on Windows: nothing runs through a shell. */
function locateAgy({ env = process.env, exists = fs.existsSync, isWindows = platform.IS_WINDOWS } = {}) {
  if (env.DRAGGY_AGY_PATH) return exists(env.DRAGGY_AGY_PATH) ? env.DRAGGY_AGY_PATH : null;
  const name = isWindows ? "agy.exe" : "agy";
  for (const dir of (env.PATH || "").split(path.delimiter)) {
    if (dir && exists(path.join(dir, name))) return path.join(dir, name);
  }
  return null;
}

/** Accepts a build only when it prints the typed event stream: older builds print plain text and cannot be parsed. */
function judgeBuild({ version, help }) {
  const text = String(help || "");
  if (!/--output-format/.test(text) || !/stream-json/.test(text)) {
    return { ok: false, version, reason: "This agy build cannot print the stream-json output Draggy reads. Update the Antigravity CLI." };
  }
  return { ok: true, version };
}

/** The prompt of one turn: the conversation so far as text, then the new message. Oldest turns go first when it is too long. */
function toPrompt(messages) {
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  const input = lastUser >= 0 ? messages[lastUser] : null;
  const history = lastUser >= 0 ? messages.slice(0, lastUser) : messages;
  const text = input ? textOf(input.content) : "";
  let kept = history;
  let earlier = flatten(kept);
  let dropped = 0;
  while (earlier.length + text.length > MAX_PROMPT && kept.length > 0) {
    kept = kept.slice(1);
    dropped += 1;
    earlier = flatten(kept);
  }
  if (dropped) log.warn("providers.agy", "prompt trimmed to fit the command line", { dropped, kept: kept.length });
  return { prompt: [earlier, text].filter(Boolean).join("\n\n"), dropped };
}

function usageOf(usage) {
  return { promptTokens: usage?.input_tokens ?? usage?.prompt_tokens ?? 0, outputTokens: usage?.output_tokens ?? usage?.completion_tokens ?? 0 };
}

/** Reads the NDJSON stream one event at a time. `on` gets `{ delta, tool, init, result }` calls. */
function createEventReader(on) {
  let buffer = "";
  const one = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch (error) {
      log.swallow("providers.agy", error, "stdout should hold only events; a stray line is counted by length");
      on.stray?.(trimmed.length);
      return;
    }
    if (event.event === "init") on.init?.(event);
    else if (event.event === "step_update") {
      if (event.text_delta && event.step_type === "agent_response") on.delta?.(String(event.text_delta));
      else if (event.step_type === "tool" && event.state === "DONE") on.tool?.(event.tool_name || event.tool_info?.name || "", event.tool_info?.error);
    } else if (event.event === "result") on.result?.(event);
  };
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      lines.forEach(one);
    },
    end() {
      if (buffer) one(buffer);
      buffer = "";
    },
  };
}

/** The failure a finished `result` event stands for, or null when it succeeded. */
function resultFailure(result) {
  const status = String(result?.status || "");
  if (status === "SUCCESS") return null;
  const error = result?.error;
  const text = typeof error === "string" ? error : JSON.stringify(error ?? { message: `The run ended as ${status || "unknown"}.` });
  if (status === "CANCELED" || status === "INTERRUPTED") return failure("provider-unknown-error", `The Antigravity CLI ended the run (${status}).`);
  return googleFailure(text);
}

function createAgyAdapter({
  appData,
  log: debug = () => {},
  confirm = async () => false,
  spawn = platform.spawnHidden,
  exec = platform.execFileHidden,
  env = process.env,
  locate = locateAgy,
}) {
  const dir = path.join(appData, "agy");
  const stateFile = path.join(dir, "state.json");
  const cwd = path.join(dir, "cwd");
  let running = null;
  let listed = null;
  let build = null;

  function readState() {
    try {
      return JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") log.swallow("providers.agy", error, "an unreadable state file reads as not signed in");
      return {};
    }
  }
  function writeState(state) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state));
  }

  const run = (binary, args) =>
    new Promise((resolve) => {
      exec(binary, args, { encoding: "utf8", timeout: PROBE_MS, cwd: dir }, (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ""), stderr: String(stderr || "") }));
    });

  /** `--version` and `--help`, once per binary. */
  async function checkBuild(binary) {
    if (build?.binary === binary) return build.verdict;
    fs.mkdirSync(dir, { recursive: true });
    const version = await run(binary, ["--version"]);
    const help = await run(binary, ["--help"]);
    const verdict = judgeBuild({ version: version.stdout.trim(), help: help.stdout + help.stderr });
    log.info("providers.agy", "build checked", { version: verdict.version, ok: verdict.ok, versionExit: version.error ? 1 : 0 });
    build = { binary, verdict };
    return verdict;
  }

  /** One headless turn. Text goes to `sse` as it arrives; the usage and the failure, if any, come back. */
  function runTurn({ binary, prompt, model, sse, signal }) {
    fs.mkdirSync(cwd, { recursive: true });
    const args = ["-p", prompt, "--output-format", "stream-json", "--print-timeout", PRINT_TIMEOUT, ...(model ? ["--model", model] : [])];
    return new Promise((resolve) => {
      const child = spawn(binary, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      running = child;
      let stderr = "";
      let text = "";
      let outcome = null;
      let streamed = false;
      let permissionRefused = false;
      let toolCalls = 0;
      const watchdog = setTimeout(() => child.kill(), WATCHDOG_MS);
      const abort = () => child.kill();
      signal?.addEventListener("abort", abort, { once: true });
      const reader = createEventReader({
        init: (event) => {
          log.debug("providers.agy", "stream started", { tools: event.tools?.length ?? 0, permissionMode: event.permission_mode });
          if (event.permission_mode && event.permission_mode !== "request-review") {
            permissionRefused = true;
            child.kill();
          }
        },
        delta: (delta) => {
          streamed = true;
          text += delta;
          sse?.delta({ content: delta });
        },
        tool: (name, error) => {
          toolCalls += 1;
          log.info("providers.agy", "agy used its own tool, which Draggy does not offer", { tool: name, failed: Boolean(error) });
        },
        stray: (length) => log.debug("providers.agy", "stray stdout line", { length }),
        result: (event) => {
          outcome = event;
        },
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => reader.push(chunk));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-MAX_STDERR);
      });
      child.on("error", (error) => {
        clearTimeout(watchdog);
        running = null;
        resolve({ failure: failure("account-runtime-unavailable", `The Antigravity CLI could not start: ${error.message}`), text });
      });
      child.on("close", (code) => {
        clearTimeout(watchdog);
        signal?.removeEventListener("abort", abort);
        running = null;
        reader.end();
        log.info("providers.agy", "turn ended", { exit: code, status: outcome?.status, toolCalls, stderrLength: stderr.length, answerLength: text.length });
        if (signal?.aborted) return resolve({ aborted: true, text });
        if (permissionRefused) {
          return resolve({ failure: failure("provider-unknown-error", "The Antigravity CLI is set to run tools without asking, which Draggy does not allow. Set its permissions back to asking."), text });
        }
        if (outcome) {
          const bad = resultFailure(outcome);
          if (bad) return resolve({ failure: bad, text });
          if (!streamed && outcome.response) {
            text = String(outcome.response);
            sse?.delta({ content: text });
          }
          return resolve({ usage: usageOf(outcome.usage), text });
        }
        // No result event: the stderr reason is all there is.
        const parsed = parseGoogleError(stderr);
        const bad = googleFailure(stderr || `The Antigravity CLI exited with code ${code}.`);
        return resolve({ failure: parsed.status || stderr ? bad : failure("provider-unknown-error", `The Antigravity CLI exited with code ${code}.`), text });
      });
    });
  }

  async function ready() {
    const state = readState();
    if (!state.enabled || !state.acknowledgedAt) throw fail(failure("account-signed-out", "Antigravity sign-in is off."));
    const binary = locate({ env }) || state.binary;
    if (!binary || !fs.existsSync(binary)) throw fail(failure("account-runtime-unavailable", "The Antigravity CLI (agy) was not found."));
    const verdict = await checkBuild(binary);
    if (!verdict.ok) throw fail(failure("account-runtime-unavailable", verdict.reason));
    return binary;
  }

  async function stream({ body, modelId, sse, signal }) {
    const binary = await ready();
    const { prompt } = toPrompt(Array.isArray(body.messages) ? body.messages : []);
    const known = (await models()).some((m) => m.id === modelId);
    const result = await runTurn({ binary, prompt, model: known ? modelId : undefined, sse, signal });
    if (result.aborted) return;
    if (result.failure) {
      if (result.failure.kind === "account-signed-out") writeState({ ...readState(), signedIn: false });
      throw fail(result.failure);
    }
    sse.finish("stop", result.usage);
  }

  /** Warns once, finds `agy`, checks the build and proves the login with one short turn. */
  async function signIn(instanceId, { onProgress = () => {} } = {}) {
    const state = readState();
    if (!state.acknowledgedAt) {
      if (!(await confirm())) return { signedIn: false, cancelled: true };
      writeState({ ...state, acknowledgedAt: Date.now() });
    }
    onProgress({ step: "starting" });
    const binary = locate({ env });
    if (!binary) {
      return { signedIn: false, error: "The Antigravity CLI (agy) was not found. Install it from antigravity.google/cli, run agy once in a terminal to sign in, then try again." };
    }
    const verdict = await checkBuild(binary);
    if (!verdict.ok) return { signedIn: false, error: verdict.reason };
    const proof = await runTurn({ binary, prompt: VERIFY_PROMPT, sse: null, signal: null });
    if (proof.failure) {
      const hint = proof.failure.kind === "account-signed-out" ? " Run agy once in a terminal and sign in there." : "";
      return { signedIn: false, error: `${proof.failure.message}${hint}` };
    }
    writeState({ ...readState(), enabled: true, signedIn: true, binary });
    onProgress({ step: "done" });
    return status();
  }

  /** `agy models` lists the model slugs; the first word of each line is the slug. */
  async function models() {
    const state = readState();
    if (!state.signedIn) return [];
    if (!listed) {
      const binary = locate({ env }) || state.binary;
      if (!binary) return [];
      const answer = await run(binary, ["models"]);
      listed = answer.stdout
        .split(/\r?\n/)
        .map((line) => /^([A-Za-z0-9][\w.:/-]*)/.exec(line.trim())?.[1])
        .filter(Boolean)
        .map((id) => ({ id, name: id, inputModalities: ["text"] }));
      log.info("providers.agy", "models listed", { count: listed.length });
    }
    return listed;
  }

  async function status() {
    const state = readState();
    if (state.enabled && state.signedIn) return { signedIn: true };
    // The old Gemini CLI route kept its login under <userData>/gemini; Antigravity needs a fresh one.
    const hadOldRoute = !fs.existsSync(stateFile) && fs.existsSync(path.join(appData, "gemini"));
    return hadOldRoute ? { signedIn: false, reauth: true } : { signedIn: false };
  }

  /** Forgets Draggy's side only: agy keeps its own login, which is signed out by running agy itself. */
  async function signOut() {
    // The warning stays accepted, and the file's presence ends the "sign in again" prompt.
    writeState({ acknowledgedAt: readState().acknowledgedAt });
    listed = null;
    build = null;
  }

  async function cancel() {
    running?.kill();
  }

  async function stopAll() {
    running?.kill();
  }

  debug("agy adapter ready");
  return { stream, signIn, submitCode: () => false, cancel, signOut, status, download: () => null, models, stopAll };
}

module.exports = { createAgyAdapter, locateAgy, judgeBuild, toPrompt, createEventReader, resultFailure };
