const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { BrowserWindow } = require("electron");
const { log } = require("./logger.cjs");
const { buildDocument } = require("./markdownHtml.cjs");

/**
 * Writes a PDF by laying it out in Chromium, which already paginates and finds
 * fonts. The window is sandboxed with no Node, no JavaScript and no network.
 */

/** How long Chromium is given to lay out and print one document. */
const PRINT_TIMEOUT_MS = 30000;

function withTimeout(promise, milliseconds, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The page number at the foot of every page. Chromium renders this in its own
 * context, so the styling is inline and the classes are the ones it knows.
 */
const FOOTER_TEMPLATE = `
  <div style="width:100%; font-family:sans-serif; font-size:8px; color:#888; text-align:center; margin:0 12mm;">
    <span class="pageNumber"></span> / <span class="totalPages"></span>
  </div>
`;

async function writePdf(filepath, markdown) {
  const title = path.basename(filepath, path.extname(filepath));
  const html = buildDocument(markdown, title);

  // A file rather than a data: URL: Chromium refuses top-level navigation to
  // those, and a long document would not fit in one anyway.
  const scratch = path.join(
    os.tmpdir(),
    `draggy-pdf-${crypto.randomBytes(6).toString("hex")}.html`,
  );
  fs.writeFileSync(scratch, html, "utf8");

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Nothing here needs to run. Switching it off means a document cannot
      // act, whatever it happens to contain.
      javascript: false,
      webgl: false,
      offscreen: false,
    },
  });

  try {
    await withTimeout(
      win.loadFile(scratch),
      PRINT_TIMEOUT_MS,
      "The document took too long to lay out.",
    );

    const pdf = await withTimeout(
      win.webContents.printToPDF({
        pageSize: "A4",
        printBackground: true,
        // Inches. Roomy enough at the foot for the page number.
        margins: { top: 0.7, bottom: 0.7, left: 0.65, right: 0.65 },
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate: FOOTER_TEMPLATE,
        generateTaggedPDF: true,
        generateDocumentOutline: true,
      }),
      PRINT_TIMEOUT_MS,
      "The document took too long to print.",
    );

    fs.writeFileSync(filepath, pdf);
    log.info("create-file", `printed ${path.basename(filepath)} (${pdf.length} bytes)`);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.unlink(scratch, () => {});
  }
}

module.exports = { writePdf, PRINT_TIMEOUT_MS };
