const fs = require("fs");
const officeStyle = require("./officeStyle.cjs");

/** Parses HTML strings and converts them into native Word (.docx), Excel (.xlsx),
 * and PowerPoint (.pptx) documents with colors, fonts, tables, and dimensions. */

const NUMERIC_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;

const NAMED_COLORS = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  purple: "800080",
  orange: "FFA500",
  gray: "808080",
  grey: "808080",
  silver: "C0C0C0",
  navy: "000080",
  teal: "008080",
  aqua: "00FFFF",
  fuchsia: "FF00FF",
  maroon: "800000",
  olive: "808000",
  lime: "00FF00",
};

/** Normalises any CSS color representation into a 6-character hex string. */
function parseColor(value) {
  if (!value || typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (NAMED_COLORS[raw]) return NAMED_COLORS[raw];

  const hexMatch = raw.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return hex.split("").map((c) => c + c).join("").toUpperCase();
    }
    return hex.toUpperCase();
  }

  const rgbMatch = raw.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const r = Math.min(255, parseInt(rgbMatch[1], 10)).toString(16).padStart(2, "0");
    const g = Math.min(255, parseInt(rgbMatch[2], 10)).toString(16).padStart(2, "0");
    const b = Math.min(255, parseInt(rgbMatch[3], 10)).toString(16).padStart(2, "0");
    return `${r}${g}${b}`.toUpperCase();
  }

  return null;
}

/** Parses CSS declarations from an inline style string into an object. */
function parseStyle(styleText) {
  const styles = {};
  if (!styleText || typeof styleText !== "string") return styles;
  for (const part of styleText.split(";")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const val = part.slice(idx + 1).trim();
    if (key && val) styles[key] = val;
  }
  return styles;
}

/** Converts pt, px, or em CSS measurements into numeric points. */
function parsePt(value, defaultPt = 11) {
  if (!value) return defaultPt;
  const match = String(value).trim().match(/^([\d.]+)\s*(pt|px|em|rem)?$/i);
  if (!match) return defaultPt;
  const num = parseFloat(match[1]);
  const unit = (match[2] || "pt").toLowerCase();
  if (unit === "px") return Math.round(num * 0.75);
  if (unit === "em" || unit === "rem") return Math.round(num * defaultPt);
  return Math.round(num);
}

/** Converts width attributes or styles into numeric pixel/character widths. */
function parseWidth(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^([\d.]+)\s*(px|pt|%)?$/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = match[2] || "px";
  if (unit === "%") return { type: "percent", value: num };
  return { type: "px", value: num };
}

/** Unescapes HTML entities in text content. */
function decodeEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Lightweight pure-JavaScript HTML parser building an AST without DOM dependencies. */
function parseHtml(html) {
  const root = { type: "root", children: [] };
  const stack = [root];
  const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9:-]+)((?:\s+[^'">\s/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/)?>|([^<]+)/g;

  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const [full, isClose, rawTag, rawAttrs, isSelfClose, textContent] = match;
    if (full.startsWith("<!--")) continue;

    if (textContent) {
      const text = decodeEntities(textContent);
      if (text) {
        stack[stack.length - 1].children.push({ type: "text", text });
      }
      continue;
    }

    const tag = (rawTag || "").toLowerCase();
    if (!tag) continue;

    if (isClose) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const attrs = {};
    if (rawAttrs) {
      const attrRegex = /([a-zA-Z0-9:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let am;
      while ((am = attrRegex.exec(rawAttrs)) !== null) {
        attrs[am[1].toLowerCase()] = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : "";
      }
    }

    const elem = {
      type: "element",
      tag,
      attrs,
      style: parseStyle(attrs.style),
      children: [],
    };

    stack[stack.length - 1].children.push(elem);

    if (!isSelfClose && !VOID_TAGS.has(tag)) {
      stack.push(elem);
    }
  }

  return root;
}

/** Extracts all plain text recursively from a node. */
function nodeText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  return (node.children || []).map(nodeText).join("");
}

/** The first real name out of a CSS font stack, without its quotes. */
function firstFont(value) {
  return String(value || "").split(",")[0].replace(/['"]/g, "").trim();
}

/** Tags that carry their own block of the document. A wrapper holding any of them is scaffolding
 * rather than a paragraph, and flattening it is how a whole document became one line. */
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "div", "dl", "figure", "footer",
  "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav",
  "ol", "p", "pre", "section", "table", "ul",
]);

function hasBlockChild(node) {
  return (node.children || []).some(
    (child) => child.type === "element" && BLOCK_TAGS.has(child.tag),
  );
}

/** Checks whether a content string appears to contain HTML markup. */
function isHtml(content) {
  if (typeof content !== "string") return false;
  const trimmed = content.trim();
  return (
    /^\s*<!doctype\s+html/i.test(trimmed) ||
    /<\s*(?:html|body|div|p|h[1-6]|table|section|article|ul|ol|style|span|b|strong|em|i)\b[^>]*>/i.test(trimmed)
  );
}

// --- WORD (.docx) CONVERSION ---

/** Collects formatted docx TextRun instances recursively from inline HTML elements. */
function collectDocxRuns(docx, node, parentStyle = {}) {
  const runs = [];

  const walk = (item, inherited) => {
    if (item.type === "text") {
      const text = item.text || "";
      if (!text) return;
      const runOpts = { text };
      if (inherited.bold) runOpts.bold = true;
      if (inherited.italics) runOpts.italics = true;
      if (inherited.underline) runOpts.underline = { type: docx.UnderlineType.SINGLE };
      if (inherited.strike) runOpts.strike = true;
      if (inherited.color) runOpts.color = inherited.color;
      if (inherited.size) runOpts.size = inherited.size * 2;
      if (inherited.font) runOpts.font = inherited.font;
      runs.push(new docx.TextRun(runOpts));
      return;
    }

    if (item.type !== "element") return;

    if (item.tag === "br") {
      runs.push(new docx.TextRun({ text: "", break: 1 }));
      return;
    }

    const currentStyle = { ...inherited };
    if (item.tag === "strong" || item.tag === "b") currentStyle.bold = true;
    if (item.tag === "em" || item.tag === "i") currentStyle.italics = true;
    if (item.tag === "u") currentStyle.underline = true;
    if (item.tag === "s" || item.tag === "del" || item.tag === "strike") currentStyle.strike = true;

    const style = item.style || {};
    if (style["font-weight"] === "bold" || parseInt(style["font-weight"], 10) >= 600) {
      currentStyle.bold = true;
    }
    if (style["font-style"] === "italic") currentStyle.italics = true;
    if (style["text-decoration"]?.includes("underline")) currentStyle.underline = true;
    if (style["text-decoration"]?.includes("line-through")) currentStyle.strike = true;

    const color = parseColor(style.color || item.attrs.color);
    if (color) currentStyle.color = color;

    // Only when the HTML actually asks for a size. Setting it unconditionally
    // stamped 11pt on every run, which overrode the heading styles and was why
    // a document came out as one flat wall of body text.
    if (style["font-size"]) currentStyle.size = parsePt(style["font-size"]);

    if (style["font-family"]) currentStyle.font = firstFont(style["font-family"]);

    for (const child of item.children || []) {
      walk(child, currentStyle);
    }
  };

  walk(node, parentStyle);
  return runs;
}

/** Converts an HTML table element into a docx Table instance. */
function convertHtmlTableToDocx(docx, tableNode) {
  const rows = [];
  const findRows = (n) => {
    if (!n || n.type !== "element") return [];
    if (n.tag === "tr") return [n];
    return (n.children || []).flatMap(findRows);
  };

  const trNodes = findRows(tableNode);
  for (const tr of trNodes) {
    const cells = [];
    const cellNodes = (tr.children || []).filter(
      (c) => c.type === "element" && (c.tag === "th" || c.tag === "td"),
    );

    for (const cell of cellNodes) {
      const isHeader = cell.tag === "th";
      const cellStyle = cell.style || {};
      const bgColor = parseColor(cellStyle["background-color"] || cellStyle.background || cell.attrs.bgcolor);

      const runs = collectDocxRuns(docx, cell, {
        bold: isHeader,
        size: parsePt(cellStyle["font-size"], isHeader ? 11 : 10),
      });

      const pOpts = { children: runs.length > 0 ? runs : [new docx.TextRun("")] };
      const align = cellStyle["text-align"] || cell.attrs.align;
      if (align === "center") pOpts.alignment = docx.AlignmentType.CENTER;
      if (align === "right") pOpts.alignment = docx.AlignmentType.END;

      const cellOpts = {
        children: [new docx.Paragraph(pOpts)],
      };

      if (bgColor) {
        cellOpts.shading = { fill: bgColor, type: docx.ShadingType.CLEAR };
      } else if (isHeader) {
        cellOpts.shading = { fill: "F2F2F4", type: docx.ShadingType.CLEAR };
      }

      const widthAttr = parseWidth(cellStyle.width || cell.attrs.width);
      if (widthAttr && widthAttr.type === "px") {
        cellOpts.width = { size: Math.round(widthAttr.value * 15), type: docx.WidthType.DXA };
      }

      cells.push(new docx.TableCell(cellOpts));
    }

    if (cells.length > 0) {
      rows.push(new docx.TableRow({ children: cells }));
    }
  }

  return new docx.Table({
    rows,
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    borders: officeStyle.tableBorders(docx),
  });
}

/** Converts an HTML document into a Word .docx file. */
async function writeDocxFromHtml(filepath, html) {
  const docx = require("docx");
  const root = parseHtml(html);

  const headingLevels = [
    docx.HeadingLevel.HEADING_1,
    docx.HeadingLevel.HEADING_2,
    docx.HeadingLevel.HEADING_3,
    docx.HeadingLevel.HEADING_4,
    docx.HeadingLevel.HEADING_5,
    docx.HeadingLevel.HEADING_6,
  ];

  const docChildren = [];

  const visitNode = (node) => {
    if (!node) return;
    if (node.type === "root") {
      for (const child of node.children || []) visitNode(child);
      return;
    }
    if (node.type !== "element") return;

    const headingMatch = node.tag.match(/^h([1-6])$/);
    if (headingMatch) {
      const level = parseInt(headingMatch[1], 10) - 1;
      const runs = collectDocxRuns(docx, node, { bold: true });
      docChildren.push(
        new docx.Paragraph({
          heading: headingLevels[level],
          children: runs.length > 0 ? runs : [new docx.TextRun("")],
        }),
      );
      return;
    }

    // A div wrapping other blocks is a container, not a paragraph. Treating it
    // as one collapsed every heading, list and table inside it into one run of
    // text, which is what a whole document arriving as a single line was.
    if (node.tag === "div" && hasBlockChild(node)) {
      for (const child of node.children || []) visitNode(child);
      return;
    }

    if (node.tag === "p" || node.tag === "div") {
      const style = node.style || {};
      const align = style["text-align"] || node.attrs.align;
      const pOpts = {};
      if (align === "center") pOpts.alignment = docx.AlignmentType.CENTER;
      if (align === "right") pOpts.alignment = docx.AlignmentType.END;
      if (align === "justify") pOpts.alignment = docx.AlignmentType.JUSTIFIED;

      const runs = collectDocxRuns(docx, node);
      pOpts.children = runs.length > 0 ? runs : [new docx.TextRun("")];
      docChildren.push(new docx.Paragraph(pOpts));
      return;
    }

    // Line breaks are the whole point of preformatted text, and a single
    // paragraph would throw them away.
    if (node.tag === "pre") {
      for (const line of nodeText(node).replace(/\n+$/, "").split("\n")) {
        docChildren.push(
          new docx.Paragraph({
            spacing: { after: 0, line: 240 },
            children: [
              new docx.TextRun({
                text: line,
                font: officeStyle.MONO_FONT,
                size: officeStyle.pt(9.5),
              }),
            ],
          }),
        );
      }
      return;
    }

    if (node.tag === "hr") {
      docChildren.push(new docx.Paragraph({ thematicBreak: true }));
      return;
    }

    if (node.tag === "blockquote") {
      const runs = collectDocxRuns(docx, node, { italics: true });
      docChildren.push(
        new docx.Paragraph({
          indent: { left: 720 },
          children: runs.length > 0 ? runs : [new docx.TextRun("")],
        }),
      );
      return;
    }

    if (node.tag === "ul" || node.tag === "ol") {
      const isOrdered = node.tag === "ol";
      for (const li of node.children || []) {
        if (li.type !== "element" || li.tag !== "li") continue;
        const runs = collectDocxRuns(docx, li);
        const pOpts = {
          children: runs.length > 0 ? runs : [new docx.TextRun("")],
        };
        if (isOrdered) {
          pOpts.numbering = { reference: "numList", level: 0 };
        } else {
          pOpts.bullet = { level: 0 };
        }
        docChildren.push(new docx.Paragraph(pOpts));
      }
      return;
    }

    if (node.tag === "table") {
      docChildren.push(convertHtmlTableToDocx(docx, node));
      return;
    }

    for (const child of node.children || []) {
      visitNode(child);
    }
  };

  visitNode(root);

  if (docChildren.length === 0) {
    docChildren.push(new docx.Paragraph({ children: [new docx.TextRun("")] }));
  }

  const doc = new docx.Document({
    styles: officeStyle.DOCX_STYLES,
    numbering: officeStyle.DOCX_NUMBERING,
    sections: [{ properties: {}, children: docChildren }],
  });

  const b64 = await docx.Packer.toBase64String(doc);
  fs.writeFileSync(filepath, Buffer.from(b64, "base64"));
}

// --- EXCEL (.xlsx) CONVERSION ---

/** Converts HTML table elements into styled worksheets in an Excel .xlsx file. */
async function writeXlsxFromHtml(filepath, html) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  const root = parseHtml(html);

  const findTables = (n) => {
    if (!n) return [];
    if (n.type === "element" && n.tag === "table") return [n];
    return (n.children || []).flatMap(findTables);
  };

  let tables = findTables(root);
  if (tables.length === 0) {
    tables = [root];
  }

  let sheetIndex = 1;
  for (const table of tables) {
    const sheetName = table.attrs?.["data-sheet"] || table.attrs?.id || `Sheet${sheetIndex++}`;
    const worksheet = workbook.addWorksheet(sheetName.slice(0, 31));

    const findRows = (n) => {
      if (!n || n.type !== "element") return [];
      if (n.tag === "tr") return [n];
      return (n.children || []).flatMap(findRows);
    };

    const trNodes = findRows(table);
    const occupied = new Set();
    const colMaxLens = {};
    const colExplicitWidths = {};

    let rIdx = 1;
    for (const tr of trNodes) {
      let cIdx = 1;
      const cellNodes = (tr.children || []).filter(
        (c) => c.type === "element" && (c.tag === "th" || c.tag === "td"),
      );

      for (const cell of cellNodes) {
        while (occupied.has(`${rIdx}:${cIdx}`)) cIdx++;

        const isHeader = cell.tag === "th";
        const colspan = parseInt(cell.attrs.colspan, 10) || 1;
        const rowspan = parseInt(cell.attrs.rowspan, 10) || 1;
        const cellStyle = cell.style || {};

        const rawText = nodeText(cell).trim();
        const numVal = NUMERIC_RE.test(rawText) ? Number(rawText) : null;
        const cellValue = numVal !== null ? numVal : rawText;

        const excelCell = worksheet.getCell(rIdx, cIdx);
        excelCell.value = cellValue;

        // Font
        const fontOpts = {
          name: firstFont(cellStyle["font-family"]) || officeStyle.SHEET_FONT,
          size: parsePt(cellStyle["font-size"], isHeader ? 11 : 10),
          bold: isHeader || cellStyle["font-weight"] === "bold" || parseInt(cellStyle["font-weight"], 10) >= 600,
          italic: cellStyle["font-style"] === "italic",
        };
        const fontColor = parseColor(cellStyle.color || cell.attrs.color);
        if (fontColor) fontOpts.color = { argb: `FF${fontColor}` };
        excelCell.font = fontOpts;

        // Background fill
        const bgColor = parseColor(cellStyle["background-color"] || cellStyle.background || cell.attrs.bgcolor);
        if (bgColor) {
          excelCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: `FF${bgColor}` },
          };
        } else if (isHeader) {
          excelCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF2F2F4" },
          };
        }

        // Alignment
        const align = cellStyle["text-align"] || cell.attrs.align;
        excelCell.alignment = {
          horizontal: align === "center" || align === "right" ? align : (numVal !== null ? "right" : "left"),
          vertical: "middle",
          wrapText: true,
        };

        // Borders
        excelCell.border = {
          top: { style: "thin", color: { argb: "FFD0D0D8" } },
          left: { style: "thin", color: { argb: "FFD0D0D8" } },
          bottom: { style: "thin", color: { argb: "FFD0D0D8" } },
          right: { style: "thin", color: { argb: "FFD0D0D8" } },
        };

        // Column width tracking
        const textLen = String(cellValue).length;
        colMaxLens[cIdx] = Math.max(colMaxLens[cIdx] || 0, textLen);
        const wSpec = parseWidth(cellStyle.width || cell.attrs.width);
        if (wSpec && wSpec.type === "px") {
          colExplicitWidths[cIdx] = Math.max(colExplicitWidths[cIdx] || 0, Math.round(wSpec.value / 7));
        }

        // Handle merging
        if (colspan > 1 || rowspan > 1) {
          for (let dr = 0; dr < rowspan; dr++) {
            for (let dc = 0; dc < colspan; dc++) {
              occupied.add(`${rIdx + dr}:${cIdx + dc}`);
            }
          }
          worksheet.mergeCells(rIdx, cIdx, rIdx + rowspan - 1, cIdx + colspan - 1);
        }

        cIdx += colspan;
      }
      rIdx++;
    }

    // Apply computed or explicit column widths
    const maxCols = Math.max(...Object.keys(colMaxLens).map(Number), 1);
    for (let col = 1; col <= maxCols; col++) {
      const explicit = colExplicitWidths[col];
      const auto = Math.max(12, Math.min(50, (colMaxLens[col] || 0) + 3));
      worksheet.getColumn(col).width = explicit || auto;
    }
  }

  await workbook.xlsx.writeFile(filepath);
}

// --- POWERPOINT (.pptx) CONVERSION ---

/** Converts HTML elements representing slides into a PowerPoint .pptx presentation. */
async function writePptxFromHtml(filepath, html) {
  const PptxGen = require("pptxgenjs");
  const pres = new PptxGen();
  const root = parseHtml(html);

  // Group into slides by <section>, <div class="slide">, or <h1>
  const findSlideBlocks = (n) => {
    if (!n) return [];
    if (n.type === "element" && (n.tag === "section" || n.attrs?.class?.includes("slide") || n.attrs?.["data-slide"])) {
      return [n];
    }
    return (n.children || []).flatMap(findSlideBlocks);
  };

  let slideBlocks = findSlideBlocks(root);
  if (slideBlocks.length === 0) {
    // If no explicit section/slide wrappers, group top-level elements by <h1> or <hr>
    const groups = [];
    let current = [];
    for (const child of root.children || []) {
      if (child.type === "element" && (child.tag === "h1" || child.tag === "hr")) {
        if (current.length > 0) groups.push(current);
        current = child.tag === "h1" ? [child] : [];
      } else {
        current.push(child);
      }
    }
    if (current.length > 0) groups.push(current);
    slideBlocks = groups.map((g) => ({ type: "element", tag: "section", children: g, style: {} }));
  }

  if (slideBlocks.length === 0) {
    slideBlocks = [root];
  }

  for (const block of slideBlocks) {
    const slide = pres.addSlide();
    const style = block.style || {};
    const bgColor = parseColor(style["background-color"] || style.background || block.attrs?.["data-background"]);
    if (bgColor) {
      slide.background = { color: bgColor };
    }

    let yOffset = 0.5;

    // Search for slide title (h1 or h2)
    const findTitle = (n) => {
      if (!n || n.type !== "element") return null;
      if (n.tag === "h1" || n.tag === "h2") return n;
      for (const child of n.children || []) {
        const t = findTitle(child);
        if (t) return t;
      }
      return null;
    };

    const titleNode = findTitle(block);
    if (titleNode) {
      const titleText = nodeText(titleNode).trim();
      const tStyle = titleNode.style || {};
      const tColor = parseColor(tStyle.color || titleNode.attrs?.color) || "111111";
      const tSize = parsePt(tStyle["font-size"], 26);

      slide.addText(titleText, {
        x: 0.6,
        y: yOffset,
        w: 8.8,
        h: 0.8,
        fontFace: officeStyle.HEADING_FONT,
        fontSize: tSize,
        bold: true,
        color: tColor,
        valign: "top",
      });
      yOffset += 1.0;
    }

    // Collect body text runs or tables
    const bodyRuns = [];
    const walkBody = (item) => {
      if (item === titleNode) return;

      // Any heading that is not the slide's own title. Without this they were
      // walked past and their text never reached the slide at all.
      const subheading = item.type === "element" && /^h[1-6]$/.test(item.tag);

      if (subheading || (item.type === "element" && (item.tag === "p" || item.tag === "li"))) {
        const isBullet = item.tag === "li";
        const pStyle = item.style || {};
        const pColor = parseColor(pStyle.color) || (subheading ? "111111" : "333333");
        const pSize = parsePt(pStyle["font-size"], subheading ? 18 : 16);
        const text = nodeText(item).trim();
        if (text) {
          bodyRuns.push({
            text: isBullet ? `• ${text}\n` : `${text}\n\n`,
            options: {
              color: pColor,
              fontFace: firstFont(pStyle["font-family"]) || officeStyle.BODY_FONT,
              fontSize: pSize,
              bold: subheading || pStyle["font-weight"] === "bold",
              italic: pStyle["font-style"] === "italic",
            },
          });
        }
        return;
      }

      if (item.type === "element" && item.tag === "table") {
        // Render table inside slide
        const rows = [];
        for (const tr of (item.children || []).flatMap((c) => c.tag === "tr" ? [c] : (c.children || []).filter((r) => r.tag === "tr"))) {
          const cells = [];
          for (const cell of (tr.children || []).filter((c) => c.tag === "th" || c.tag === "td")) {
            const isHeader = cell.tag === "th";
            const cStyle = cell.style || {};
            const bg = parseColor(cStyle["background-color"] || cStyle.background) || (isHeader ? "F2F2F4" : undefined);
            cells.push({
              text: nodeText(cell).trim(),
              options: {
                bold: isHeader || cStyle["font-weight"] === "bold",
                color: parseColor(cStyle.color) || "222222",
                fill: bg ? { color: bg } : undefined,
                fontSize: parsePt(cStyle["font-size"], isHeader ? 12 : 11),
              },
            });
          }
          if (cells.length > 0) rows.push(cells);
        }
        if (rows.length > 0) {
          slide.addTable(rows, { x: 0.6, y: yOffset, w: 8.8, autoPage: false });
          yOffset += rows.length * 0.4 + 0.5;
        }
        return;
      }

      for (const child of item.children || []) {
        walkBody(child);
      }
    };

    walkBody(block);

    if (bodyRuns.length > 0) {
      slide.addText(bodyRuns, {
        x: 0.6,
        y: yOffset,
        w: 8.8,
        h: Math.max(1.5, 6.5 - yOffset),
        valign: "top",
      });
    }
  }

  await pres.writeFile({ fileName: filepath });
}

module.exports = {
  isHtml,
  parseHtml,
  parseColor,
  parseStyle,
  parsePt,
  parseWidth,
  decodeEntities,
  nodeText,
  writeDocxFromHtml,
  writeXlsxFromHtml,
  writePptxFromHtml,
};
