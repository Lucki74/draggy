use adw::prelude::*;
use std::rc::Rc;

use super::FileExplorerView::FileExplorerWidget;

pub fn build(root_path: &str) -> gtk::Widget {
    let main_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .vexpand(true)
        .hexpand(true)
        .build();

    let header = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(6)
        .margin_start(8)
        .margin_end(8)
        .margin_top(4)
        .margin_bottom(4)
        .build();

    let title = gtk::Label::builder()
        .label("Files")
        .css_classes(["title-4"])
        .build();

    let refresh_btn = gtk::Button::from_icon_name("view-refresh-symbolic");
    refresh_btn.set_tooltip_text(Some("Refresh Directory"));

    header.append(&title);
    let spacer = gtk::Box::builder().hexpand(true).build();
    header.append(&spacer);
    header.append(&refresh_btn);

    let explorer = Rc::new(FileExplorerWidget::new(root_path));

    main_box.append(&header);
    main_box.append(&explorer.widget());

    main_box.upcast()
}
