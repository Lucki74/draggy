pub struct Earcons;

impl Earcons {
    pub fn play_listening() {
        if let Err(error) = std::process::Command::new("canberra-gtk-play")
            .args(["-i", "dialog-information"])
            .spawn()
        {
            tracing::debug!(target: "linux.chat", kind = ?error.kind(), "listening earcon could not play");
        }
    }

    pub fn play_done() {
        if let Err(error) = std::process::Command::new("canberra-gtk-play")
            .args(["-i", "complete"])
            .spawn()
        {
            tracing::debug!(target: "linux.chat", kind = ?error.kind(), "done earcon could not play");
        }
    }
}
