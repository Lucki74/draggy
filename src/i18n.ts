import { useCallback } from "react";
import { translations } from "./translations";
import { logRendererOnce } from "./logger";

/** One string in the user's language. English is the fallback, and the key itself is the last
 * resort, so a string added mid-feature shows its name rather than an empty space. */
export function translate(language: string, key: string): string {
  const text = translations[language]?.[key] || translations["en"][key];
  if (text) return text;
  logRendererOnce(`i18n:${key}`, "i18n", "WARN", "missing translation", { key, language });
  return key;
}

/** The same lookup, with an identity stable enough for a memo() to trust. */
export function useTranslator(language: string) {
  return useCallback((key: string) => translate(language, key), [language]);
}
