pub struct Earcons;

impl Earcons {
    pub fn play_listening() {
        let _ = std::process::Command::new("canberra-gtk-play")
            .args(["-i", "dialog-information"])
            .spawn();
    }

    pub fn play_done() {
        let _ = std::process::Command::new("canberra-gtk-play")
            .args(["-i", "complete"])
            .spawn();
    }
}
