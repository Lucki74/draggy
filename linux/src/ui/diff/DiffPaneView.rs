use adw::prelude::*;
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

use super::{GitGraphView, SplitDiffView, UnifiedDiffView};
use crate::services::diff_parser::{DiffLineType, FileDiff, parse_git_diff};
use crate::services::git_operations::{
    GitCommitInfo, current_branch, git_branches, git_diff, git_log, git_show, switch_branch,
};
use draggy_linux::research::t;

/// Split needs room for two columns of code.
const SPLIT_MIN_WIDTH: i32 = 700;

#[derive(Default)]
struct State {
    commit: Option<GitCommitInfo>,
    files: Vec<FileDiff>,
    commits: Vec<GitCommitInfo>,
    /// `None` until the reader opens or closes a file; then the first file starts open.
    expanded: Option<HashSet<String>>,
    split: bool,
    hide_whitespace: bool,
}

struct Pane {
    dir: String,
    root: gtk::Box,
    branch: gtk::MenuButton,
    branch_list: gtk::Box,
    branch_popover: gtk::Popover,
    count: gtk::Label,
    problem: gtk::Label,
    back: gtk::Box,
    commit_line: gtk::Label,
    filter: gtk::SearchEntry,
    files_box: gtk::Box,
    graph_holder: gtk::Box,
    state: RefCell<State>,
}

/// Review: the working changes, or one commit's, as files that open into their diffs, over the commit graph.
pub fn build(dir: &str) -> gtk::Widget {
    let root = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .vexpand(true)
        .hexpand(true)
        .build();
    let branch_list = gtk::Box::new(gtk::Orientation::Vertical, 0);
    let branch_popover = gtk::Popover::builder().child(&branch_list).build();
    let branch = gtk::MenuButton::builder()
        .popover(&branch_popover)
        .tooltip_text(t("gitSwitchBranch"))
        .css_classes(["flat"])
        .build();
    let count = gtk::Label::builder()
        .css_classes(["caption", "dim-label"])
        .ellipsize(gtk::pango::EllipsizeMode::End)
        .xalign(0.0)
        .hexpand(true)
        .build();
    let problem = gtk::Label::builder()
        .css_classes(["caption", "error"])
        .wrap(true)
        .xalign(0.0)
        .margin_start(8)
        .margin_end(8)
        .visible(false)
        .build();
    let back = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .margin_start(8)
        .margin_end(8)
        .margin_top(4)
        .margin_bottom(4)
        .visible(false)
        .build();
    let commit_line = gtk::Label::builder()
        .css_classes(["caption", "dim-label"])
        .ellipsize(gtk::pango::EllipsizeMode::End)
        .xalign(0.0)
        .build();
    let filter = gtk::SearchEntry::builder()
        .placeholder_text(t("reviewFilter"))
        .margin_start(8)
        .margin_end(8)
        .margin_top(4)
        .visible(false)
        .build();
    let files_box = gtk::Box::new(gtk::Orientation::Vertical, 0);
    let graph_holder = gtk::Box::new(gtk::Orientation::Vertical, 0);
    let pane = Rc::new(Pane {
        dir: dir.to_owned(),
        root: root.clone(),
        branch,
        branch_list,
        branch_popover,
        count,
        problem,
        back,
        commit_line,
        filter,
        files_box,
        graph_holder,
        state: RefCell::new(State::default()),
    });
    pane.assemble();
    pane.reload();
    root.upcast()
}

impl Pane {
    fn assemble(self: &Rc<Self>) {
        let toolbar = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(6)
            .margin_start(8)
            .margin_end(8)
            .margin_top(4)
            .margin_bottom(4)
            .build();
        toolbar.append(&self.branch);
        toolbar.append(&self.count);

        let search = gtk::ToggleButton::builder()
            .icon_name("edit-find-symbolic")
            .tooltip_text(t("reviewFilter"))
            .css_classes(["flat"])
            .build();
        let pane = Rc::clone(self);
        search.connect_toggled(move |button| {
            pane.filter.set_visible(button.is_active());
            if !button.is_active() {
                pane.filter.set_text("");
            }
        });
        toolbar.append(&search);
        toolbar.append(&self.options());
        let refresh = gtk::Button::builder()
            .icon_name("view-refresh-symbolic")
            .tooltip_text(t("reviewRefresh"))
            .css_classes(["flat"])
            .build();
        let pane = Rc::clone(self);
        refresh.connect_clicked(move |_| pane.reload());
        toolbar.append(&refresh);

        let pane = Rc::clone(self);
        self.filter
            .connect_search_changed(move |_| pane.render_files());

        let back = gtk::Button::builder()
            .label(t("reviewBack"))
            .halign(gtk::Align::Start)
            .css_classes(["flat", "caption"])
            .build();
        let pane = Rc::clone(self);
        back.connect_clicked(move |_| pane.show_commit(None));
        self.back.append(&back);
        self.back.append(&self.commit_line);

        let files = gtk::ScrolledWindow::builder()
            .child(&self.files_box)
            .hscrollbar_policy(gtk::PolicyType::Never)
            .vexpand(true)
            .build();
        let graph = gtk::Expander::builder()
            .label(t("gitGraph").to_uppercase())
            .expanded(true)
            .margin_start(8)
            .child(
                &gtk::ScrolledWindow::builder()
                    .child(&self.graph_holder)
                    .hscrollbar_policy(gtk::PolicyType::Never)
                    .min_content_height(220)
                    .build(),
            )
            .build();

        self.root.append(&toolbar);
        self.root
            .append(&gtk::Separator::new(gtk::Orientation::Horizontal));
        self.root.append(&self.filter);
        self.root.append(&self.problem);
        self.root.append(&self.back);
        self.root.append(&files);
        self.root
            .append(&gtk::Separator::new(gtk::Orientation::Horizontal));
        self.root.append(&graph);
    }

    /// The split, whitespace and expand toggles behind one menu.
    fn options(self: &Rc<Self>) -> gtk::MenuButton {
        let content = gtk::Box::new(gtk::Orientation::Vertical, 2);
        let split = gtk::CheckButton::with_label(&t("reviewSplit"));
        let pane = Rc::clone(self);
        split.connect_toggled(move |button| {
            pane.state.borrow_mut().split = button.is_active();
            pane.render_files();
        });
        let whitespace = gtk::CheckButton::with_label(&t("reviewHideWhitespace"));
        let pane = Rc::clone(self);
        whitespace.connect_toggled(move |button| {
            pane.state.borrow_mut().hide_whitespace = button.is_active();
            pane.reload();
        });
        let toggle_all = gtk::Button::builder()
            .label(t("reviewExpandAll"))
            .css_classes(["flat"])
            .build();
        let pane = Rc::clone(self);
        toggle_all.connect_clicked(move |button| {
            let open = pane.all_open();
            let next: HashSet<String> = if open {
                HashSet::new()
            } else {
                pane.shown().iter().map(file_id).collect()
            };
            pane.state.borrow_mut().expanded = Some(next);
            button.set_label(&t(if open {
                "reviewExpandAll"
            } else {
                "reviewCollapseAll"
            }));
            pane.render_files();
        });
        content.append(&split);
        content.append(&whitespace);
        content.append(&toggle_all);
        gtk::MenuButton::builder()
            .icon_name("view-more-symbolic")
            .tooltip_text(t("reviewMore"))
            .css_classes(["flat"])
            .popover(&gtk::Popover::builder().child(&content).build())
            .build()
    }

    fn show_commit(self: &Rc<Self>, commit: Option<GitCommitInfo>) {
        {
            let mut state = self.state.borrow_mut();
            state.commit = commit;
            state.expanded = None;
        }
        self.reload();
    }

    fn reload(self: &Rc<Self>) {
        let ignore = self.state.borrow().hide_whitespace;
        let commit = self.state.borrow().commit.clone();
        let raw = match &commit {
            Some(commit) => git_show(&self.dir, &commit.id, ignore),
            None => git_diff(&self.dir, ignore),
        };
        {
            let mut state = self.state.borrow_mut();
            state.files = parse_git_diff(&raw);
            state.commits = git_log(&self.dir, 200);
        }
        self.problem.set_visible(false);
        self.back.set_visible(commit.is_some());
        if let Some(commit) = &commit {
            self.commit_line
                .set_text(&format!("{} {}", commit.hash, commit.message));
        }
        self.render_branches();
        self.render_files();
        self.render_graph();
    }

    fn render_branches(self: &Rc<Self>) {
        let name = current_branch(&self.dir);
        self.branch.set_label(&if name == "HEAD" {
            t("gitDetached")
        } else {
            name
        });
        while let Some(child) = self.branch_list.first_child() {
            self.branch_list.remove(&child);
        }
        let branches = git_branches(&self.dir);
        if branches.is_empty() {
            self.branch_list
                .append(&gtk::Label::new(Some(t("gitNoBranches").as_str())));
        }
        for item in branches {
            let label = if item.current {
                format!("✓ {}", item.name)
            } else {
                item.name.clone()
            };
            let button = gtk::Button::builder()
                .label(label)
                .css_classes(["flat"])
                .sensitive(!item.current)
                .build();
            let pane = Rc::clone(self);
            button.connect_clicked(move |_| {
                pane.branch_popover.popdown();
                match switch_branch(&pane.dir, &item.name) {
                    Some(message) => {
                        pane.problem.set_text(&message);
                        pane.problem.set_visible(true);
                    }
                    None => pane.show_commit(None),
                }
            });
            self.branch_list.append(&button);
        }
    }

    fn shown(&self) -> Vec<FileDiff> {
        let needle = self.filter.text().trim().to_lowercase();
        let state = self.state.borrow();
        state
            .files
            .iter()
            .filter(|f| needle.is_empty() || file_id(f).to_lowercase().contains(&needle))
            .cloned()
            .collect()
    }

    fn open_set(&self) -> HashSet<String> {
        let state = self.state.borrow();
        if let Some(open) = &state.expanded {
            return open.clone();
        }
        match (&state.commit, state.files.first()) {
            (None, Some(first)) => HashSet::from([file_id(first)]),
            _ => HashSet::new(),
        }
    }

    fn all_open(&self) -> bool {
        let shown = self.shown();
        let open = self.open_set();
        !shown.is_empty() && shown.iter().all(|f| open.contains(&file_id(f)))
    }

    fn render_files(self: &Rc<Self>) {
        while let Some(child) = self.files_box.first_child() {
            self.files_box.remove(&child);
        }
        let total = self.state.borrow().files.len();
        let in_commit = self.state.borrow().commit.is_some();
        self.count.set_text(&if total == 0 {
            t("gitClean")
        } else {
            t("gitChangedFiles").replace("{count}", &total.to_string())
        });
        if total == 0 {
            let empty = gtk::Label::builder()
                .label(t(if in_commit { "gitNoDiff" } else { "gitClean" }))
                .css_classes(["dim-label"])
                .margin_top(24)
                .build();
            self.files_box.append(&empty);
            return;
        }
        let split = self.state.borrow().split && self.root.width() >= SPLIT_MIN_WIDTH;
        let open = self.open_set();
        for file in self.shown() {
            self.files_box
                .append(&self.file_row(&file, open.contains(&file_id(&file)), split));
        }
    }

    /// A file as one row with its change counts that opens into its diff.
    fn file_row(self: &Rc<Self>, file: &FileDiff, open: bool, split: bool) -> gtk::Box {
        let id = file_id(file);
        let (name, folder) = match id.rsplit_once('/') {
            Some((folder, name)) => (name.to_owned(), folder.to_owned()),
            None => (id.clone(), String::new()),
        };
        let count = |kind: DiffLineType| file.lines.iter().filter(|l| l.line_type == kind).count();
        let head = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(8)
            .build();
        head.append(
            &gtk::Label::builder()
                .label(&name)
                .ellipsize(gtk::pango::EllipsizeMode::Middle)
                .css_classes(["caption"])
                .build(),
        );
        head.append(
            &gtk::Label::builder()
                .label(&folder)
                .ellipsize(gtk::pango::EllipsizeMode::Start)
                .xalign(0.0)
                .hexpand(true)
                .css_classes(["caption", "dim-label"])
                .build(),
        );
        head.append(
            &gtk::Label::builder()
                .label(format!("+{}", count(DiffLineType::Add)))
                .css_classes(["caption", "success"])
                .build(),
        );
        head.append(
            &gtk::Label::builder()
                .label(format!("-{}", count(DiffLineType::Delete)))
                .css_classes(["caption", "error"])
                .build(),
        );
        head.append(&gtk::Image::from_icon_name(if open {
            "pan-down-symbolic"
        } else {
            "pan-end-symbolic"
        }));
        let button = gtk::Button::builder()
            .child(&head)
            .css_classes(["flat"])
            .build();
        let pane = Rc::clone(self);
        let toggled = id.clone();
        button.connect_clicked(move |_| {
            let mut next = pane.open_set();
            if !next.remove(&toggled) {
                next.insert(toggled.clone());
            }
            pane.state.borrow_mut().expanded = Some(next);
            pane.render_files();
        });
        let row = gtk::Box::new(gtk::Orientation::Vertical, 0);
        row.append(&button);
        if open {
            row.append(&if split {
                SplitDiffView::build(file)
            } else {
                UnifiedDiffView::build(file)
            });
        }
        row.append(&gtk::Separator::new(gtk::Orientation::Horizontal));
        row
    }

    fn render_graph(self: &Rc<Self>) {
        while let Some(child) = self.graph_holder.first_child() {
            self.graph_holder.remove(&child);
        }
        let state = self.state.borrow();
        if state.commits.is_empty() {
            self.graph_holder.append(
                &gtk::Label::builder()
                    .label(t("gitNoCommits"))
                    .css_classes(["caption", "dim-label"])
                    .margin_top(16)
                    .build(),
            );
            return;
        }
        let pane = Rc::clone(self);
        let selected = state.commit.as_ref().map(|c| c.id.clone());
        let graph = GitGraphView::build(
            &state.commits,
            selected.as_deref(),
            Rc::new(move |commit| {
                // Defer so the graph is not rebuilt inside its own row activation.
                let pane = Rc::clone(&pane);
                gtk::glib::idle_add_local_once(move || pane.show_commit(Some(commit)));
            }),
        );
        self.graph_holder.append(&graph);
    }
}

fn file_id(file: &FileDiff) -> String {
    if file.new_path.is_empty() {
        file.old_path.clone()
    } else {
        file.new_path.clone()
    }
}
