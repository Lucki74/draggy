use adw::prelude::*;
use std::rc::Rc;

use super::SearchPreviewView::SearchPreviewWidget;
use super::SearchResultView::build_result_row;
use crate::services::search_store::SearchStore;

pub fn build(root_dir: &str) -> gtk::Widget {
    let paned = gtk::Paned::builder()
        .orientation(gtk::Orientation::Horizontal)
        .vexpand(true)
        .hexpand(true)
        .build();

    let left_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .width_request(280)
        .build();

    let search_entry = gtk::SearchEntry::builder()
        .placeholder_text("Search files...")
        .margin_start(8)
        .margin_end(8)
        .margin_top(6)
        .margin_bottom(6)
        .build();

    let list_box = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::Single)
        .vexpand(true)
        .build();
    list_box.add_css_class("navigation-sidebar");

    let scroll = gtk::ScrolledWindow::builder()
        .vexpand(true)
        .child(&list_box)
        .build();

    left_box.append(&search_entry);
    left_box.append(&scroll);

    let preview = Rc::new(SearchPreviewWidget::new());

    paned.set_start_child(Some(&left_box));
    paned.set_end_child(Some(&preview.widget()));

    let store = Rc::new(SearchStore::new());
    let root_str = root_dir.to_string();

    let store_clone = Rc::clone(&store);
    let list_clone = list_box.clone();
    search_entry.connect_search_changed(move |entry| {
        let text = entry.text().to_string();
        store_clone.set_query(&text);
        store_clone.execute_search(&root_str);

        while let Some(child) = list_clone.first_child() {
            list_clone.remove(&child);
        }

        let results = store_clone.get_results();
        for item in &results {
            let row = build_result_row(item);
            list_clone.append(&row);
        }
    });

    let store_for_select = Rc::clone(&store);
    let preview_clone = Rc::clone(&preview);
    list_box.connect_row_activated(move |_, row| {
        let idx = row.index() as usize;
        let results = store_for_select.get_results();
        if let Some(item) = results.get(idx) {
            preview_clone.show_result(item);
        }
    });

    paned.upcast()
}
