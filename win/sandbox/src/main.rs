//! Runs one command inside a Windows AppContainer from a JSON spec and returns its exit code. It fails closed:
//! any error stops before the command starts, so nothing here ever runs it unsandboxed.

mod spec;

#[cfg(windows)]
mod container;
#[cfg(windows)]
mod diagnose;
#[cfg(windows)]
mod grant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    #[cfg(windows)]
    if args.get(1).is_some_and(|flag| flag == "--diagnose-child") {
        std::process::exit(diagnose::child());
    }
    // `--list-folders <folder>...` runs as administrator, once, for folders such as C:\Users that the user cannot
    // change: containers may then list them, and nothing below them.
    #[cfg(windows)]
    if args.get(1).is_some_and(|flag| flag == "--list-folders") {
        std::process::exit(container::list_folders(&args[2..]));
    }
    // `--grant` sets up folder access and starts nothing, so a slow first grant has no command timeout.
    let grant_only = args.get(1).is_some_and(|flag| flag == "--grant");
    // `--diagnose` reports what the container can reach on the way to the working folder (dev tooling).
    let diagnose = args.get(1).is_some_and(|flag| flag == "--diagnose");
    let Some(path) = args.get(if grant_only || diagnose { 2 } else { 1 }) else {
        eprintln!("usage: draggy-sandbox [--grant | --diagnose] <spec.json>");
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
    std::process::exit(if diagnose {
        diagnose::run(&spec)
    } else if grant_only {
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
