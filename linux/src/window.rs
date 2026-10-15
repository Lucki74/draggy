//! The main window: a split view with the sections on the left and the section's page on the right.

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk::{gio, glib};

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/com/draggy/Draggy/window.ui")]
    pub struct DraggyWindow {
        #[template_child]
        pub toasts: TemplateChild<adw::ToastOverlay>,
        #[template_child]
        pub split: TemplateChild<adw::NavigationSplitView>,
        #[template_child]
        pub sections: TemplateChild<gtk::ListBox>,
        #[template_child]
        pub pages: TemplateChild<gtk::Stack>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for DraggyWindow {
        const NAME: &'static str = "DraggyWindow";
        type Type = super::DraggyWindow;
        type ParentType = adw::ApplicationWindow;

        fn class_init(class: &mut Self::Class) {
            class.bind_template();
        }

        fn instance_init(object: &glib::subclass::InitializingObject<Self>) {
            object.init_template();
        }
    }

    impl ObjectImpl for DraggyWindow {
        fn constructed(&self) {
            self.parent_constructed();
            let pages = self.pages.clone();
            let split = self.split.clone();
            self.sections.connect_row_selected(move |_, row| {
                if let Some(row) = row {
                    pages.set_visible_child_name(&row.widget_name());
                    split.set_show_content(true);
                }
            });
            if let Some(first) = self.sections.row_at_index(0) {
                self.sections.select_row(Some(&first));
            }
        }
    }

    impl WidgetImpl for DraggyWindow {}
    impl WindowImpl for DraggyWindow {}
    impl ApplicationWindowImpl for DraggyWindow {}
    impl AdwApplicationWindowImpl for DraggyWindow {}
}

glib::wrapper! {
    pub struct DraggyWindow(ObjectSubclass<imp::DraggyWindow>)
        @extends adw::ApplicationWindow, gtk::ApplicationWindow, gtk::Window, gtk::Widget,
        @implements gio::ActionGroup, gio::ActionMap, gtk::Accessible, gtk::Buildable,
            gtk::ConstraintTarget, gtk::Native, gtk::Root, gtk::ShortcutManager;
}

impl DraggyWindow {
    pub fn new(app: &adw::Application) -> Self {
        glib::Object::builder().property("application", app).build()
    }

    /// Shows a short message at the bottom of the window.
    pub fn toast(&self, text: &str) {
        self.imp().toasts.add_toast(adw::Toast::new(text));
    }
}
