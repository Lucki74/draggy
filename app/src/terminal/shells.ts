/** Shells the run_command tool accepts. The Rust side repeats this list. */
export const SHELL_IDS = ["pwsh", "powershell", "cmd", "bash", "sh", "zsh"] as const;

export type ShellId = (typeof SHELL_IDS)[number];
