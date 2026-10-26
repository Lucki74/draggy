use adw::prelude::*;

pub fn build_palette() -> gtk::Widget {
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(8)
        .margin_start(12)
        .margin_end(12)
        .margin_top(12)
        .margin_bottom(12)
        .build();

    let search = gtk::SearchEntry::builder()
        .placeholder_text("Type command...")
        .build();

    let list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::Single)
        .build();

    vbox.append(&search);
    vbox.append(&list);
    vbox.upcast()
}
