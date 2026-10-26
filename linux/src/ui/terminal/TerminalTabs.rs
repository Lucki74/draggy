use adw::prelude::*;

pub struct TerminalTabsWidget {
    pub notebook: gtk::Notebook,
}

impl TerminalTabsWidget {
    pub fn new() -> Self {
        let notebook = gtk::Notebook::builder()
            .show_tabs(true)
            .show_border(false)
            .scrollable(true)
            .build();

        Self { notebook }
    }

    pub fn add_tab(&self, title: &str, child: &gtk::Widget) -> u32 {
        let label = gtk::Label::new(Some(title));
        let close_btn = gtk::Button::from_icon_name("window-close-symbolic");
        close_btn.add_css_class("flat");

        let tab_box = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(4)
            .build();
        tab_box.append(&label);
        tab_box.append(&close_btn);

        let page_index = self.notebook.append_page(child, Some(&tab_box));
        let nb = self.notebook.clone();
        let c = child.clone();
        close_btn.connect_clicked(move |_| {
            if let Some(idx) = nb.page_num(&c) {
                nb.remove_page(Some(idx));
            }
        });

        page_index
    }

    pub fn widget(&self) -> gtk::Widget {
        self.notebook.clone().upcast()
    }
}
