import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { readPdf, pageText, extractText } = require("./documents.cjs");

/**
 * A minimal but genuinely valid PDF, offsets and all. Hand-writing one means
 * hand-computing the xref table, which any edit to the text invalidates.
 */
function makePdf(pages, { corruptXref = false } = {}) {
  const objects = [];
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((lines, index) => {
    const pageNumber = 4 + index * 2;
    const contentNumber = pageNumber + 1;

    objects[pageNumber] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`;

    const body = [].concat(lines);
    const stream =
      "BT /F1 18 Tf 72 700 Td " +
      body.map((line) => `(${line}) Tj T*`).join(" ") +
      " ET";

    objects[contentNumber] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let index = 1; index < objects.length; index++) {
    offsets[index] = out.length;
    out += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefAt = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index++) {
    out += String(offsets[index]).padStart(10, "0") + " 00000 n \n";
  }
  out +=
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n` +
    `startxref\n${corruptXref ? xrefAt + 500 : xrefAt}\n%%EOF\n`;

  return Buffer.from(out, "latin1");
}

/** A PDF-shaped file with pages that carry no text at all, as a scan would. */
function makeImageOnlyPdf() {
  return makePdf([[]]);
}

describe("pageText", () => {
  it("joins the items of a line and breaks where pdf.js says to", () => {
    expect(
      pageText([
        { str: "Hello", hasEOL: false },
        { str: " world", hasEOL: true },
        { str: "second line", hasEOL: false },
      ]),
    ).toBe("Hello world\nsecond line");
  });

  it("collapses runs of spaces and blank lines", () => {
    expect(
      pageText([
        { str: "a     b", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "c", hasEOL: false },
      ]),
    ).toBe("a b\n\nc");
  });

  it("ignores items that carry no string", () => {
    expect(pageText([{ str: "kept" }, { width: 3 }, { str: null }])).toBe("kept");
  });

  it("returns nothing for a page with no items", () => {
    expect(pageText([])).toBe("");
  });
});

describe("readPdf", () => {
  it("reads the text of a single page", async () => {
    const text = await readPdf(makePdf([["Hello Draggy"]]));
    expect(text).toContain("Hello Draggy");
  }, 30_000);

  it("marks each page so a passage can say where it came from", async () => {
    const text = await readPdf(makePdf([["First page"], ["Second page"]]));

    expect(text).toContain("--- Page 1 ---");
    expect(text).toContain("--- Page 2 ---");
    expect(text.indexOf("First page")).toBeLessThan(text.indexOf("Second page"));
  });

  it("keeps the lines of a page in order", async () => {
    const text = await readPdf(makePdf([["alpha", "beta", "gamma"]]));
    expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("beta"));
    expect(text.indexOf("beta")).toBeLessThan(text.indexOf("gamma"));
  });

  it("says a text-free PDF is a scan rather than returning nothing", async () => {
    await expect(readPdf(makeImageOnlyPdf())).rejects.toThrow(/scan|no text/i);
  });

  it("reports a file that is not a PDF at all", async () => {
    await expect(readPdf(Buffer.from("this is not a pdf"))).rejects.toThrow(
      /could not be opened/i,
    );
  });

  it("recovers a readable PDF whose cross-reference table is wrong", async () => {
    // pdf.js rebuilds the table rather than refusing, which is what a reader
    // should do: the file opens fine in every other viewer.
    const text = await readPdf(makePdf([["Recovered text"]], { corruptXref: true }));
    expect(text).toContain("Recovered text");
  });
});

describe("extractText", () => {
  it("routes a .pdf to the PDF reader", async () => {
    const text = await extractText("report.pdf", makePdf([["Quarterly figures"]]));
    expect(text).toContain("Quarterly figures");
  });

  it("routes on the extension regardless of case", async () => {
    const text = await extractText("REPORT.PDF", makePdf([["Upper case name"]]));
    expect(text).toContain("Upper case name");
  });

  it("still refuses a format it does not read", async () => {
    await expect(extractText("photo.heic", Buffer.from("x"))).rejects.toThrow(
      /Unsupported document type/,
    );
  });
});
