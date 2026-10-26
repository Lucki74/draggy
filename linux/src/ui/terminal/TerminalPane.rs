use adw::prelude::*;
use std::rc::Rc;

use super::TerminalTabs::TerminalTabsWidget;
use super::TerminalView::TerminalViewWidget;

pub fn build() -> gtk::Widget {
    let main_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .vexpand(true)
        .hexpand(true)
        .build();

    let header_bar = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(6)
        .margin_start(8)
        .margin_end(8)
        .margin_top(4)
        .margin_bottom(4)
        .build();

    let title = gtk::Label::builder()
        .label("Terminal")
        .css_classes(["title-4"])
        .build();

    let new_tab_btn = gtk::Button::from_icon_name("tab-new-symbolic");
    new_tab_btn.set_tooltip_text(Some("New Terminal Tab"));

    header_bar.append(&title);
    let spacer = gtk::Box::builder().hexpand(true).build();
    header_bar.append(&spacer);
    header_bar.append(&new_tab_btn);

    let tabs = Rc::new(TerminalTabsWidget::new());

    let initial_view = TerminalViewWidget::new();
    tabs.add_tab("Shell 1", &initial_view.widget());

    let tabs_clone = Rc::clone(&tabs);
    new_tab_btn.connect_clicked(move |_| {
        let count = tabs_clone.notebook.n_pages() + 1;
        let view = TerminalViewWidget::new();
        tabs_clone.add_tab(&format!("Shell {}", count), &view.widget());
    });

    main_box.append(&header_bar);
    main_box.append(&tabs.widget());

    main_box.upcast()
}
