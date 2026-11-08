//! Runs one command inside a Windows AppContainer from a JSON spec and returns its exit code. It fails closed:
//! any error stops before the command starts, so nothing here ever runs it unsandboxed.

mod spec;

#[cfg(windows)]
mod container;
#[cfg(windows)]
mod grant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // `--grant` sets up folder access and starts nothing, so a slow first grant has no command timeout.
    let grant_only = args.get(1).is_some_and(|flag| flag == "--grant");
    let Some(path) = args.get(if grant_only { 2 } else { 1 }) else {
        eprintln!("usage: draggy-sandbox [--grant] <spec.json>");
        std::process::exit(64);
    };
    let spec = match spec::load(path) {
        Ok(spec) => spec,
        Err(message) => {
            eprintln!("sandbox: {message}");
            std::process::exit(65);
        }
    };
    // The spec is single use; it is gone before the command starts.
    let _ = std::fs::remove_file(path);
    #[cfg(windows)]
    std::process::exit(if grant_only {
        container::grant_only(&spec)
    } else {
        container::run(&spec)
    });
    #[cfg(not(windows))]
    {
        let _ = spec;
        eprintln!("sandbox: this launcher only runs on Windows");
        std::process::exit(66);
    }
}
