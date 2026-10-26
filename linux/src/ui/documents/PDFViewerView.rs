use adw::prelude::*;

pub fn build_pdf_view(path: &str) -> gtk::Widget {
    let vbox = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(8)
        .margin_start(12)
        .margin_end(12)
        .margin_top(8)
        .margin_bottom(8)
        .build();

    let title = gtk::Label::builder()
        .label(&format!("PDF Document: {}", path))
        .css_classes(["title-4"])
        .build();

    let note = gtk::Label::builder()
        .label("Embedded PDF Viewer")
        .css_classes(["dim-label"])
        .build();

    vbox.append(&title);
    vbox.append(&note);

    vbox.upcast()
}
