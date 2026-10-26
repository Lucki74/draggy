use adw::prelude::*;
use std::cell::RefCell;
use std::rc::Rc;

use super::FileTreeItem::build_row;
use crate::services::file_operations::{delete_item, list_directory, FileTreeEntry};

pub struct FileExplorerWidget {
    pub container: gtk::Box,
    pub current_dir: Rc<RefCell<String>>,
}

impl FileExplorerWidget {
    pub fn new(root_dir: &str) -> Self {
        let container = gtk::Box::builder()
            .orientation(gtk::Orientation::Vertical)
            .vexpand(true)
            .hexpand(true)
            .build();

        let list_box = gtk::ListBox::builder()
            .selection_mode(gtk::SelectionMode::Single)
            .build();
        list_box.add_css_class("navigation-sidebar");

        let scroll = gtk::ScrolledWindow::builder()
            .vexpand(true)
            .hexpand(true)
            .child(&list_box)
            .build();

        container.append(&scroll);

        let current_dir = Rc::new(RefCell::new(root_dir.to_string()));
        let dir_clone = Rc::clone(&current_dir);
        let list_box_clone = list_box.clone();

        Self::refresh_list(&dir_clone.borrow(), &list_box_clone);

        let dir_for_click = Rc::clone(&current_dir);
        let list_box_for_click = list_box.clone();
        list_box.connect_row_activated(move |_, row| {
            let index = row.index();
            if let Ok(entries) = list_directory(&*dir_for_click.borrow()) {
                if let Some(entry) = entries.get(index as usize) {
                    if entry.is_directory {
                        *dir_for_click.borrow_mut() = entry.path.clone();
                        Self::refresh_list(&dir_for_click.borrow(), &list_box_for_click);
                    }
                }
            }
        });

        Self {
            container,
            current_dir,
        }
    }

    pub fn refresh_list(dir: &str, list_box: &gtk::ListBox) {
        while let Some(child) = list_box.first_child() {
            list_box.remove(&child);
        }

        if let Ok(entries) = list_directory(dir) {
            for entry in entries {
                let row = build_row(&entry);
                list_box.append(&row);
            }
        }
    }

    pub fn widget(&self) -> gtk::Widget {
        self.container.clone().upcast()
    }
}
