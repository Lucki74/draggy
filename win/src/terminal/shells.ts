/** Shells the run_command tool accepts. electron/shells.cjs repeats this list; shells.test.js keeps them equal. */
export const SHELL_IDS = ["pwsh", "powershell", "cmd", "bash", "sh"] as const;

export type ShellId = (typeof SHELL_IDS)[number];
