import { describe, expect, it } from "vitest";
import { GREETINGS, GREETING_COUNT, greetingsFor, pickGreeting } from "../greetings";
import { languages } from "../translations";

const codes = languages.map((entry) => entry.code);

describe("every language the picker offers is greeted in its own words", () => {
  it("has a set for each of them", () => {
    const missing = codes.filter((code) => !GREETINGS[code]);
    expect(missing, `no greetings for ${missing.join(", ")}`).toEqual([]);
  });

  it("has no set for a language the picker does not offer", () => {
    expect(Object.keys(GREETINGS).sort()).toEqual([...codes].sort());
  });

  for (const code of codes) {
    it(`${code} carries the full set`, () => {
      expect(GREETINGS[code]).toHaveLength(GREETING_COUNT);
    });

    it(`${code} repeats nothing and leaves nothing blank`, () => {
      const pool = GREETINGS[code];
      expect(pool.filter((line) => line.trim() === "")).toEqual([]);
      expect(new Set(pool).size).toBe(pool.length);
    });

    it(`${code} stays short enough for one line`, () => {
      // The greeting is set in large uppercase type, so a long sentence wraps
      // and stops looking like a greeting.
      const tooLong = GREETINGS[code].filter((line) => line.length > 34);
      expect(tooLong).toEqual([]);
    });
  }

  for (const code of codes) {
    if (code === "en") continue;

    it(`${code} is actually translated, not English`, () => {
      const copied = GREETINGS[code].filter((line) => GREETINGS.en.includes(line));
      expect(copied).toEqual([]);
    });
  }
});

describe("choosing one", () => {
  it("gives the same chat the same greeting every time", () => {
    const first = pickGreeting("en", "chat-abc");
    for (let i = 0; i < 5; i++) {
      expect(pickGreeting("en", "chat-abc")).toBe(first);
    }
  });

  it("uses the whole set as chats come and go", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(pickGreeting("en", `chat-${i}`));
    expect(seen.size).toBe(GREETINGS.en.length);
  });

  it("does not settle on one line for ids that look alike", () => {
    // Chat ids differ by a character or two, which is exactly the case a
    // careless choice would collapse to a single greeting.
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) seen.add(pickGreeting("en", `1735689600000-${i}`));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("greets in the chosen language", () => {
    expect(GREETINGS.fr).toContain(pickGreeting("fr", "chat-abc"));
    expect(GREETINGS.ja).toContain(pickGreeting("ja", "chat-abc"));
  });

  it("falls back to English for a language it does not know", () => {
    expect(GREETINGS.en).toContain(pickGreeting("kl", "chat-abc"));
    expect(greetingsFor("kl")).toBe(GREETINGS.en);
  });

  it("still says something when there is no chat id yet", () => {
    expect(pickGreeting("en", "")).toBeTruthy();
  });
});
