//! GTK can be started from one thread only, and every test runs on its own. The widget tests hand their bodies to one
//! shared thread instead. With no display the bodies are skipped.

use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Mutex, OnceLock};

type Job = Box<dyn FnOnce(bool) + Send>;

static WORKER: OnceLock<Mutex<Sender<Job>>> = OnceLock::new();

fn worker() -> &'static Mutex<Sender<Job>> {
    WORKER.get_or_init(|| {
        let (tx, rx) = channel::<Job>();
        std::thread::spawn(move || {
            let ready = adw::init().is_ok();
            if ready {
                gtk::gio::resources_register_include!("draggy.gresource").expect("resources");
            }
            while let Ok(job) = rx.recv() {
                job(ready);
            }
        });
        Mutex::new(tx)
    })
}

/// Runs the body on the GTK thread and waits for it. A panic in the body fails the calling test.
pub fn run(body: impl FnOnce() + Send + 'static) {
    let (done, wait) = channel();
    let job: Job = Box::new(move |ready| {
        let result = if ready {
            catch_unwind(AssertUnwindSafe(body))
        } else {
            Ok(())
        };
        let _ = done.send(result);
    });
    worker()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .send(job)
        .expect("the GTK thread is running");
    if let Err(panic) = wait.recv().expect("the GTK thread answered") {
        resume_unwind(panic);
    }
}
