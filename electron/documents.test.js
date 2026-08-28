import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

const require = createRequire(import.meta.url);
const documents = require("./documents.cjs");

let workdir;

beforeAll(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-doc-test-"));
});

afterAll(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

const out = (name) => path.join(workdir, name);

describe("refusing executable file names", () => {
  const refused = [
    "payload.exe", "run.bat", "run.CMD", "script.ps1", "installer.msi",
    "thing.vbs", "page.hta", "shortcut.lnk", "app.jar", "setup.dmg",
    "tool.sh", "x.command", "y.desktop", "z.AppImage", "w.reg", "a.scr",
  ];

  for (const name of refused) {
    it(`refuses ${name}`, () => expect(documents.isExecutableName(name)).toBe(true));
  }

  const allowed = [
    "report.docx", "deck.pptx", "data.xlsx", "notes.md", "readme.txt",
    "script.py", "main.rs", "index.html", "styles.css", "data.json",
    "query.sql", "config.yaml", "Makefile",
  ];

  for (const name of allowed) {
    it(`allows ${name}`, () => expect(documents.isExecutableName(name)).toBe(false));
  }

  it("is not fooled by uppercase or mixed case", () => {
    expect(documents.isExecutableName("PAYLOAD.EXE")).toBe(true);
    expect(documents.isExecutableName("Run.BaT")).toBe(true);
  });

  it("catches a double extension ending in an executable one", () => {
    expect(documents.isExecutableName("invoice.pdf.exe")).toBe(true);
  });

  it("does not refuse a name that merely contains exe", () => {
    expect(documents.isExecutableName("executive-summary.docx")).toBe(false);
  });
});

describe("Word output", () => {
  const markdown = [
    "# Title",
    "",
    "Some **bold** and *italic* and ***both*** text.",
    "",
    "## Section",
    "",
    "- first bullet",
    "- second bullet",
    "",
    "1. first step",
    "2. second step",
    "",
    "---",
    "",
    "Closing line.",
  ].join("\n");

  let buffer;

  beforeAll(async () => {
    await documents.writeDocx(out("test.docx"), markdown);
    buffer = fs.readFileSync(out("test.docx"));
  });

  it("writes a real Office package", () => {
    const entries = documents.findZipEntries(buffer);
    expect(entries.has("word/document.xml")).toBe(true);
  });

  it("round-trips its own text back out", () => {
    const text = documents.readDocx(buffer);

    expect(text).toContain("Title");
    expect(text).toContain("first bullet");
    expect(text).toContain("Closing line.");
  });

  it("does not leak the markdown syntax into the document text", () => {
    const text = documents.readDocx(buffer);

    expect(text).not.toContain("**bold**");
    expect(text).not.toContain("# Title");
    expect(text).toContain("bold");
  });

  it("uses real numbering rather than literal digits", () => {
    const entries = documents.findZipEntries(buffer);
    const xml = documents
      .readZipEntry(buffer, entries.get("word/document.xml"))
      .toString("utf8");

    expect(xml).toContain("<w:numPr>");
    expect(documents.readDocx(buffer)).not.toContain("1. first step");
  });

  it("maps heading levels onto Word heading styles", () => {
    const entries = documents.findZipEntries(buffer);
    const xml = documents
      .readZipEntry(buffer, entries.get("word/document.xml"))
      .toString("utf8");

    expect(xml).toContain("Heading1");
    expect(xml).toContain("Heading2");
  });

  it("survives an empty body", async () => {
    await documents.writeDocx(out("empty.docx"), "");
    expect(fs.statSync(out("empty.docx")).size).toBeGreaterThan(0);
  });
});

describe("PowerPoint output", () => {
  it("starts a new slide at every heading", () => {
    const slides = documents.splitIntoSlides("# One\nbody a\n\n# Two\nbody b");

    expect(slides).toHaveLength(2);
    expect(slides[0].title).toBe("One");
    expect(slides[1].title).toBe("Two");
  });

  it("splits on a horizontal rule as well", () => {
    const slides = documents.splitIntoSlides("first slide\n\n---\n\nsecond slide");
    expect(slides).toHaveLength(2);
  });

  it("overflows a long slide onto a continuation slide", () => {
    const body = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const slides = documents.splitIntoSlides(`# Long\n${body}`);

    expect(slides.length).toBeGreaterThan(1);
    expect(slides[1].title).toContain("(cont.)");
    expect(slides[0].body.length).toBeLessThanOrEqual(12);
  });

  it("converts markdown bullets into real bullet characters", () => {
    const [slide] = documents.splitIntoSlides("# T\n- alpha\n* beta");

    expect(slide.body[0]).toBe("• alpha");
    expect(slide.body[1]).toBe("• beta");
  });

  it("drops nothing but blank slides", () => {
    expect(documents.splitIntoSlides("\n\n   \n")).toHaveLength(0);
  });

  it("writes and reads back a deck", async () => {
    await documents.writePptx(out("test.pptx"), "# Alpha\npoint one\n\n# Beta\npoint two");
    const text = documents.readPptx(fs.readFileSync(out("test.pptx")));

    expect(text).toContain("Alpha");
    expect(text).toContain("point two");
    expect(text).toContain("--- Slide 1 ---");
  });
});

describe("CSV parsing for Excel output", () => {
  it("splits plain rows", () => {
    expect(documents.parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("respects quoted fields containing commas", () => {
    expect(documents.parseCsv('"Smith, John",42')).toEqual([["Smith, John", "42"]]);
  });

  it("handles escaped quotes", () => {
    expect(documents.parseCsv('"He said ""hi""",1')).toEqual([['He said "hi"', "1"]]);
  });

  it("handles a newline inside a quoted field", () => {
    expect(documents.parseCsv('"line one\nline two",x')).toEqual([
      ["line one\nline two", "x"],
    ]);
  });

  it("strips carriage returns", () => {
    expect(documents.parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops fully blank rows", () => {
    expect(documents.parseCsv("a,b\n\n,\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("writes numbers as numbers and text as text", async () => {
    await documents.writeXlsx(out("test.xlsx"), "name,score\nAda,99\nGrace,-3.5");
    const text = await documents.readXlsx(fs.readFileSync(out("test.xlsx")));

    expect(text).toContain("Ada,99");
    expect(text).toContain("Grace,-3.5");
  });
});

describe("XML entity decoding", () => {
  it("decodes the entities Office actually emits", () => {
    expect(documents.decodeXmlEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;")).toBe(
      "a & b <c> \"d\" 'e'",
    );
  });

  it("decodes numeric entities", () => {
    expect(documents.decodeXmlEntities("caf&#233;")).toBe("café");
  });

  it("decodes an escaped ampersand last so &amp;lt; stays literal", () => {
    expect(documents.decodeXmlEntities("&amp;lt;")).toBe("&lt;");
  });
});

describe("routing by extension", () => {
  it("rejects an unsupported document type", async () => {
    await expect(documents.extractText("a.pdf", Buffer.alloc(0))).rejects.toThrow(
      /Unsupported/,
    );
  });

  it("rejects a file that is not a zip at all", () => {
    expect(() => documents.findZipEntries(Buffer.from("not a zip"))).toThrow(
      /valid Office file/,
    );
  });

  it("writes plain text for any other extension", async () => {
    await documents.writeGeneratedFile(out("notes.md"), "# hello");
    expect(fs.readFileSync(out("notes.md"), "utf8")).toBe("# hello");
  });
});
