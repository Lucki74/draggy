use adw::prelude::*;

pub fn build_settings() -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder()
        .title("Updates")
        .description("Configure auto-update channels and checks")
        .build();

    let switch_row = adw::SwitchRow::builder()
        .title("Check for updates automatically")
        .active(true)
        .build();

    group.add(&switch_row);
    group
}
