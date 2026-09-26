/** The operating system's language, mapped onto one Draggy speaks. Only the primary subtag counts:
 * Draggy has one Portuguese and one Chinese, so every region and script shares it. */
export function localeToLanguage(tag: string, supported: string[]): string {
  const primary = String(tag || "").trim().toLowerCase().split(/[-_]/)[0];
  return supported.includes(primary) ? primary : "en";
}
