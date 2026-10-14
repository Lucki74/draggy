//! Writes Markdown as a .pptx. The reference uses pptxgenjs; this writes the few parts a deck of text boxes needs.
//! Each slide is a title box and a body box, placed as the reference places them on a 16:9 page.

use std::io::{Cursor, Write};
use std::path::Path;

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::html::is_html;
use crate::js::trim;
use crate::office_error::OfficeError;
use crate::office_markdown::{Slide, split_into_slides};
use crate::office_style::{BODY_FONT, HEADING_FONT};
use crate::office_xml::escape_xml;

const THEME: &str = include_str!("templates/pptx/theme1.xml");
const MASTER: &str = include_str!("templates/pptx/slide_master.xml");
const LAYOUT: &str = include_str!("templates/pptx/slide_layout.xml");

const EMU_PER_INCH: f64 = 914_400.0;
pub(crate) const NS: &str = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main""#;
const REL_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_TYPE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// What the writer reports back, as the reference does: the slides written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PptxCounts {
    pub slides: usize,
}

/// One text box on a slide, in inches, with the run style the reference sets on it.
#[derive(Debug, Clone, PartialEq)]
struct TextBox {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    size: f64,
    bold: bool,
    font: &'static str,
    text: String,
}

/// The package bytes for Markdown content, and the counts. HTML content is refused: it needs the HTML writer.
pub fn pptx_bytes(content: &str) -> Result<(Vec<u8>, PptxCounts), OfficeError> {
    if is_html(Some(content)) {
        return Err(OfficeError::HtmlBody);
    }
    let mut slides = split_into_slides(content);
    if slides.is_empty() {
        slides.push(Slide {
            title: String::new(),
            body: vec![trim(content).to_owned()],
        });
    }
    let bodies: Vec<String> = slides.iter().map(slide_xml).collect();
    let bytes = package(&bodies)?;
    Ok((
        bytes,
        PptxCounts {
            slides: slides.len(),
        },
    ))
}

/// The package bytes for a deck whose slides are already written as XML, one string per slide in order.
pub(crate) fn package(slide_xml_bodies: &[String]) -> Result<Vec<u8>, OfficeError> {
    let slides = slide_xml_bodies.len();
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut parts: Vec<(String, String)> = vec![
        ("[Content_Types].xml".to_owned(), content_types(slides)),
        ("_rels/.rels".to_owned(), root_rels()),
        ("ppt/presentation.xml".to_owned(), presentation(slides)),
        (
            "ppt/_rels/presentation.xml.rels".to_owned(),
            presentation_rels(slides),
        ),
        (
            "ppt/slideMasters/slideMaster1.xml".to_owned(),
            MASTER.to_owned(),
        ),
        (
            "ppt/slideMasters/_rels/slideMaster1.xml.rels".to_owned(),
            master_rels(),
        ),
        (
            "ppt/slideLayouts/slideLayout1.xml".to_owned(),
            LAYOUT.to_owned(),
        ),
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels".to_owned(),
            layout_rels(),
        ),
        ("ppt/theme/theme1.xml".to_owned(), THEME.to_owned()),
    ];
    for (index, body) in slide_xml_bodies.iter().enumerate() {
        let number = index + 1;
        parts.push((format!("ppt/slides/slide{number}.xml"), body.clone()));
        parts.push((
            format!("ppt/slides/_rels/slide{number}.xml.rels"),
            slide_rels(),
        ));
    }

    for (name, body) in &parts {
        writer
            .start_file(name.as_str(), options)
            .map_err(|error| build_error(error.to_string()))?;
        writer.write_all(body.as_bytes())?;
    }
    let bytes = writer
        .finish()
        .map_err(|error| build_error(error.to_string()))?
        .into_inner();
    Ok(bytes)
}

/// Writes Markdown content to a .pptx file at `path`.
pub fn write_pptx(path: &Path, content: &str) -> Result<PptxCounts, OfficeError> {
    let (bytes, counts) = pptx_bytes(content)?;
    std::fs::write(path, bytes)?;
    tracing::debug!(target: "files.documents", slides = counts.slides, "pptx written");
    Ok(counts)
}

fn build_error(message: String) -> OfficeError {
    OfficeError::Build {
        format: "pptx",
        message,
    }
}

pub(crate) fn emu(inches: f64) -> i64 {
    (inches * EMU_PER_INCH).round() as i64
}

/// The boxes a slide is drawn with: a title at the top, and a body below it, or filling the page without a title.
fn boxes_for(slide: &Slide) -> Vec<TextBox> {
    let mut boxes = Vec::new();
    let has_title = !slide.title.is_empty();
    if has_title {
        boxes.push(TextBox {
            x: 0.5,
            y: 0.4,
            width: 9.0,
            height: 0.8,
            size: 28.0,
            bold: true,
            font: HEADING_FONT,
            text: slide.title.clone(),
        });
    }
    if !slide.body.is_empty() {
        boxes.push(TextBox {
            x: 0.5,
            y: if has_title { 1.4 } else { 0.5 },
            width: 9.0,
            height: if has_title { 3.7 } else { 4.6 },
            size: 16.0,
            bold: false,
            font: BODY_FONT,
            text: slide.body.join("\n"),
        });
    }
    boxes
}

fn slide_xml(slide: &Slide) -> String {
    let shapes: String = boxes_for(slide)
        .iter()
        .enumerate()
        .map(|(index, text_box)| shape(index, text_box))
        .collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld {NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>{shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#
    )
}

fn shape(index: usize, text_box: &TextBox) -> String {
    let paragraphs: String = text_box
        .text
        .split('\n')
        .map(|line| paragraph(line, text_box))
        .collect();
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="Text {index}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="t"/><a:lstStyle/>{paragraphs}</p:txBody></p:sp>"#,
        id = index + 2,
        x = emu(text_box.x),
        y = emu(text_box.y),
        cx = emu(text_box.width),
        cy = emu(text_box.height),
    )
}

/// One paragraph with a single run. An empty line has no run, as in the reference, so it carries only its end mark.
fn paragraph(line: &str, text_box: &TextBox) -> String {
    let size = (text_box.size * 100.0).round() as i64;
    if line.is_empty() {
        return format!(r#"<a:p><a:endParaRPr lang="en-US" sz="{size}"/></a:p>"#);
    }
    let bold = if text_box.bold { r#" b="1""# } else { "" };
    format!(
        r#"<a:p><a:r><a:rPr lang="en-US" sz="{sz}"{bold}><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="{font}"/></a:rPr><a:t>{text}</a:t></a:r></a:p>"#,
        sz = size,
        font = text_box.font,
        text = escape_xml(line),
    )
}

fn content_types(slides: usize) -> String {
    let slide_overrides: String = (1..=slides)
        .map(|n| {
            format!(
                r#"<Override PartName="/ppt/slides/slide{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>"#
            )
        })
        .collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>{slide_overrides}</Types>"#
    )
}

fn relationships(entries: &[(&str, &str, &str)]) -> String {
    let items: String = entries
        .iter()
        .map(|(id, kind, target)| {
            format!(r#"<Relationship Id="{id}" Type="{REL_TYPE}/{kind}" Target="{target}"/>"#)
        })
        .collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="{REL_NS}">{items}</Relationships>"#
    )
}

fn root_rels() -> String {
    relationships(&[("rId1", "officeDocument", "ppt/presentation.xml")])
}

fn presentation(slides: usize) -> String {
    let slide_ids: String = (0..slides)
        .map(|index| format!(r#"<p:sldId id="{}" r:id="rId{}"/>"#, 256 + index, 3 + index))
        .collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation {NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>{slide_ids}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>"#
    )
}

fn presentation_rels(slides: usize) -> String {
    let mut entries: Vec<(String, &str, String)> = vec![
        (
            "rId1".to_owned(),
            "slideMaster",
            "slideMasters/slideMaster1.xml".to_owned(),
        ),
        ("rId2".to_owned(), "theme", "theme/theme1.xml".to_owned()),
    ];
    for index in 0..slides {
        entries.push((
            format!("rId{}", 3 + index),
            "slide",
            format!("slides/slide{}.xml", index + 1),
        ));
    }
    let borrowed: Vec<(&str, &str, &str)> = entries
        .iter()
        .map(|(id, kind, target)| (id.as_str(), *kind, target.as_str()))
        .collect();
    relationships(&borrowed)
}

fn master_rels() -> String {
    relationships(&[
        ("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
        ("rId2", "theme", "../theme/theme1.xml"),
    ])
}

fn layout_rels() -> String {
    relationships(&[("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")])
}

fn slide_rels() -> String {
    relationships(&[("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_slide_per_heading() {
        let (_, counts) = pptx_bytes("# One\nbody a\n\n# Two\nbody b").expect("writes");
        assert_eq!(counts, PptxCounts { slides: 2 });
    }

    #[test]
    fn a_title_moves_the_body_below_it() {
        let slide = Slide {
            title: "T".to_owned(),
            body: vec!["x".to_owned()],
        };
        let boxes = boxes_for(&slide);
        assert_eq!(boxes.len(), 2);
        assert_eq!(boxes[1].y, 1.4);
        assert_eq!(boxes[1].height, 3.7);
    }

    #[test]
    fn html_content_is_refused() {
        assert!(matches!(
            pptx_bytes("<section><h2>Slide</h2></section>"),
            Err(OfficeError::HtmlBody)
        ));
    }

    #[test]
    fn a_written_deck_reads_back_slide_by_slide() {
        let (bytes, _) = pptx_bytes("# Alpha\npoint one\n\n# Beta\npoint two").expect("writes");
        let text = crate::office_read::read_pptx(&bytes).expect("reads");
        assert!(text.contains("Alpha") && text.contains("point two"));
        assert!(text.contains("--- Slide 1 ---"));
    }
}
