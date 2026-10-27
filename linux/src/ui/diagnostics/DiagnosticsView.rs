use crate::services::hardware_probe::probe_linux_hardware;
use crate::services::tier_planner::plan_tier;
use adw::prelude::*;

pub fn build() -> gtk::Widget {
    let main_box = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_start(16)
        .margin_end(16)
        .margin_top(12)
        .margin_bottom(12)
        .build();

    let title = gtk::Label::builder()
        .label("Hardware Diagnostics")
        .css_classes(["title-2"])
        .xalign(0.0)
        .build();

    let info = probe_linux_hardware();
    let tier = plan_tier(&info);

    let pref_group = adw::PreferencesGroup::builder()
        .title("System Specs")
        .build();

    let cores_row = adw::ActionRow::builder()
        .title("CPU Cores")
        .subtitle(&info.cpu_cores.to_string())
        .build();

    let ram_row = adw::ActionRow::builder()
        .title("Memory")
        .subtitle(&format!("{} GB", info.ram_gb))
        .build();

    let tier_row = adw::ActionRow::builder()
        .title("Recommended Tier")
        .subtitle(&format!("{} ({})", tier.tier, tier.parameter_range))
        .build();

    pref_group.add(&cores_row);
    pref_group.add(&ram_row);
    pref_group.add(&tier_row);

    main_box.append(&title);
    main_box.append(&pref_group);

    main_box.upcast()
}
