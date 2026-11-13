// A console window behind the release build would just be noise.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    draggy_win::run();
}
