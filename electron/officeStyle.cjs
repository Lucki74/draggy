/**
 * What a generated document looks like before anything in it is styled: the
 * typeface, the heading sizes, the spacing between paragraphs.
 *
 * Aptos because it is what Word and Excel have shipped as their default since
 * 2024, so a file Draggy writes opens looking like one the user made
 * themselves rather than like the library's bare default.
 */

const BODY_FONT = "Aptos";
const HEADING_FONT = "Aptos Display";

/** Excel's own default is the narrow cut, which fits more in a column. */
const SHEET_FONT = "Aptos Narrow";

const MONO_FONT = "Cascadia Mono";

/** Word's own heading colour in the Office theme. */
const HEADING_COLOR = "0F4761";

/** Half-points, which is what docx measures a run in. */
const pt = (points) => points * 2;

/** Twentieths of a point, which is what it measures spacing in. */
const twips = (points) => Math.round(points * 20);

function heading(size, spacingBefore) {
  return {
    run: { font: HEADING_FONT, size: pt(size), bold: true, color: HEADING_COLOR },
    paragraph: { spacing: { before: twips(spacingBefore), after: twips(4) } },
  };
}

const DOCX_STYLES = {
  default: {
    document: {
      run: { font: BODY_FONT, size: pt(11), color: "000000" },
      // 1.15 lines and a gap after, which is Word's own default and the
      // difference between a document and a wall of text.
      paragraph: { spacing: { line: 276, after: twips(8) } },
    },
    title: {
      run: { font: HEADING_FONT, size: pt(28), bold: true, color: HEADING_COLOR },
      paragraph: { spacing: { after: twips(12) } },
    },
    heading1: heading(20, 16),
    heading2: heading(16, 14),
    heading3: heading(14, 12),
    heading4: heading(12, 10),
    heading5: heading(11, 10),
    heading6: heading(11, 10),
  },
};

/** One ordered list, referenced by every numbered paragraph in the document. */
const DOCX_NUMBERING = {
  config: [
    {
      reference: "numList",
      levels: [
        {
          level: 0,
          format: "decimal",
          text: "%1.",
          alignment: "start",
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        },
      ],
    },
  ],
};

/** Thin grey lines on every edge, so a table reads as a table without shouting. */
function tableBorders(docx) {
  const line = { style: docx.BorderStyle.SINGLE, size: 4, color: "D0D0D8" };
  return { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line };
}

module.exports = {
  BODY_FONT,
  HEADING_FONT,
  SHEET_FONT,
  MONO_FONT,
  HEADING_COLOR,
  DOCX_STYLES,
  DOCX_NUMBERING,
  tableBorders,
  pt,
  twips,
};
