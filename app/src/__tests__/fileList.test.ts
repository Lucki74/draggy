import { describe, it, expect } from "vitest";
import {
  FILE_GROUPS,
  formatSize,
  groupFiles,
  groupFor,
  kindOf,
  matchesQuery,
} from "../fileList";
import { TITLE_LENGTH, hueFor, siteLabel, titleFromContent } from "../utils";

const DAY = 24 * 60 * 60 * 1000;

/** A fixed afternoon, so the day boundaries in these tests never drift. */
const NOON = new Date("2026-08-25T14:30:00").getTime();
const startOfToday = new Date(NOON).setHours(0, 0, 0, 0);

describe("naming the kind of file", () => {
  it("recognises the usual document types", () => {
    expect(kindOf("docx")).toBe("document");
    expect(kindOf("md")).toBe("document");
    expect(kindOf("pdf")).toBe("document");
  });

  it("recognises code, sheets, slides and pictures", () => {
    expect(kindOf("ts")).toBe("code");
    expect(kindOf("xlsx")).toBe("sheet");
    expect(kindOf("pptx")).toBe("slides");
    expect(kindOf("png")).toBe("image");
  });

  it("copes with a leading dot and shouting", () => {
    expect(kindOf(".PY")).toBe("code");
    expect(kindOf("JSON")).toBe("code");
  });

  it("falls back rather than guessing", () => {
    expect(kindOf("zip")).toBe("other");
    expect(kindOf("")).toBe("other");
  });
});

describe("showing a file size", () => {
  it("uses bytes below a kilobyte", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
  });

  it("switches units as the file grows", () => {
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("does not print nonsense for a bad number", () => {
    expect(formatSize(-1)).toBe("0 B");
    expect(formatSize(Number.NaN)).toBe("0 B");
  });
});

describe("bucketing files by when they were written", () => {
  it("counts anything since midnight as today", () => {
    expect(groupFor(NOON, NOON)).toBe("today");
    expect(groupFor(startOfToday, NOON)).toBe("today");
  });

  it("uses calendar days, not elapsed hours", () => {
    // Written at eleven last night: that is yesterday, even at half past two.
    expect(groupFor(startOfToday - 60 * 60 * 1000, NOON)).toBe("yesterday");
  });

  it("keeps the rest of the week separate from older files", () => {
    expect(groupFor(startOfToday - 3 * DAY, NOON)).toBe("thisWeek");
    expect(groupFor(startOfToday - 30 * DAY, NOON)).toBe("earlier");
  });
});

describe("grouping a list for display", () => {
  const file = (name: string, modified: number) => ({
    name,
    path: `C:/out/${name}`,
    size: 10,
    modified,
    extension: "md",
  });

  it("returns groups in a fixed order, newest first", () => {
    const groups = groupFiles(
      [
        file("old.md", startOfToday - 40 * DAY),
        file("now.md", NOON),
        file("mid.md", startOfToday - 2 * DAY),
      ],
      NOON,
    );

    expect(groups.map((entry) => entry.group)).toEqual([
      "today",
      "thisWeek",
      "earlier",
    ]);
  });

  it("leaves out groups that have nothing in them", () => {
    const groups = groupFiles([file("now.md", NOON)], NOON);
    expect(groups).toHaveLength(1);
    expect(groups[0].files.map((entry) => entry.name)).toEqual(["now.md"]);
  });

  it("keeps every file exactly once", () => {
    const files = [
      file("a.md", NOON),
      file("b.md", startOfToday - 60_000),
      file("c.md", startOfToday - 3 * DAY),
      file("d.md", startOfToday - 90 * DAY),
    ];

    const total = groupFiles(files, NOON).reduce(
      (sum, entry) => sum + entry.files.length,
      0,
    );

    expect(total).toBe(files.length);
  });

  it("has a label for every group it can produce", () => {
    expect(FILE_GROUPS).toContain(groupFor(NOON, NOON));
    expect(FILE_GROUPS).toContain(groupFor(0, NOON));
  });
});

describe("filtering by name", () => {
  it("matches any part of the name, ignoring case", () => {
    expect(matchesQuery("Quarterly Report.docx", "report")).toBe(true);
    expect(matchesQuery("Quarterly Report.docx", "DOCX")).toBe(true);
  });

  it("shows everything when nothing was typed", () => {
    expect(matchesQuery("anything.txt", "")).toBe(true);
    expect(matchesQuery("anything.txt", "   ")).toBe(true);
  });

  it("excludes what does not match", () => {
    expect(matchesQuery("notes.md", "invoice")).toBe(false);
  });
});

describe("badging a search result without asking anyone", () => {
  it("names a site the way a person would", () => {
    expect(siteLabel("www.bbc.co.uk")).toBe("bbc");
    expect(siteLabel("oceantoday.noaa.gov")).toBe("noaa");
    expect(siteLabel("example.com")).toBe("example");
    expect(siteLabel("www.cdc.gov")).toBe("cdc");
  });

  it("copes with a hostname it cannot parse", () => {
    expect(siteLabel("")).toBe("?");
    expect(siteLabel("localhost")).toBe("localhost");
  });

  it("gives the same site the same colour every time", () => {
    expect(hueFor("bbc")).toBe(hueFor("bbc"));
    expect(hueFor("cdc")).not.toBe(hueFor("bbc"));
  });

  it("always produces a usable hue", () => {
    for (const name of ["a", "noaa", "verylongdomainnamehere", ""]) {
      const hue = hueFor(name);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});

describe("naming a chat after the message that started it", () => {
  const FALLBACK = "New discussion";

  it("uses a short message as it stands", () => {
    expect(titleFromContent("What is a mutex?", FALLBACK)).toBe("What is a mutex?");
  });

  it("shortens a long message at a word boundary", () => {
    const title = titleFromContent(
      "What is the difference between a mutex and a semaphore in concurrent programming?",
      FALLBACK,
    );

    const original =
      "What is the difference between a mutex and a semaphore in concurrent programming?";
    const kept = title.replace(/\.\.\.$/, "");

    expect(title.endsWith("...")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(TITLE_LENGTH + 3);
    expect(original.startsWith(kept)).toBe(true);
    // The cut lands between words, never through the middle of one.
    expect(original[kept.length]).toBe(" ");
  });

  it("collapses newlines so a pasted block stays one line", () => {
    expect(titleFromContent("First line\n\nSecond line", FALLBACK)).toBe(
      "First line Second line",
    );
  });

  it("falls back when there is nothing to name it after", () => {
    expect(titleFromContent("", FALLBACK)).toBe(FALLBACK);
    expect(titleFromContent("   \n  ", FALLBACK)).toBe(FALLBACK);
  });

  it("still shortens a single very long word", () => {
    const title = titleFromContent("x".repeat(120), FALLBACK);
    expect(title.length).toBeLessThanOrEqual(TITLE_LENGTH + 3);
  });

  it("is the same every time, with no model involved", () => {
    const question = "Explain how transformers handle attention";
    expect(titleFromContent(question, FALLBACK)).toBe(
      titleFromContent(question, FALLBACK),
    );
  });
});
