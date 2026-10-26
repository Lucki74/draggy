use adw::prelude::*;

pub fn build_lightbox(file_path: &str) -> gtk::Widget {
    let picture = gtk::Picture::for_filename(file_path);
    picture.set_can_shrink(true);
    picture.upcast()
}
