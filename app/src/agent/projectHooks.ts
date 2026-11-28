/** Project hooks from `.draggy/hooks.json`. They run only when the user trusted that file's exact text. */

import { hookFileDigest, isProjectHooksTrusted, parseHooksConfig, type HookEntry } from "./hooks";

export const PROJECT_HOOKS_PATH = ".draggy/hooks.json";

export interface ProjectHooks {
  /** SHA-256 of the file text, or null when there is no readable file. */
  digest: string | null;
  entries: HookEntry[];
  errors: string[];
  /** Whether the entries may run: the file's digest matches the one the user trusted. */
  trusted: boolean;
}

const NONE: ProjectHooks = { digest: null, entries: [], errors: [], trusted: false };

/** Reads the project file. A missing or unreadable file means no project hooks, never an error. */
export async function loadProjectHooks(workspaceId: string, trustedDigest: string | undefined): Promise<ProjectHooks> {
  const api = window.draggy?.files;
  if (!workspaceId || !api) return NONE;
  let text: string;
  try {
    const result = await api.read(workspaceId, PROJECT_HOOKS_PATH);
    if (!result.success || typeof result.text !== "string") return NONE;
    text = result.text;
  } catch {
    return NONE;
  }
  const digest = await hookFileDigest(text);
  const parsed = parseJson(text);
  if (parsed.error) return { digest, entries: [], errors: [parsed.error], trusted: false };
  const { hooks, errors } = parseHooksConfig(parsed.value);
  return { digest, entries: hooks, errors, trusted: isProjectHooksTrusted(trustedDigest, digest) };
}

function parseJson(text: string): { value: unknown; error?: string } {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { value: null, error: "hooks.json is not valid JSON" };
  }
}
