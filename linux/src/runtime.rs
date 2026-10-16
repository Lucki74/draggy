//! One tokio runtime for the shell's own async work (the keyring). The core runs its own threads.

use std::sync::OnceLock;

use tokio::runtime::Runtime;

pub fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("draggy-shell")
            .enable_all()
            .build()
            .expect("the shell runtime starts")
    })
}
