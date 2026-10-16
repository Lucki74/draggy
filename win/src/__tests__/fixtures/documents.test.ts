// Golden fixtures for the HTML and Markdown document logic. Each case calls the Electron reference
// (electron/markdownHtml.cjs, htmlDocument.cjs, officeStyle.cjs) with the case's args and checks the result.
// core/crates/documents/tests/fixtures.rs runs the same inputs against the Rust port, so both must agree.
// NaN is written as the string "NaN" in expected output, as shared/fixtures/README.md asks.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../shared/fixtures/documents");

const markdownHtml = require("../../../electron/markdownHtml.cjs") as {
  escapeHtml: (value: unknown) => string;
  inlineHtml: (text: string) => string;
  markdownToHtml: (markdown: unknown) => string;
  buildDocument: (content: unknown, title: unknown) => string;
};
const htmlDocument = require("../../../electron/htmlDocument.cjs") as {
  isHtml: (content: unknown) => boolean;
  parseHtml: (html: string) => unknown;
  parseColor: (value: unknown) => string | null;
  parseStyle: (text: unknown) => Record<string, string>;
  parsePt: (value: unknown, defaultPt?: number) => number;
  parseWidth: (value: unknown) => unknown;
  decodeEntities: (text: unknown) => string;
  nodeText: (node: unknown) => string;
};
const officeStyle = require("../../../electron/officeStyle.cjs") as {
  BODY_FONT: string;
  HEADING_FONT: string;
  SHEET_FONT: string;
  MONO_FONT: string;
  HEADING_COLOR: string;
  DOCX_STYLES: unknown;
  DOCX_NUMBERING: unknown;
  tableBorders: (docx: unknown) => unknown;
  pt: (points: number) => number;
  twips: (points: number) => number;
};

type Case = { name: string; input: { fn: string; args: unknown[] }; expected: unknown };

/** The functions a case can name. `nodeText` takes HTML, as the Rust runner does. */
const CALLS: Record<string, (...args: never[]) => unknown> = {
  escapeHtml: markdownHtml.escapeHtml,
  inlineHtml: markdownHtml.inlineHtml,
  markdownToHtml: markdownHtml.markdownToHtml,
  buildDocument: markdownHtml.buildDocument,
  isHtml: htmlDocument.isHtml,
  parseColor: htmlDocument.parseColor,
  parseStyle: htmlDocument.parseStyle,
  parsePt: htmlDocument.parsePt,
  parseWidth: htmlDocument.parseWidth,
  decodeEntities: htmlDocument.decodeEntities,
  parseHtml: htmlDocument.parseHtml,
  nodeText: (html: string) => htmlDocument.nodeText(htmlDocument.parseHtml(html)),
  pt: officeStyle.pt,
  twips: officeStyle.twips,
  constants: () => ({
    BODY_FONT: officeStyle.BODY_FONT,
    HEADING_FONT: officeStyle.HEADING_FONT,
    SHEET_FONT: officeStyle.SHEET_FONT,
    MONO_FONT: officeStyle.MONO_FONT,
    HEADING_COLOR: officeStyle.HEADING_COLOR,
  }),
  DOCX_STYLES: () => officeStyle.DOCX_STYLES,
  DOCX_NUMBERING: () => officeStyle.DOCX_NUMBERING,
  tableBorders: () => officeStyle.tableBorders({ BorderStyle: { SINGLE: "single" } }),
};

/** JSON form of a result: NaN and the infinities become their names, as the fixtures store them. */
function toFixtureJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v)),
  );
}

// The office files have their own runner (documents-office.test.ts) and their own function names.
const files = fs
  .readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith(".json") && !name.startsWith("documents-office-"))
  .sort();

describe("documents fixtures", () => {
  for (const file of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as {
      area: string;
      cases: Case[];
    };
    describe(file, () => {
      for (const c of doc.cases) {
        it(c.name, () => {
          const call = CALLS[c.input.fn];
          if (!call) throw new Error(`no function ${c.input.fn}`);
          // Only the args a case gives are passed, so parsePt keeps its default of 11 when none is given.
          const result = (call as (...args: unknown[]) => unknown)(...c.input.args);
          expect(toFixtureJson(result)).toEqual(c.expected);
        });
      }
    });
  }
});
