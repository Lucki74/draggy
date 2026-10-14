//! Typeface, colour and spacing defaults for generated Office files. Ports electron/officeStyle.cjs, the data the
//! docx and xlsx writers read. Units follow the formats: half points for runs, twentieths of a point for spacing.

use serde::Serialize;

use crate::js::round;

/// Aptos, the default body face of Word and Excel since 2024.
pub const BODY_FONT: &str = "Aptos";
pub const HEADING_FONT: &str = "Aptos Display";
/// Excel's own default is the narrow cut, which fits more in a column.
pub const SHEET_FONT: &str = "Aptos Narrow";
pub const MONO_FONT: &str = "Cascadia Mono";
/// Black by default, so unstyled documents match plain HTML and Markdown.
pub const HEADING_COLOR: &str = "000000";

/// Half points, which is what docx measures a run in.
pub fn pt(points: f64) -> f64 {
    points * 2.0
}

/// Twentieths of a point, which is what docx measures spacing in.
pub fn twips(points: f64) -> f64 {
    round(points * 20.0)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RunStyle {
    pub font: &'static str,
    pub size: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    pub color: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Spacing {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ParagraphStyle {
    pub spacing: Spacing,
}

/// A run style and a paragraph style together, as one named style of the document.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StyleDef {
    pub run: RunStyle,
    pub paragraph: ParagraphStyle,
}

/// The styles every generated document starts with.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DefaultStyles {
    pub document: StyleDef,
    pub title: StyleDef,
    pub heading1: StyleDef,
    pub heading2: StyleDef,
    pub heading3: StyleDef,
    pub heading4: StyleDef,
    pub heading5: StyleDef,
    pub heading6: StyleDef,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DocxStyles {
    pub default: DefaultStyles,
}

fn heading(size: f64, spacing_before: f64) -> StyleDef {
    StyleDef {
        run: RunStyle {
            font: HEADING_FONT,
            size: pt(size),
            bold: Some(true),
            color: HEADING_COLOR,
        },
        paragraph: ParagraphStyle {
            spacing: Spacing {
                line: None,
                before: Some(twips(spacing_before)),
                after: Some(twips(4.0)),
            },
        },
    }
}

/// The document's default and heading styles. The body keeps Word's 1.15 line and a gap after each paragraph.
pub fn docx_styles() -> DocxStyles {
    DocxStyles {
        default: DefaultStyles {
            document: StyleDef {
                run: RunStyle {
                    font: BODY_FONT,
                    size: pt(11.0),
                    bold: None,
                    color: "000000",
                },
                paragraph: ParagraphStyle {
                    spacing: Spacing {
                        line: Some(276.0),
                        before: None,
                        after: Some(twips(8.0)),
                    },
                },
            },
            title: StyleDef {
                run: RunStyle {
                    font: HEADING_FONT,
                    size: pt(28.0),
                    bold: Some(true),
                    color: HEADING_COLOR,
                },
                paragraph: ParagraphStyle {
                    spacing: Spacing {
                        line: None,
                        before: None,
                        after: Some(twips(12.0)),
                    },
                },
            },
            heading1: heading(20.0, 16.0),
            heading2: heading(16.0, 14.0),
            heading3: heading(14.0, 12.0),
            heading4: heading(12.0, 10.0),
            heading5: heading(11.0, 10.0),
            heading6: heading(11.0, 10.0),
        },
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Indent {
    pub left: f64,
    pub hanging: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LevelParagraph {
    pub indent: Indent,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LevelStyle {
    pub paragraph: LevelParagraph,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NumberingLevel {
    pub level: u32,
    pub format: &'static str,
    pub text: &'static str,
    pub alignment: &'static str,
    pub style: LevelStyle,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NumberingConfig {
    pub reference: &'static str,
    pub levels: Vec<NumberingLevel>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Numbering {
    pub config: Vec<NumberingConfig>,
}

/// The one ordered list every numbered paragraph refers to.
pub fn docx_numbering() -> Numbering {
    Numbering {
        config: vec![NumberingConfig {
            reference: "numList",
            levels: vec![NumberingLevel {
                level: 0,
                format: "decimal",
                text: "%1.",
                alignment: "start",
                style: LevelStyle {
                    paragraph: LevelParagraph {
                        indent: Indent {
                            left: 720.0,
                            hanging: 360.0,
                        },
                    },
                },
            }],
        }],
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BorderLine {
    pub style: &'static str,
    pub size: f64,
    pub color: &'static str,
}

/// Thin grey lines on every edge, so a table reads as a table without shouting.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TableBorders {
    pub top: BorderLine,
    pub bottom: BorderLine,
    pub left: BorderLine,
    pub right: BorderLine,
    #[serde(rename = "insideHorizontal")]
    pub inside_horizontal: BorderLine,
    #[serde(rename = "insideVertical")]
    pub inside_vertical: BorderLine,
}

pub fn table_borders() -> TableBorders {
    let line = BorderLine {
        style: "single",
        size: 4.0,
        color: "D0D0D8",
    };
    TableBorders {
        top: line.clone(),
        bottom: line.clone(),
        left: line.clone(),
        right: line.clone(),
        inside_horizontal: line.clone(),
        inside_vertical: line,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pt_is_half_points_and_twips_round_halves_up() {
        assert_eq!(pt(9.5), 19.0);
        assert_eq!(twips(8.0), 160.0);
        assert_eq!(twips(-0.125), -2.0);
    }

    #[test]
    fn headings_step_down_in_size() {
        let styles = docx_styles();
        assert_eq!(styles.default.heading1.run.size, 40.0);
        assert_eq!(styles.default.heading2.run.size, 32.0);
        assert_eq!(styles.default.heading6.run.size, 22.0);
        assert_eq!(styles.default.heading1.run.bold, Some(true));
    }

    #[test]
    fn the_body_keeps_the_word_line_spacing_and_typeface() {
        let body = docx_styles().default.document;
        assert_eq!(body.run.font, BODY_FONT);
        assert_eq!(body.paragraph.spacing.line, Some(276.0));
        assert_eq!(body.paragraph.spacing.after, Some(160.0));
    }

    #[test]
    fn the_numbered_list_is_one_decimal_level() {
        let numbering = docx_numbering();
        let level = &numbering.config[0].levels[0];
        assert_eq!(numbering.config[0].reference, "numList");
        assert_eq!(level.format, "decimal");
        assert_eq!(level.text, "%1.");
        assert_eq!(level.style.paragraph.indent.left, 720.0);
    }

    #[test]
    fn table_borders_are_thin_grey_on_every_edge() {
        let borders = table_borders();
        for line in [
            &borders.top,
            &borders.bottom,
            &borders.left,
            &borders.right,
            &borders.inside_horizontal,
            &borders.inside_vertical,
        ] {
            assert_eq!(line.style, "single");
            assert_eq!(line.size, 4.0);
            assert_eq!(line.color, "D0D0D8");
        }
    }
}
