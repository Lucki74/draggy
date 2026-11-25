/** `3.0.N` is build N, `3.0.0` is a build from source, anything else keeps its version. */
export function buildLabel(version: string | null | undefined, t: (key: string) => string): string {
  if (!version) return "";
  const match = /^3\.0\.(\d+)$/.exec(version);
  if (!match) return `v${version}`;
  const number = Number(match[1]);
  return number > 0 ? t("buildNumber").replace("{n}", String(number)) : t("devBuild");
}

/** `v3.0.5 (build 5)`: the version with its build in brackets; other versions keep the plain form. */
export function versionLabel(version: string | null | undefined, t: (key: string) => string): string {
  if (!version) return "";
  if (!/^3\.0\.\d+$/.test(version)) return `v${version}`;
  return t("versionWithBuild").replace("{version}", version).replace("{build}", buildLabel(version, t));
}
