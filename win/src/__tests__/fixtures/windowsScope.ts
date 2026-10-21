// The app ships on Windows only. Shared fixtures still hold darwin and linux cases for the Rust port, so these
// runners drive only the cases that do not name another platform. The JSON files themselves are never edited.
const NON_WINDOWS = /^(darwin|macos|mac|linux|aarch64-apple-darwin|x86_64-unknown-linux-.*)$/;

/** Drivers for code that only served macOS and Linux, now gone from the Windows reference. */
/** A release archive built for macOS or Ubuntu. */
const OTHER_ARCHIVE = /-bin-(macos|ubuntu)-/;
const REMOVED_OPS = new Set(["parseCpuList", "linuxTopology", "geminiInstall"]);

function namesOtherPlatform(value: unknown, key = ""): boolean {
  if (typeof value === "string") {
    if ((key === "op" || key === "fn") && REMOVED_OPS.has(value)) return true;
    if (key === "name" && OTHER_ARCHIVE.test(value)) return true;
    return (key === "platform" || key === "platformName" || key === "scheme") && NON_WINDOWS.test(value);
  }
  if (typeof value === "boolean") return key === "windows" && value === false;
  if (Array.isArray(value)) return value.some((item) => namesOtherPlatform(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([k, v]) => namesOtherPlatform(v, k));
  }
  return false;
}

/** True when the case is meant for a platform other than Windows. */
export function isOtherPlatformCase(testCase: { input?: unknown }): boolean {
  return namesOtherPlatform(testCase.input);
}

/** Fixture files whose every case targets another platform; any other file running empty is a bug. */
const NO_WINDOWS_CASES = new Set(["engine-environment.json"]);

/** The cases a Windows-only build runs. A file may run empty only when it is listed above. */
export function windowsCases<T extends { input?: unknown }>(file: string, cases: T[]): T[] {
  const kept = cases.filter((testCase) => !isOtherPlatformCase(testCase));
  if (kept.length === 0 && !NO_WINDOWS_CASES.has(file)) throw new Error(`${file}: every case names another platform`);
  return kept;
}
