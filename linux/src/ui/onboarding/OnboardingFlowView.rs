use adw::prelude::*;
use std::rc::Rc;

use super::OnboardingStepView::build_step;
use crate::services::onboarding_store::OnboardingStore;

pub fn build(store: Rc<OnboardingStore>) -> gtk::Widget {
    let main_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(16)
        .margin_start(24)
        .margin_end(24)
        .margin_top(24)
        .margin_bottom(24)
        .valign(gtk::Align::Center)
        .build();

    let step = build_step(
        "Welcome to Draggy",
        "Your private, offline AI assistant running natively with open models.",
        "starred-symbolic",
    );

    let next_btn = gtk::Button::with_label("Get Started");
    next_btn.add_css_class("suggested-action");
    next_btn.add_css_class("pill");
    next_btn.set_halign(gtk::Align::Center);

    let store_clone = Rc::clone(&store);
    next_btn.connect_clicked(move |_| {
        store_clone.next();
    });

    main_box.append(&step);
    main_box.append(&next_btn);

    main_box.upcast()
}
