const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pathToFileURL } = require("url");

const DOCUMENT_TEXT_LIMIT = 200000;
const SLIDE_BODY_LINES = 12;

/**
 * How many pages of a PDF are read. A thousand-page scan produces almost no
 * text and would otherwise be read to the end to discover that.
 */
const MAX_PDF_PAGES = 500;

const EXECUTABLE_EXTENSIONS = new Set([
  ".exe", ".msi", ".msix", ".appx", ".com", ".scr", ".pif", ".cpl", ".dll",
  ".bat", ".cmd", ".ps1", ".psm1", ".psd1", ".vbs", ".vbe", ".js", ".jse",
  ".wsf", ".wsh", ".hta", ".lnk", ".url", ".scf", ".reg", ".inf", ".jar",
  ".app", ".dmg", ".pkg", ".command", ".desktop", ".run", ".appimage",
  ".gadget", ".msc", ".sh", ".bash", ".zsh",
]);

function isExecutableName(filename) {
  return EXECUTABLE_EXTENSIONS.has(path.extname(String(filename)).toLowerCase());
}

function parseInlineFormatting(docx, text) {
  const runs = [];
  const regex = /(\*\*\*([^*]+)\*\*\*)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
  let currentPos = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > currentPos) {
      runs.push(new docx.TextRun(text.substring(currentPos, match.index)));
    }
    if (match[1]) runs.push(new docx.TextRun({ text: match[2], bold: true, italics: true }));
    else if (match[3]) runs.push(new docx.TextRun({ text: match[4], bold: true }));
    else if (match[5]) runs.push(new docx.TextRun({ text: match[6], italics: true }));
    currentPos = regex.lastIndex;
  }

  if (currentPos < text.length) runs.push(new docx.TextRun(text.substring(currentPos)));
  if (runs.length === 0) runs.push(new docx.TextRun(text));
  return runs;
}

function writeDocx(filepath, content) {
  const docx = require("docx");

  const headingLevels = [
    docx.HeadingLevel.HEADING_1,
    docx.HeadingLevel.HEADING_2,
    docx.HeadingLevel.HEADING_3,
    docx.HeadingLevel.HEADING_4,
    docx.HeadingLevel.HEADING_5,
    docx.HeadingLevel.HEADING_6,
  ];

  const children = content.split("\n").map((rawLine) => {
    const line = rawLine.trim();

    if (line === "") {
      return new docx.Paragraph({ children: [new docx.TextRun("")] });
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      return new docx.Paragraph({
        heading: headingLevels[headingMatch[1].length - 1],
        children: parseInlineFormatting(docx, headingMatch[2]),
      });
    }

    if (line === "---" || line === "***") {
      return new docx.Paragraph({ thematicBreak: true });
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      return new docx.Paragraph({
        numbering: { reference: "numList", level: 0 },
        children: parseInlineFormatting(docx, orderedMatch[1]),
      });
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      return new docx.Paragraph({
        bullet: { level: 0 },
        children: parseInlineFormatting(docx, bulletMatch[1]),
      });
    }

    return new docx.Paragraph({ children: parseInlineFormatting(docx, line) });
  });

  const doc = new docx.Document({
    numbering: {
      config: [
        {
          reference: "numList",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: docx.AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ properties: {}, children }],
  });

  return docx.Packer.toBase64String(doc).then((b64) => {
    fs.writeFileSync(filepath, Buffer.from(b64, "base64"));
  });
}

function splitIntoSlides(content) {
  const slides = [];
  let current = null;

  const startSlide = (title) => {
    current = { title, body: [] };
    slides.push(current);
  };

  for (const block of content.split(/^\s*(?:---|\*\*\*)\s*$/m)) {
    current = null;
    for (const rawLine of block.split("\n")) {
      const line = rawLine.trim();
      if (line === "") continue;

      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        startSlide(headingMatch[2]);
        continue;
      }

      if (!current) startSlide("");
      if (current.body.length >= SLIDE_BODY_LINES) {
        startSlide(current.title ? current.title + " (cont.)" : "");
      }
      current.body.push(line.replace(/^[-*]\s+/, "• "));
    }
  }

  return slides.filter((slide) => slide.title || slide.body.length > 0);
}

async function writePptx(filepath, content) {
  const PptxGen = require("pptxgenjs");
  const pres = new PptxGen();
  const slides = splitIntoSlides(content);

  if (slides.length === 0) slides.push({ title: "", body: [content.trim()] });

  for (const slide of slides) {
    const target = pres.addSlide();
    if (slide.title) {
      target.addText(slide.title, {
        x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 28, bold: true, valign: "top",
      });
    }
    if (slide.body.length > 0) {
      target.addText(slide.body.join("\n"), {
        x: 0.5,
        y: slide.title ? 1.4 : 0.5,
        w: 9,
        h: slide.title ? 3.7 : 4.6,
        fontSize: 16,
        valign: "top",
      });
    }
  }

  await pres.writeFile({ fileName: filepath });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }

  row.push(field);
  rows.push(row);
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

const NUMERIC_CELL_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;

async function writeXlsx(filepath, content) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");

  for (const cells of parseCsv(content)) {
    sheet.addRow(
      cells.map((cell) => {
        const value = cell.trim();
        return NUMERIC_CELL_RE.test(value) ? Number(value) : cell;
      }),
    );
  }

  await workbook.xlsx.writeFile(filepath);
}

function findZipEntries(buffer) {
  let eocd = -1;
  const lowest = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= lowest; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid Office file");

  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let i = 0; i < total; i++) {
    if (offset + 46 > buffer.length) break;
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer, entry) {
  const header = entry.localOffset;
  if (buffer.readUInt32LE(header) !== 0x04034b50) {
    throw new Error("Corrupt archive entry");
  }

  const nameLength = buffer.readUInt16LE(header + 26);
  const extraLength = buffer.readUInt16LE(header + 28);
  const start = header + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);

  return entry.method === 0 ? raw : zlib.inflateRawSync(raw);
}

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (whole, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function xmlToText(xml, textTag, breakTag) {
  const pattern = new RegExp(
    "<" + textTag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + textTag + ">|" + breakTag,
    "g",
  );

  let text = "";
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    text += match[1] === undefined ? "\n" : decodeXmlEntities(match[1]);
  }
  return text;
}

function slideNumber(name) {
  const match = name.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

function readDocx(buffer) {
  const entries = findZipEntries(buffer);
  const body = entries.get("word/document.xml");
  if (!body) throw new Error("No document body found");

  const xml = readZipEntry(buffer, body).toString("utf8");
  return xmlToText(xml, "w:t", "</w:p>");
}

function readPptx(buffer) {
  const entries = findZipEntries(buffer);
  const slides = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  if (slides.length === 0) throw new Error("No slides found");

  return slides
    .map((name, index) => {
      const xml = readZipEntry(buffer, entries.get(name)).toString("utf8");
      return "--- Slide " + (index + 1) + " ---\n" + xmlToText(xml, "a:t", "</a:p>").trim();
    })
    .join("\n\n");
}

function cellToText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if (value.result !== undefined) return String(value.result);
    if (value.text !== undefined) return String(value.text);
    return "";
  }

  return String(value);
}

function csvCell(value) {
  return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

async function readXlsx(buffer) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const parts = [];
  workbook.eachSheet((sheet) => {
    parts.push("--- Sheet: " + sheet.name + " ---");
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(csvCell(cellToText(cell.value)));
      });
      parts.push(cells.join(","));
    });
  });

  return parts.join("\n");
}

/**
 * pdf.js, loaded on first use rather than at startup. Sixteen megabytes of
 * JavaScript, and most sessions never open a PDF at all.
 */
let pdfjsPromise = null;

/**
 * Where the package lives once packaged. Node cannot import ES modules from
 * inside asar, so it is left unpacked and the path redirected to match.
 */
function pdfjsDir() {
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  return root.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

function loadPdfjs() {
  if (pdfjsPromise) return pdfjsPromise;

  pdfjsPromise = (async () => {
    const dir = pdfjsDir();
    const build = path.join(dir, "legacy", "build");

    // The legacy build is the one pdf.js asks for outside a browser; the
    // default build warns and relies on APIs Node does not have.
    const pdfjs = await import(pathToFileURL(path.join(build, "pdf.mjs")).href);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      path.join(build, "pdf.worker.mjs"),
    ).href;

    return { pdfjs, dir };
  })().catch((error) => {
    // A failed load must not be remembered as the answer, or one bad moment
    // disables PDFs for the rest of the run.
    pdfjsPromise = null;
    throw error;
  });

  return pdfjsPromise;
}

/**
 * The text of a page, in the order pdf.js reports it. Items carry their own
 * end-of-line flag, which beats inferring breaks from coordinates.
 */
function pageText(items) {
  let out = "";
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    out += item.str;
    if (item.hasEOL) out += "\n";
  }
  return out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Reads a PDF into text, one marked section per page. The markers match what
 * readPptx uses, so the library chunker treats them as headings.
 */
async function readPdf(buffer) {
  const { pdfjs, dir } = await loadPdfjs();

  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // A document that arrived from outside has no business running anything.
    isEvalSupported: false,
    // pdf.js warns about things that only matter when drawing a page. None of
    // it changes the text, and left on it logs a warning for every page.
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    // Both directories ship with the package. Without them a PDF that leans on
    // a standard font, or any CJK encoding, extracts as blanks.
    standardFontDataUrl: pathToFileURL(path.join(dir, "standard_fonts") + path.sep).href,
    cMapUrl: pathToFileURL(path.join(dir, "cmaps") + path.sep).href,
    cMapPacked: true,
  });

  let document;
  try {
    document = await task.promise;
  } catch (error) {
    if (error && error.name === "PasswordException") {
      throw new Error("This PDF is password protected, so its text cannot be read.", {
        cause: error,
      });
    }
    throw new Error(`This PDF could not be opened: ${error.message}`, { cause: error });
  }

  try {
    const pages = Math.min(document.numPages, MAX_PDF_PAGES);
    const sections = [];
    let length = 0;

    for (let number = 1; number <= pages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = pageText(content.items);
      page.cleanup();

      if (!text) continue;

      sections.push(`--- Page ${number} ---\n${text}`);
      length += text.length;
      if (length >= DOCUMENT_TEXT_LIMIT) break;
    }

    if (sections.length === 0) {
      throw new Error(
        "This PDF has no text to extract. It is most likely a scan or a set of images, and Draggy does not run OCR.",
      );
    }

    if (document.numPages > pages) {
      sections.push(`--- ${document.numPages - pages} further pages were not read ---`);
    }

    return sections.join("\n\n");
  } finally {
    // Frees the worker for this document whether or not the read succeeded.
    await task.destroy();
  }
}

async function extractText(filename, buffer) {
  const extension = path.extname(String(filename)).toLowerCase();

  if (extension === ".docx") return readDocx(buffer);
  if (extension === ".pptx") return readPptx(buffer);
  if (extension === ".xlsx") return readXlsx(buffer);
  if (extension === ".pdf") return readPdf(buffer);

  throw new Error("Unsupported document type");
}

async function writeGeneratedFile(filepath, content) {
  switch (path.extname(filepath).toLowerCase()) {
    case ".docx":
      return writeDocx(filepath, content);
    case ".pptx":
      return writePptx(filepath, content);
    case ".xlsx":
      return writeXlsx(filepath, content);
    default:
      return fs.writeFileSync(filepath, content, "utf8");
  }
}

module.exports = {
  DOCUMENT_TEXT_LIMIT,
  EXECUTABLE_EXTENSIONS,
  isExecutableName,
  writeDocx,
  writePptx,
  writeXlsx,
  writeGeneratedFile,
  splitIntoSlides,
  parseCsv,
  findZipEntries,
  readZipEntry,
  xmlToText,
  decodeXmlEntities,
  readDocx,
  readPptx,
  readXlsx,
  readPdf,
  pageText,
  MAX_PDF_PAGES,
  extractText,
};
