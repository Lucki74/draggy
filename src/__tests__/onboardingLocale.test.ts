import { describe, expect, it } from "vitest";
import { localeToLanguage } from "../onboarding/locale";
import { languages } from "../translations";

const codes = languages.map((language) => language.code);

describe("the system language, mapped onto Draggy's", () => {
  it("reads the primary subtag only", () => {
    expect(localeToLanguage("pt-BR", codes)).toBe("pt");
    expect(localeToLanguage("zh-Hant-TW", codes)).toBe("zh");
    expect(localeToLanguage("ar-EG", codes)).toBe("ar");
    expect(localeToLanguage("de_CH", codes)).toBe("de");
    expect(localeToLanguage("JA", codes)).toBe("ja");
  });

  it("falls back to English for anything it does not speak, or nothing", () => {
    expect(localeToLanguage("en", codes)).toBe("en");
    expect(localeToLanguage("xx", codes)).toBe("en");
    expect(localeToLanguage("sv-SE", codes)).toBe("en");
    expect(localeToLanguage("", codes)).toBe("en");
  });
});
