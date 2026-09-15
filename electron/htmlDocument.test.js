import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

const require = createRequire(import.meta.url);
const htmlDoc = require("./htmlDocument.cjs");
const documents = require("./documents.cjs");

let workdir;

beforeAll(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-html-test-"));
});

afterAll(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

const out = (name) => path.join(workdir, name);

describe("HTML detection and style parsing", () => {
  it("detects HTML strings vs markdown and plain text", () => {
    expect(htmlDoc.isHtml("<h1>Title</h1>")).toBe(true);
    expect(htmlDoc.isHtml("<p>Paragraph</p>")).toBe(true);
    expect(htmlDoc.isHtml("<table><tr><td>Cell</td></tr></table>")).toBe(true);
    expect(htmlDoc.isHtml("<!DOCTYPE html><html><body>Hello</body></html>")).toBe(true);
    expect(htmlDoc.isHtml("# Markdown heading")).toBe(false);
    expect(htmlDoc.isHtml("name,score\nAda,99")).toBe(false);
    expect(htmlDoc.isHtml("Just some plain text")).toBe(false);
  });

  it("parses colors across formats", () => {
    expect(htmlDoc.parseColor("red")).toBe("FF0000");
    expect(htmlDoc.parseColor("#00ff00")).toBe("00FF00");
    expect(htmlDoc.parseColor("#abc")).toBe("AABBCC");
    expect(htmlDoc.parseColor("rgb(0, 0, 255)")).toBe("0000FF");
    expect(htmlDoc.parseColor("invalid")).toBeNull();
  });

  it("parses font sizes into points", () => {
    expect(htmlDoc.parsePt("14pt")).toBe(14);
    expect(htmlDoc.parsePt("16px")).toBe(12);
    expect(htmlDoc.parsePt("")).toBe(11);
  });
});

describe("Word output from HTML", () => {
  it("writes docx from HTML with styled headings, paragraphs and tables", async () => {
    const html = `
      <h1 style="color: #FF0000;">Styled Document</h1>
      <p>A paragraph with <strong style="color: #008000;">green bold</strong> and <em>italic</em>.</p>
      <ul>
        <li>First item</li>
        <li>Second item</li>
      </ul>
      <table style="width: 100%;">
        <tr>
          <th style="background-color: #336699; color: #FFFFFF; width: 120px;">Column 1</th>
          <th style="width: 80px;">Column 2</th>
        </tr>
        <tr>
          <td>Value 1</td>
          <td>Value 2</td>
        </tr>
      </table>
    `;

    const docxPath = out("styled.docx");
    await htmlDoc.writeDocxFromHtml(docxPath, html);
    const buffer = fs.readFileSync(docxPath);

    expect(fs.statSync(docxPath).size).toBeGreaterThan(0);
    const text = documents.readDocx(buffer);
    expect(text).toContain("Styled Document");
    expect(text).toContain("green bold");
    expect(text).toContain("Column 1");
    expect(text).toContain("Value 1");

    const entries = documents.findZipEntries(buffer);
    const xml = documents.readZipEntry(buffer, entries.get("word/document.xml")).toString("utf8");
    expect(xml).toContain('w:color w:val="FF0000"');
    expect(xml).toContain('w:color w:val="008000"');
    expect(xml).toContain("w:tbl");
  });
});

describe("Excel output from HTML", () => {
  it("writes xlsx from HTML table with column widths and styled cells", async () => {
    const html = `
      <table>
        <tr>
          <th style="width: 150px; background-color: #4f46e5; color: #ffffff;">Name</th>
          <th style="width: 100px; background-color: #4f46e5; color: #ffffff;">Score</th>
        </tr>
        <tr>
          <td>Ada Lovelace</td>
          <td>98.5</td>
        </tr>
        <tr>
          <td>Grace Hopper</td>
          <td>100</td>
        </tr>
      </table>
    `;

    const xlsxPath = out("styled.xlsx");
    await htmlDoc.writeXlsxFromHtml(xlsxPath, html);
    const buffer = fs.readFileSync(xlsxPath);

    expect(fs.statSync(xlsxPath).size).toBeGreaterThan(0);
    const text = await documents.readXlsx(buffer);
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("98.5");
    expect(text).toContain("Grace Hopper");
  }, 15000);
});

describe("PowerPoint output from HTML", () => {
  it("writes pptx from HTML sections with titles and body runs", async () => {
    const html = `
      <section style="background-color: #f0f0f0;">
        <h2 style="color: #000080;">Introduction Slide</h2>
        <p>Key takeaway for the audience</p>
        <ul>
          <li>First bullet point</li>
          <li>Second bullet point</li>
        </ul>
      </section>
      <section>
        <h2>Data Slide</h2>
        <p>Summary of results</p>
      </section>
    `;

    const pptxPath = out("styled.pptx");
    await htmlDoc.writePptxFromHtml(pptxPath, html);
    const buffer = fs.readFileSync(pptxPath);

    expect(fs.statSync(pptxPath).size).toBeGreaterThan(0);
    const text = documents.readPptx(buffer);
    expect(text).toContain("Introduction Slide");
    expect(text).toContain("First bullet point");
    expect(text).toContain("Data Slide");
  });
});
