use adw::prelude::*;

pub fn build_view() -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder()
        .title("Cloud Voice (TTS)")
        .description("Consent is required before text is sent to cloud synthesis providers.")
        .build();

    let switch = adw::SwitchRow::builder()
        .title("ElevenLabs Consent")
        .subtitle("Allow sending message text to ElevenLabs")
        .active(false)
        .build();

    group.add(&switch);
    group
}
