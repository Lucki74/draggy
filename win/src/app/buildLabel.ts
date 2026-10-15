/** `3.0.N` is build N, `3.0.0` is a build from source, anything else keeps its version. */
export function buildLabel(version: string | null | undefined, t: (key: string) => string): string {
  if (!version) return "";
  const match = /^3\.0\.(\d+)$/.exec(version);
  if (!match) return `v${version}`;
  const number = Number(match[1]);
  return number > 0 ? t("buildNumber").replace("{n}", String(number)) : t("devBuild");
}
