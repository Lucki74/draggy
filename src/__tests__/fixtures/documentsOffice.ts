// Calls electron/documents.cjs for the office fixtures and reduces generated files to structure.
// The Rust port reduces its own output the same way (core/crates/documents/tests/office_fixtures.rs),
// so a binary package is compared by what it says rather than by its bytes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// A date's text names its zone, so the reference runs in UTC, the zone the Rust port prints.
process.env.TZ = "UTC";

const require = createRequire(import.meta.url);

type ZipEntry = { method: number; compressedSize: number; localOffset: number };

interface DocumentsModule {
  DOCUMENT_TEXT_LIMIT: number;
  MAX_PDF_PAGES: number;
  EXECUTABLE_EXTENSIONS: Set<string>;
  isExecutableName: (name: string) => boolean;
  writeDocx: (filepath: string, content: string) => Promise<void>;
  writePptx: (filepath: string, content: string) => Promise<void>;
  writeXlsx: (filepath: string, content: string) => Promise<void>;
  writeGeneratedFile: (filepath: string, content: string) => Promise<void>;
  splitIntoSlides: (content: string) => { title: string; body: string[] }[];
  parseCsv: (text: string) => string[][];
  findZipEntries: (buffer: Buffer) => Map<string, ZipEntry>;
  readZipEntry: (buffer: Buffer, entry: ZipEntry) => Buffer;
  xmlToText: (xml: string, textTag: string, breakTag: string) => string;
  decodeXmlEntities: (value: string) => string;
  readDocx: (buffer: Buffer) => string;
  readPptx: (buffer: Buffer) => string;
  readXlsx: (buffer: Buffer) => Promise<string>;
  readPdf: (buffer: Buffer) => Promise<string>;
  pageText: (items: { str?: unknown; hasEOL?: boolean }[]) => string;
  extractText: (filename: string, buffer: Buffer) => Promise<string>;
}

export const documents = require("../../../electron/documents.cjs") as DocumentsModule;

export const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../shared/fixtures/documents");

const DOCX_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
  "word/styles.xml",
  "word/numbering.xml",
  "word/_rels/document.xml.rels",
];
const PPTX_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "ppt/presentation.xml",
  "ppt/_rels/presentation.xml.rels",
  "ppt/theme/theme1.xml",
  "ppt/slideMasters/slideMaster1.xml",
  "ppt/slideLayouts/slideLayout1.xml",
];
const XLSX_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/styles.xml",
  "xl/worksheets/sheet1.xml",
];
const HEADING_IDS = ["Title", "Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6"];

const EMU_PER_INCH = 914400;

/** Two decimals, as the fixtures store box sizes. */
const inches = (emu: number) => Math.round((emu / EMU_PER_INCH) * 100) / 100;

const decode = (value: string) => documents.decodeXmlEntities(value);

function openPackage(buffer: Buffer) {
  const entries = documents.findZipEntries(buffer);
  const read = (name: string): string | null => {
    const entry = entries.get(name);
    if (!entry) return null;
    // Writers differ on a space before "/>"; the reduction reads both spellings the same way.
    return documents.readZipEntry(buffer, entry).toString("utf8").replace(/<([A-Za-z:]+)([^<>]*?)\s+\/>/g, "<$1$2/>");
  };
  return { entries, read };
}

type RunProps = { font: string | null; size: number | null; bold: boolean; color: string | null };

function runProps(rPr: string): RunProps {
  const size = /<w:sz w:val="(\d+)"/.exec(rPr);
  return {
    font: /<w:rFonts\b[^>]*\bw:ascii="([^"]*)"/.exec(rPr)?.[1] ?? null,
    size: size ? Number(size[1]) : null,
    bold: /<w:b\/>/.test(rPr),
    color: /<w:color w:val="([^"]*)"/.exec(rPr)?.[1] ?? null,
  };
}

function spacingOf(pPr: string) {
  const tag = /<w:spacing\b([^>]*)\/?>/.exec(pPr)?.[1] ?? "";
  const attr = (name: string) => {
    const found = new RegExp(`\\bw:${name}="(\\d+)"`).exec(tag);
    return found ? Number(found[1]) : null;
  };
  return { before: attr("before"), after: attr("after"), line: attr("line") };
}

function styleOf(styles: string, id: string) {
  const found = new RegExp(`<w:style\\b[^>]*w:styleId="${id}"[^>]*>([\\s\\S]*?)</w:style>`).exec(styles);
  if (!found) return null;
  const inner = found[1];
  const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(inner)?.[1] ?? "";
  const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(inner)?.[1] ?? "";
  const spacing = spacingOf(pPr);
  return { ...runProps(rPr), before: spacing.before, after: spacing.after };
}

function bodyOf(styles: string) {
  const defaults = /<w:docDefaults>([\s\S]*?)<\/w:docDefaults>/.exec(styles)?.[1] ?? "";
  const rPr = /<w:rPrDefault>\s*<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(defaults)?.[1] ?? "";
  const pPr = /<w:pPrDefault>\s*<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(defaults)?.[1] ?? "";
  const docDefaults = runProps(rPr);
  const normalColor = styleOf(styles, "Normal")?.color ?? null;
  const spacing = spacingOf(pPr);
  return {
    font: docDefaults.font,
    size: docDefaults.size,
    color: normalColor ?? docDefaults.color,
    after: spacing.after,
    line: spacing.line,
  };
}

function listFormats(numbering: string): Map<string, string | null> {
  const abstractFormat = new Map<string, string>();
  for (const m of numbering.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    abstractFormat.set(m[1], /<w:lvl w:ilvl="0"[^>]*>[\s\S]*?<w:numFmt w:val="([^"]*)"\/>/.exec(m[2])?.[1] ?? "");
  }
  const formats = new Map<string, string | null>();
  for (const m of numbering.matchAll(/<w:num w:numId="(\d+)"[^>]*>\s*<w:abstractNumId w:val="(\d+)"\/>/g)) {
    formats.set(m[1], abstractFormat.get(m[2]) ?? null);
  }
  return formats;
}

function paragraphsOf(xml: string, formats: Map<string, string | null>) {
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((p) => {
    const inner = p[1];
    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(inner)?.[1] ?? "";
    const numId = /<w:numId w:val="(\d+)"\/>/.exec(pPr)?.[1];
    const runs = [...inner.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].map((r) => {
      const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r[1])?.[1] ?? "";
      const text = [...r[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => decode(t[1])).join("");
      return {
        text,
        bold: /<w:b\/>/.test(rPr),
        italic: /<w:i\/>/.test(rPr),
        font: /<w:rFonts\b[^>]*\bw:ascii="([^"]*)"/.exec(rPr)?.[1] ?? null,
      };
    });
    return {
      text: runs.map((run) => run.text).join(""),
      style: /<w:pStyle w:val="([^"]*)"\/>/.exec(pPr)?.[1] ?? null,
      list: numId === undefined ? null : (formats.get(numId) ?? null),
      border: pPr.includes("<w:pBdr>"),
      runs,
    };
  });
}

/** What a .docx says: which parts it has, its body defaults, the heading styles and every paragraph. */
export function reduceDocx(buffer: Buffer) {
  const { entries, read } = openPackage(buffer);
  const styles = read("word/styles.xml") ?? "";
  const formats = listFormats(read("word/numbering.xml") ?? "");
  const styleProps: Record<string, unknown> = {};
  for (const id of HEADING_IDS) styleProps[id] = styleOf(styles, id);
  return {
    parts: DOCX_PARTS.filter((name) => entries.has(name)),
    body: bodyOf(styles),
    styles: styleProps,
    paragraphs: paragraphsOf(read("word/document.xml") ?? "", formats),
  };
}

function slideNumber(name: string): number {
  return Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

function shapesOf(xml: string) {
  return [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map((s) => {
    const shape = s[1];
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(shape);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(shape);
    const run = /<a:rPr\b([^>]*?)>([\s\S]*?)<\/a:rPr>/.exec(shape);
    const attrs = run?.[1] ?? "";
    const size = /\bsz="(\d+)"/.exec(attrs);
    return {
      box: off && ext ? [inches(Number(off[1])), inches(Number(off[2])), inches(Number(ext[1])), inches(Number(ext[2]))] : null,
      anchor: /<a:bodyPr\b[^>]*\banchor="([^"]*)"/.exec(shape)?.[1] ?? null,
      size: size ? Number(size[1]) / 100 : null,
      bold: /\bb="1"/.test(attrs),
      font: /<a:latin typeface="([^"]*)"/.exec(run?.[2] ?? "")?.[1] ?? null,
      color: /<a:srgbClr val="([^"]*)"/.exec(run?.[2] ?? "")?.[1] ?? null,
      text: [...shape.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)].map((p) =>
        [...p[1].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((t) => decode(t[1])).join(""),
      ),
    };
  });
}

/** What a .pptx says: its fixed parts, then each slide's part and rels, with every text box's geometry and first run. */
export function reducePptx(buffer: Buffer) {
  const { entries, read } = openPackage(buffer);
  const slideNames = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const relNames = slideNames
    .map((name) => name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels")
    .filter((name) => entries.has(name));
  return {
    parts: [...PPTX_PARTS.filter((name) => entries.has(name)), ...slideNames, ...relNames],
    slides: slideNames.map((name) => ({ shapes: shapesOf(read(name) ?? "") })),
  };
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    [...si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join(""),
  );
}

/** Bold and font name for each cell style index, read from styles.xml. */
function cellFormats(xml: string | null): { bold: boolean; font: string | null }[] {
  if (!xml) return [];
  const fonts = [...(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(xml)?.[1] ?? "").matchAll(/<font>([\s\S]*?)<\/font>/g)].map(
    (f) => ({ bold: /<b\/>/.test(f[1]), font: /<name val="([^"]*)"/.exec(f[1])?.[1] ?? null }),
  );
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  return [...xfs.matchAll(/<xf\b([^>]*?)\/?>/g)].map((xf) => {
    const fontId = Number(/\bfontId="(\d+)"/.exec(xf[1])?.[1] ?? 0);
    return fonts[fontId] ?? { bold: false, font: null };
  });
}

function columnIndex(letters: string): number {
  return [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
}

function rowsOf(xml: string, strings: string[], formats: { bold: boolean; font: string | null }[]) {
  const rows: { v: string | number; bold: boolean; font: string | null }[][] = [];
  for (const row of xml.matchAll(/<row\b(?:[^>]*[^/>])?>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<number, { v: string | number; bold: boolean; font: string | null }>();
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const col = columnIndex(/\br="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? "A");
      const style = formats[Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0)] ?? { bold: false, font: null };
      const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
      const body = c[2] ?? "";
      const raw = /<v>([^<]*)<\/v>/.exec(body)?.[1];
      let v: string | number;
      if (type === "s") v = strings[Number(raw ?? 0)] ?? "";
      else if (type === "inlineStr") v = decode([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      else if (type === "str") v = decode(raw ?? "");
      else if (raw === undefined) v = "";
      else v = Number(raw);
      cells.set(col, { v, bold: style.bold, font: style.font });
    }
    const width = Math.max(0, ...cells.keys());
    rows.push(
      Array.from({ length: width }, (_, i) => cells.get(i + 1) ?? { v: "", bold: false, font: null }),
    );
  }
  return rows;
}

/** What a .xlsx says: its fixed parts, then each sheet's name and cells (value, bold and font name). */
export function reduceXlsx(buffer: Buffer) {
  const { entries, read } = openPackage(buffer);
  const names = [...(read("xl/workbook.xml") ?? "").matchAll(/<sheet\b[^>]*?\bname="([^"]*)"/g)].map((m) => decode(m[1]));
  const strings = sharedStrings(read("xl/sharedStrings.xml"));
  const formats = cellFormats(read("xl/styles.xml"));
  return {
    parts: XLSX_PARTS.filter((name) => entries.has(name)),
    sheets: names.map((name, index) => ({
      name,
      rows: rowsOf(read(`xl/worksheets/sheet${index + 1}.xml`) ?? "", strings, formats),
    })),
  };
}

/** Writes through the reference writer into a scratch folder, reads the file back and reduces it. */
async function generated(extension: string, content: string, write: (file: string, body: string) => Promise<void>, reduce: (buf: Buffer) => unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-office-fixture-"));
  try {
    const file = path.join(dir, `out.${extension}`);
    await write(file, content);
    return reduce(fs.readFileSync(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A sample named as the fixtures name it, such as "samples/report.docx", relative to the fixture folder. */
export function samplePath(name: string): string {
  return path.join(FIXTURE_DIR, name);
}

function readSample(name: string | null): Buffer {
  return name === null ? Buffer.alloc(0) : fs.readFileSync(samplePath(name));
}

/** What a written file says, by its extension: Office packages reduced to their structure, other files as text. */
const REDUCERS: Record<string, (buf: Buffer) => unknown> = { docx: reduceDocx, pptx: reducePptx, xlsx: reduceXlsx };

/** Writes content through the routing as the file name asks, then reduces what was written. */
async function writtenAs(name: string, content: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-office-fixture-"));
  try {
    const file = path.join(dir, name);
    await documents.writeGeneratedFile(file, content);
    const buffer = fs.readFileSync(file);
    const reduce = REDUCERS[path.extname(name).slice(1).toLowerCase()];
    return reduce ? reduce(buffer) : buffer.toString("utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes content as the file name asks, then reads the text back out of the written file. */
async function roundTrip(name: string, content: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-office-fixture-"));
  try {
    const file = path.join(dir, name);
    await documents.writeGeneratedFile(file, content);
    return await documents.extractText(name, fs.readFileSync(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A long text reduced to what the fixture pins: its section headings, its length in UTF-16 units and its ends. */
export function summarizeText(text: string) {
  return {
    headings: text.split("\n").filter((line) => line.startsWith("--- ") && line.endsWith(" ---")),
    length: text.length,
    head: text.slice(0, 30),
    tail: text.slice(-30),
  };
}

/** Runs a fixture function. Errors come back as { error } so an expected failure can be pinned too. */
export type Call = (args: unknown[]) => unknown;

const str = (value: unknown) => String(value);

export const CALLS: Record<string, Call> = {
  writeDocx: (args) => generated("docx", str(args[0]), documents.writeDocx, reduceDocx),
  writePptx: (args) => generated("pptx", str(args[0]), documents.writePptx, reducePptx),
  writeXlsx: (args) => generated("xlsx", str(args[0]), documents.writeXlsx, reduceXlsx),
  readDocx: (args) => documents.readDocx(readSample(str(args[0]))),
  readPptx: (args) => documents.readPptx(readSample(str(args[0]))),
  readXlsx: (args) => documents.readXlsx(readSample(str(args[0]))),
  readPdf: (args) => documents.readPdf(readSample(str(args[0]))),
  writeGeneratedFile: (args) => writtenAs(str(args[0]), str(args[1])),
  writeThenRead: (args) => roundTrip(str(args[0]), str(args[1])),
  readPdfSummary: async (args) => summarizeText(await documents.readPdf(readSample(str(args[0])))),
  extractText: (args) =>
    documents.extractText(str(args[0]), readSample(args[1] === null ? null : str(args[1]))),
  findZipEntries: (args) => {
    documents.findZipEntries(Buffer.from(str(args[0])));
    return "ok";
  },
  splitIntoSlides: (args) => documents.splitIntoSlides(str(args[0])),
  parseCsv: (args) => documents.parseCsv(str(args[0])),
  decodeXmlEntities: (args) => documents.decodeXmlEntities(str(args[0])),
  xmlToText: (args) => documents.xmlToText(str(args[0]), str(args[1]), str(args[2])),
  isExecutableName: (args) => documents.isExecutableName(str(args[0])),
  pageText: (args) => documents.pageText(args[0] as { str?: unknown; hasEOL?: boolean }[]),
  constants: () => ({
    DOCUMENT_TEXT_LIMIT: documents.DOCUMENT_TEXT_LIMIT,
    MAX_PDF_PAGES: documents.MAX_PDF_PAGES,
    EXECUTABLE_EXTENSIONS: [...documents.EXECUTABLE_EXTENSIONS].sort(),
  }),
};

/** Runs one case: the result, or { error } with the message when the reference throws. */
export async function runCase(fn: string, args: unknown[]): Promise<unknown> {
  const call = CALLS[fn];
  if (!call) throw new Error(`no function ${fn}`);
  try {
    return await call(args);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** JSON form of a result, as the fixtures store it: non-finite numbers by name, undefined dropped. */
export function toFixtureJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v)),
  );
}
