#!/usr/bin/env node
/** Reads events.jsonl: `npm run logs -- --level warn --scope engine --since 10m`, `npm run logs:turn <cid>`. */
const fs = require("fs");
const os = require("os");
const path = require("path");

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const COLORS = { DEBUG: "\x1b[90m", INFO: "\x1b[36m", WARN: "\x1b[33m", ERROR: "\x1b[31m" };
const RESET = "\x1b[0m";

function defaultDir() {
  if (process.env.DRAGGY_LOG_DIR) return process.env.DRAGGY_LOG_DIR;
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Draggy", "logs");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Draggy", "logs");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Draggy", "logs");
}

function parseDuration(text) {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(text || "");
  if (!match) return null;
  const unit = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return Number(match[1]) * unit;
}

function parseArgs(argv) {
  const options = { json: false, color: Boolean(process.stdout.isTTY) };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    if (arg === "--level") options.level = String(value()).toUpperCase();
    else if (arg === "--scope") options.scope = value();
    else if (arg === "--cid") options.cid = value();
    else if (arg === "--session") options.session = value();
    else if (arg === "--since") options.since = value();
    else if (arg === "--dir") options.dir = value();
    else if (arg === "--turn") options.turn = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--no-color") options.color = false;
    else if (arg === "--color") options.color = true;
    else if (!arg.startsWith("-")) positional.push(arg);
    else throw new Error(`unknown option ${arg}`);
  }
  if (options.level && !(options.level in LEVELS)) throw new Error(`unknown level ${options.level}`);
  if (options.since && parseDuration(options.since) === null) throw new Error(`bad --since ${options.since}, use 90s, 10m, 2h or 1d`);
  return { options, positional };
}

/** Oldest rotation first, so the output is in time order. */
function readEvents(dir) {
  const base = path.join(dir, "events.jsonl");
  const events = [];
  for (const file of [`${base}.3`, `${base}.2`, `${base}.1`, base]) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // a line cut by a crash
      }
    }
  }
  return events;
}

function matches(event, options, now) {
  if (options.level && (LEVELS[event.level] ?? 0) < LEVELS[options.level]) return false;
  if (options.scope && !(event.scope === options.scope || String(event.scope).startsWith(`${options.scope}.`))) return false;
  if (options.cid && event.cid !== options.cid) return false;
  if (options.session && event.session !== options.session) return false;
  if (options.since && Date.parse(event.ts) < now - parseDuration(options.since)) return false;
  return true;
}

function format(event, options, origin) {
  const time = origin === undefined ? event.ts.slice(11, 23) : `+${String(Date.parse(event.ts) - origin).padStart(6)} ms`;
  const level = String(event.level).padEnd(5);
  const head = `${time} ${options.color ? COLORS[event.level] ?? "" : ""}${level}${options.color ? RESET : ""} ${String(event.proc || "").padEnd(8)} ${event.scope}`;
  let line = `${head}  ${event.msg}`;
  if (event.durMs !== undefined) line += ` (${event.durMs} ms)`;
  if (event.data !== undefined) line += `  ${JSON.stringify(event.data)}`;
  if (event.err) line += `\n    ${event.err.name || "Error"}${event.err.code ? ` ${event.err.code}` : ""}: ${event.err.message ?? ""}`;
  return line;
}

function select(events, options, now = Date.now()) {
  return events.filter((event) => matches(event, options, now));
}

function run(argv, out = (line) => process.stdout.write(`${line}\n`)) {
  const { options, positional } = parseArgs(argv);
  const turn = options.turn ? positional[0] : null;
  if (options.turn && !turn) throw new Error("usage: npm run logs:turn <cid>");
  if (turn) options.cid = turn;
  const dir = options.dir || defaultDir();
  const chosen = select(readEvents(dir), options);
  if (!chosen.length) {
    out(`no matching lines in ${path.join(dir, "events.jsonl")}`);
    return 1;
  }
  const origin = turn ? Date.parse(chosen[0].ts) : undefined;
  for (const event of chosen) out(options.json ? JSON.stringify(event) : format(event, options, origin));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`logs: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { parseArgs, parseDuration, readEvents, select, format, run, defaultDir };
