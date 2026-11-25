import { ES } from "./descriptions.es";
import { FR } from "./descriptions.fr";
import { RU } from "./descriptions.ru";

const TABLES: Record<string, Record<string, string>> = { fr: FR, es: ES, ru: RU };

/** The bundled server or skill described in the user's language, or the English text when there is none. */
export function localDescription(
  t: (key: string) => string,
  kind: "mcp" | "skill",
  id: string,
  fallback: string,
): string {
  return TABLES[t("localeCode")]?.[`${kind}:${id}`] ?? fallback;
}
