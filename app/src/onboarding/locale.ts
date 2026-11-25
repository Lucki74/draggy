import type { Language } from "../types";

/** The operating system's language, mapped onto one Draggy speaks. Only the primary subtag counts. */
export function localeToLanguage(tag: string, supported: readonly string[]): Language {
  const primary = String(tag || "").trim().toLowerCase().split(/[-_]/)[0];
  return (supported.includes(primary) ? primary : "en") as Language;
}
