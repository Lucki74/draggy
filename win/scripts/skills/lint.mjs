// Lints win/electron/skills-library against the draggy skill contract (docs/skills-remake-plan.md).
// Usage: node scripts/skills/lint.mjs [--strict] [--json] [skill-id ...]
// Errors fail the run. Warnings fail it only with --strict.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY = path.resolve(here, "../../electron/skills-library");

export const TOOLS = new Set([
  "ask_user", "create_file", "delete_file", "edit_file", "explore", "generate_image", "git_diff", "git_status",
  "list_directory", "move_file", "read_file", "read_url", "run_code", "run_command", "search_files",
  "search_library", "search_web", "update_plan", "use_skill", "write_file",
  "browser_click", "browser_close", "browser_console", "browser_dialog", "browser_drag", "browser_get_elements",
  "browser_get_text", "browser_history", "browser_hover", "browser_navigate", "browser_press_key",
  "browser_screenshot", "browser_scroll", "browser_select_option", "browser_snapshot", "browser_tabs",
  "browser_type", "browser_wait",
]);

// Names from other harnesses, and the draggy tool each one maps to.
export const FOREIGN = {
  Read: "read_file", Write: "write_file", Edit: "edit_file", MultiEdit: "edit_file", Bash: "run_command",
  Grep: "search_files", Glob: "search_files", LS: "list_directory", WebFetch: "read_url", WebSearch: "search_web",
  Task: "explore", Agent: "explore", TodoWrite: "update_plan", Skill: "use_skill", AskUserQuestion: "ask_user",
  NotebookEdit: "edit_file",
};

const ALLOWED_KEYS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TRIGGER_RE = /\buse (this |it |me )?when\b|\buse (this |it )?(for|to)\b|\bwhen the user\b/i;
const TELLS = /—|\bnot just\b|\bnot only\b|important to note|worth noting|\bAdditionally,|\bMoreover,|\bdelve\b|tapestry|testament|\bserves as\b|\bstands as\b|\bboasts\b|\bIn summary\b|game-chang/i;
const SECTIONS = ["goal", "when to use", "steps", "gotchas", "output"];

export function parseFrontmatter(text) {
  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!src.startsWith("---\n")) return null;
  const end = src.indexOf("\n---", 4);
  if (end < 0) return null;
  const lines = src.slice(4, end).split("\n");
  const fields = {};
  let key = null;
  for (const line of lines) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (m && !/^\s/.test(line)) {
      key = m[1];
      let v = m[2].trim();
      if (v === ">" || v === "|" || v === ">-" || v === "|-") v = "";
      fields[key] = v.replace(/^(["'])(.*)\1$/, "$2");
    } else if (key && line.trim()) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  return { fields, body: src.slice(end + 4).replace(/^\n/, "") };
}

function words(s) {
  return new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
}

export function lintSkill(id, dir) {
  const issues = [];
  const add = (level, rule, msg) => issues.push({ id, level, rule, msg });
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file)) {
    add("error", "file", "SKILL.md missing");
    return { issues };
  }
  const parsed = parseFrontmatter(fs.readFileSync(file, "utf8"));
  if (!parsed) {
    add("error", "frontmatter", "no front matter at line 1");
    return { issues };
  }
  const { fields, body } = parsed;
  for (const k of Object.keys(fields)) if (!ALLOWED_KEYS.has(k)) add("error", "keys", `unknown key '${k}'`);
  if (fields.name !== id) add("error", "name", `name '${fields.name}' differs from folder '${id}'`);
  if (!NAME_RE.test(id) || id.length > 64) add("error", "name", "id must be lowercase-hyphen, 64 chars at most");
  const desc = fields.description ?? "";
  if (!desc) add("error", "description", "missing");
  if (desc.length > 1024) add("error", "description", `${desc.length} chars, limit 1024`);
  if (desc && !TRIGGER_RE.test(desc)) add("warn", "trigger", "description has no 'Use when' trigger");
  const lines = body.split("\n").length;
  if (lines > 500) add("error", "length", `${lines} body lines, limit 500`);
  // Tool names
  const stripped = body.replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, " "));
  for (const m of stripped.matchAll(/`([A-Za-z_]+)`/g)) {
    const t = m[1];
    if (FOREIGN[t]) add("error", "tools", `foreign tool '${t}', use '${FOREIGN[t]}'`);
    else if (/^(browser|git)_[a-z_]+$/.test(t) && !TOOLS.has(t)) add("error", "tools", `unknown tool '${t}'`);
  }
  // File references one level deep
  for (const m of body.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) {
    const rel = m[1].split("#")[0];
    if (!rel || !/[./]/.test(rel)) continue; // a bare word is a placeholder, not a path
    if (rel.split("/").filter((p) => p && p !== ".").length > 2) add("error", "refs", `'${rel}' is deeper than one level`);
    if (!fs.existsSync(path.join(dir, rel))) add("error", "refs", `'${rel}' does not exist`);
  }
  // Section order (warning until the reformat lands)
  const heads = [...body.matchAll(/^##\s+(.+)$/gm)].map((h) => h[1].trim().toLowerCase());
  const present = SECTIONS.filter((s) => heads.some((h) => h.startsWith(s)));
  if (present.length < SECTIONS.length) add("warn", "sections", `missing: ${SECTIONS.filter((s) => !present.includes(s)).join(", ")}`);
  if (TELLS.test(body) || TELLS.test(desc)) add("warn", "tells", `AI tell: ${(TELLS.exec(body + desc) ?? [])[0]}`);
  return { issues, desc };
}

export function lintLibrary(only = []) {
  const catalog = JSON.parse(fs.readFileSync(path.join(LIBRARY, "library.json"), "utf8"));
  const dirs = fs.readdirSync(LIBRARY, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const issues = [];
  const descs = [];
  for (const id of dirs) {
    if (only.length && !only.includes(id)) continue;
    const r = lintSkill(id, path.join(LIBRARY, id));
    issues.push(...r.issues);
    if (r.desc) descs.push([id, words(r.desc)]);
  }
  // Pointers to other skills ("use_skill with `id`") must name a folder that exists.
  for (const id of dirs) {
    if (only.length && !only.includes(id)) continue;
    const body = fs.readFileSync(path.join(LIBRARY, id, "SKILL.md"), "utf8");
    for (const m of body.matchAll(/use_skill[^\n]*?`([a-z0-9]+(?:-[a-z0-9]+)*)`/g))
      if (!dirs.includes(m[1]) && m[1] !== "use_skill") issues.push({ id, level: "error", rule: "pointer", msg: `points to unknown skill '${m[1]}'` });
  }
  const cats = new Set(catalog.categories);
  const listed = new Set();
  for (const s of catalog.skills) {
    if (listed.has(s.id)) issues.push({ id: s.id, level: "error", rule: "catalogue", msg: "duplicate entry" });
    listed.add(s.id);
    if (!dirs.includes(s.id)) issues.push({ id: s.id, level: "error", rule: "catalogue", msg: "no skill folder" });
    if (!cats.has(s.category)) issues.push({ id: s.id, level: "error", rule: "catalogue", msg: `unknown category '${s.category}'` });
    if (!["chat", "code", "both"].includes(s.surface)) issues.push({ id: s.id, level: "error", rule: "catalogue", msg: "bad surface" });
    if (typeof s.on !== "boolean") issues.push({ id: s.id, level: "error", rule: "catalogue", msg: "'on' must be boolean" });
    if (!s.summary || [...s.summary].length > 48) issues.push({ id: s.id, level: "error", rule: "catalogue", msg: "summary missing or over 48 chars" });
    if (s.tags !== undefined && (!Array.isArray(s.tags) || s.tags.some((t) => typeof t !== "string")))
      issues.push({ id: s.id, level: "error", rule: "catalogue", msg: "tags must be a string list" });
  }
  for (const id of dirs) if (!listed.has(id) && (!only.length || only.includes(id))) issues.push({ id, level: "error", rule: "catalogue", msg: "not in library.json" });
  // Near-duplicate descriptions
  for (let i = 0; i < descs.length; i++)
    for (let j = i + 1; j < descs.length; j++) {
      const [a, wa] = descs[i];
      const [b, wb] = descs[j];
      const inter = [...wa].filter((w) => wb.has(w)).length;
      const sim = inter / (wa.size + wb.size - inter || 1);
      if (sim > 0.7) issues.push({ id: a, level: "warn", rule: "duplicate", msg: `description close to '${b}' (${sim.toFixed(2)})` });
    }
  return { issues, count: dirs.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const asJson = args.includes("--json");
  const only = args.filter((a) => !a.startsWith("--"));
  const { issues, count } = lintLibrary(only);
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");
  if (asJson) console.log(JSON.stringify({ count, issues }, null, 1));
  else {
    for (const i of issues) console.log(`${i.level.padEnd(5)} ${i.id}: [${i.rule}] ${i.msg}`);
    console.log(`${count} skills, ${errors.length} errors, ${warns.length} warnings`);
  }
  process.exit(errors.length || (strict && warns.length) ? 1 : 0);
}
