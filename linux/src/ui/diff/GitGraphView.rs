use crate::services::git_graph::{GraphRow, layout_graph};
use crate::services::git_operations::{GitCommitInfo, GitRefKind};
use adw::prelude::*;
use std::rc::Rc;

const ROW_HEIGHT: i32 = 24;
const LANE_WIDTH: f64 = 14.0;
const PADDING: f64 = 10.0;
const PALETTE: [(f64, f64, f64); 6] = [
    (0.33, 0.55, 0.95),
    (0.35, 0.75, 0.45),
    (0.95, 0.60, 0.20),
    (0.90, 0.35, 0.40),
    (0.25, 0.72, 0.72),
    (0.65, 0.45, 0.85),
];

fn lane_x(lane: usize) -> f64 {
    PADDING + lane as f64 * LANE_WIDTH
}

fn color(lane: usize) -> (f64, f64, f64) {
    PALETTE[lane % PALETTE.len()]
}

/// The lanes of one commit row: its segments and the dot.
fn lane_column(row: GraphRow, width: i32) -> gtk::DrawingArea {
    let area = gtk::DrawingArea::builder()
        .content_width(width)
        .content_height(ROW_HEIGHT)
        .valign(gtk::Align::Center)
        .build();
    area.set_draw_func(move |_, cr, _, height| {
        let height = f64::from(height);
        cr.set_line_width(1.5);
        for line in &row.lines {
            let (x1, y1) = (lane_x(line.from_lane), line.from_y * height);
            let (x2, y2) = (lane_x(line.to_lane), line.to_y * height);
            let (r, g, b) = color(line.color);
            cr.set_source_rgb(r, g, b);
            cr.move_to(x1, y1);
            if line.from_lane == line.to_lane {
                cr.line_to(x2, y2);
            } else {
                let middle = (y1 + y2) / 2.0;
                cr.curve_to(x1, middle, x2, middle, x2, y2);
            }
            let _ = cr.stroke();
        }
        let (r, g, b) = color(row.lane);
        cr.set_source_rgb(r, g, b);
        cr.arc(
            lane_x(row.lane),
            height / 2.0,
            3.5,
            0.0,
            std::f64::consts::TAU,
        );
        let _ = cr.fill();
    });
    area
}

fn ref_chip(name: &str, kind: GitRefKind) -> gtk::Label {
    let class = match kind {
        GitRefKind::Head | GitRefKind::Branch => "ref-branch",
        GitRefKind::Remote => "ref-remote",
        GitRefKind::Tag => "ref-tag",
    };
    gtk::Label::builder()
        .label(name)
        .ellipsize(gtk::pango::EllipsizeMode::End)
        .max_width_chars(16)
        .css_classes(["ref-chip", class])
        .build()
}

/// Every branch's commits drawn as lanes, one row each, with the refs that point at them.
pub fn build(
    commits: &[GitCommitInfo],
    selected: Option<&str>,
    on_select: Rc<dyn Fn(GitCommitInfo)>,
) -> gtk::Widget {
    let rows = layout_graph(
        commits
            .iter()
            .map(|c| (c.id.as_str(), c.parents.as_slice())),
    );
    let widest = rows.iter().map(|row| row.lanes).max().unwrap_or(1);
    let width = (PADDING * 2.0 + widest.saturating_sub(1) as f64 * LANE_WIDTH) as i32;
    let list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::Single)
        .css_classes(["git-graph"])
        .build();
    for (commit, row) in commits.iter().zip(rows) {
        let line = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(6)
            .margin_end(8)
            .tooltip_text(format!(
                "{} {}\n{} {}",
                commit.hash, commit.message, commit.author, commit.date
            ))
            .build();
        line.append(&lane_column(row, width));
        for r in &commit.refs {
            line.append(&ref_chip(&r.name, r.kind));
        }
        line.append(
            &gtk::Label::builder()
                .label(&commit.message)
                .xalign(0.0)
                .hexpand(true)
                .ellipsize(gtk::pango::EllipsizeMode::End)
                .css_classes(["caption"])
                .build(),
        );
        line.append(
            &gtk::Label::builder()
                .label(&commit.author)
                .ellipsize(gtk::pango::EllipsizeMode::End)
                .max_width_chars(14)
                .css_classes(["caption", "dim-label"])
                .build(),
        );
        let item = gtk::ListBoxRow::new();
        item.set_child(Some(&line));
        list.append(&item);
        if selected == Some(commit.id.as_str()) {
            list.select_row(Some(&item));
        }
    }
    let commits: Vec<GitCommitInfo> = commits.to_vec();
    list.connect_row_activated(move |_, row| {
        if let Some(commit) = commits.get(row.index() as usize) {
            on_select(commit.clone());
        }
    });
    list.upcast()
}
