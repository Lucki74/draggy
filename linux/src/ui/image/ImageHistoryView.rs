use adw::prelude::*;
use crate::services::image_engine::GeneratedImage;

pub fn build_history_list(images: &[GeneratedImage]) -> gtk::ListBox {
    let list_box = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::Single)
        .build();
    list_box.add_css_class("boxed-list");

    for img in images {
        let row = gtk::ListBoxRow::new();
        let hbox = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(8)
            .margin_start(8)
            .margin_end(8)
            .margin_top(4)
            .margin_bottom(4)
            .build();

        let icon = gtk::Image::from_icon_name("image-x-generic-symbolic");
        let lbl = gtk::Label::builder()
            .label(&img.prompt)
            .ellipsize(gtk::pango::EllipsizeMode::End)
            .xalign(0.0)
            .build();

        hbox.append(&icon);
        hbox.append(&lbl);
        row.set_child(Some(&hbox));
        list_box.append(&row);
    }

    list_box
}
