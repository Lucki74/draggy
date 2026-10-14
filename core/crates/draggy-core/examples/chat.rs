//! A command-line chat against a running OpenAI-compatible server, such as `llama-server`.
//!
//! ```text
//! cargo run -p draggy-core --example chat -- --model <name> [--url http://127.0.0.1:8080/v1] [--folder <dir>] "<prompt>"
//! ```
//!
//! With `--folder` the model gets `read_file` and `list_directory` inside that folder. Escape-style stopping is
//! Ctrl-C here. The harness attaches to a server that is already running; it does not start one.

use std::sync::{Arc, Mutex};

use draggy_core::{CancelToken, Session, SessionConfig, TurnEventRecord, TurnObserver};

#[derive(Default)]
struct Printer {
    shown: Mutex<usize>,
    steps: Mutex<Vec<String>>,
}

impl TurnObserver for Printer {
    fn on_events(&self, events: Vec<TurnEventRecord>) {
        for event in events {
            match event {
                TurnEventRecord::Patch {
                    text_content,
                    steps,
                    ..
                } => {
                    let mut shown = self.shown.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(fresh) = text_content.get(*shown..) {
                        print!("{fresh}");
                        *shown = text_content.len();
                    }
                    self.note_steps(&steps);
                }
                TurnEventRecord::Steps { steps } => self.note_steps(&steps),
                TurnEventRecord::Metrics { metrics } => {
                    eprintln!(
                        "\n[{} prompt tokens, {} reply tokens, {:.1} tok/s]",
                        metrics.prompt_tokens, metrics.response_tokens, metrics.tokens_per_second
                    );
                }
                TurnEventRecord::OutOfContext { .. } | TurnEventRecord::Live { .. } => {}
            }
        }
    }
}

impl Printer {
    fn note_steps(&self, steps: &[draggy_core::StepRecord]) {
        let mut seen = self.steps.lock().unwrap_or_else(|e| e.into_inner());
        for step in steps {
            let line = format!(
                "{} {}",
                step.kind,
                step.content.as_deref().unwrap_or_default()
            );
            if step.is_complete == Some(true) && !seen.contains(&line) {
                eprintln!("[{line}]");
                seen.push(line);
            }
        }
    }
}

fn main() -> Result<(), String> {
    let mut url = "http://127.0.0.1:8080/v1".to_owned();
    let mut model = String::new();
    let mut folder = None;
    let mut prompt = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--url" => url = args.next().unwrap_or(url),
            "--model" => model = args.next().unwrap_or_default(),
            "--folder" => folder = args.next(),
            _ => prompt.push(arg),
        }
    }
    if model.is_empty() || prompt.is_empty() {
        return Err(
            "usage: chat --model <name> [--url <base>] [--folder <dir>] <prompt>".to_owned(),
        );
    }

    let session = Session::new(SessionConfig {
        base_url: url,
        model,
        api_key: std::env::var("DRAGGY_API_KEY").ok(),
        folder,
        context_tokens: None,
        loop_limit: None,
        allow_commands: false,
        permission_mode: None,
    })
    .map_err(|error| error.to_string())?;

    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .map_err(|error| error.to_string())?;
    let observer: Arc<dyn TurnObserver> = Arc::new(Printer::default());
    let outcome = runtime
        .block_on(session.send(prompt.join(" "), observer, None, CancelToken::new()))
        .map_err(|error| error.to_string())?;
    println!();
    if outcome.exhausted {
        eprintln!("[stopped after {} passes]", outcome.loops);
    }
    Ok(())
}
