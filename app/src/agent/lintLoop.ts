/** Lint and test checks run after the agent edits files. Pure logic only: the caller runs the commands
 * through run_command so the permission and sandbox rules still apply. */

export type CheckId = "lint" | "typecheck" | "test";

export interface CheckCommand {
  id: CheckId;
  command: string;
  /** What the command runs: the script text, or a hash of the manifest. Confirmation is void when it changes. */
  body?: string;
}

/** Files at the project root that decide which checks exist, keyed by file name. */
export type ManifestFiles = Record<string, string>;

export const DEFAULT_RETRY_CAP = 2;
const MAX_FAILURE_CHARS = 4000;

function scriptsOf(manifest: string | undefined): Record<string, string> {
  if (!manifest) return {};
  try {
    const parsed = JSON.parse(manifest) as { scripts?: Record<string, unknown> };
    const scripts: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed.scripts ?? {})) {
      if (typeof value === "string") scripts[name] = value;
    }
    return scripts;
  } catch {
    return {};
  }
}

/** Short stable hash (FNV-1a) of a manifest, so a changed file voids confirmation. */
export function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The checks a project's manifests suggest, in run order. An empty list means nothing to run. */
export function detectChecks(files: ManifestFiles): CheckCommand[] {
  const checks: CheckCommand[] = [];
  const scripts = scriptsOf(files["package.json"]);
  const npmBody = (name: string) => [`pre${name}`, name, `post${name}`].map((key) => scripts[key] ?? "").join("\n");
  if (scripts.lint) checks.push({ id: "lint", command: "npm run lint", body: npmBody("lint") });
  if (scripts.typecheck) checks.push({ id: "typecheck", command: "npm run typecheck", body: npmBody("typecheck") });
  if (scripts.test) checks.push({ id: "test", command: "npm test -- -q", body: npmBody("test") });

  if (files["Cargo.toml"] !== undefined) {
    const body = `Cargo.toml ${digest(files["Cargo.toml"])}`;
    checks.push({ id: "lint", command: "cargo clippy --all-targets -- -D warnings", body });
    checks.push({ id: "test", command: "cargo test -q", body });
  }

  const python = files["pyproject.toml"];
  if (python !== undefined) {
    const body = `pyproject.toml ${digest(python)}`;
    if (python.includes("[tool.ruff")) checks.push({ id: "lint", command: "ruff check .", body });
    if (python.includes("[tool.pytest")) checks.push({ id: "test", command: "pytest -q --tb=line", body });
  }

  return checks.filter((check, index) => checks.findIndex((other) => other.command === check.command) === index);
}

export interface ProjectLintConfig {
  enabled: boolean;
  /** The exact commands the user confirmed for this project. */
  confirmed: CheckCommand[];
}

/** Checks run only when the loop is on and the user confirmed this exact list. A changed list needs a new confirm. */
export function runnableChecks(config: ProjectLintConfig | undefined, detected: CheckCommand[]): CheckCommand[] {
  if (!config?.enabled || detected.length === 0) return [];
  const key = (list: CheckCommand[]) => JSON.stringify(list.map((check) => [check.command, check.body ?? ""]));
  return key(config.confirmed) === key(detected) ? detected : [];
}

export interface CheckOutcome {
  check: CheckCommand;
  exitCode: number;
  output: string;
}

/** Seconds a check may run before run_command hands it to the background. */
export const CHECK_TIMEOUT_SECONDS = 300;

/** Task id of a command that moved to the background, so the loop can stop it. */
export function backgroundTaskId(result: string): string | null {
  const match = /\btask (\S+?)\.(?:\s|$)/.exec(result);
  return match ? match[1] : null;
}

/** A run without an exit line (timeout, background, unknown) is a failure, never a pass. */
export function outcomeOf(check: CheckCommand, result: string, body: string): CheckOutcome {
  const exitCode = parseExitCode(result);
  if (exitCode === null) return { check, exitCode: -1, output: `Did not finish with an exit code.\n${body}` };
  return { check, exitCode, output: body };
}

/** Raw output beyond this is cut from the front before any regex runs. */
const MAX_RAW_CHARS = 200_000;

/** Keeps the tail of a failing output, where the errors usually are. */
export function trimFailure(output: string, max = MAX_FAILURE_CHARS): string {
  if (output.length <= max) return output;
  return `...${output.slice(output.length - max)}`;
}

/** The message fed back to the model after a failed check, or null when every check passed. */
export function failureReport(outcomes: CheckOutcome[]): string | null {
  const failed = outcomes.filter((outcome) => outcome.exitCode !== 0);
  if (failed.length === 0) return null;
  return failed
    .map((outcome) => `${outcome.check.command} exited ${outcome.exitCode}:\n${trimFailure(stripAnsi(outcome.output.slice(-MAX_RAW_CHARS)))}`)
    .join("\n\n");
}

export type LoopStep = "pass" | "retry" | "stop";

/** After `attempt` failed rounds (1 for the first failure), decide whether the model gets another try. */
export function nextStep(passed: boolean, attempt: number, cap: number = DEFAULT_RETRY_CAP): LoopStep {
  if (passed) return "pass";
  return attempt < cap ? "retry" : "stop";
}

/** Reads a stored config from database JSON. Anything malformed reads as no config, so the loop stays off. */
export function readLintConfig(value: unknown): ProjectLintConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { enabled?: unknown; confirmed?: unknown };
  if (typeof raw.enabled !== "boolean") return undefined;
  const confirmed: CheckCommand[] = [];
  if (Array.isArray(raw.confirmed)) {
    for (const item of raw.confirmed) {
      const check = item as Partial<CheckCommand> | null;
      if (check && typeof check.command === "string" && (check.id === "lint" || check.id === "typecheck" || check.id === "test")) {
        confirmed.push({ id: check.id, command: check.command, body: typeof check.body === "string" ? check.body : undefined });
      }
    }
  }
  return { enabled: raw.enabled, confirmed };
}

// eslint-disable-next-line no-control-regex -- matches the escape byte of ANSI sequences
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/** Exit code from a run_command result. Null when the format is not an exit line (timeout, background). */
export function parseExitCode(result: string): number | null {
  const match = /^TOOL RESULT \(run_command\): Exit code (-?\d+)\./.exec(result);
  return match ? Number(match[1]) : null;
}

/** A run_command result that is not a run_command answer at all: a refusal or a cancel. */
export function isRefusedResult(result: string): boolean {
  return !result.startsWith("TOOL RESULT (run_command):");
}

const FAILED_EDIT = /^TOOL RESULT \([^)]+\): (Could not|Failed|Error)/;

/** True when a file tool call changed files, so the checks should run again. */
export function isSuccessfulEdit(name: string, result: string): boolean {
  return ["edit_file", "write_file", "create_file"].includes(name) && result.startsWith(`TOOL RESULT (${name}): `) && !FAILED_EDIT.test(result);
}
