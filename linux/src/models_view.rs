//! The Models page: install the engine, download and pick a model, start the local server and watch it load.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;

use adw::prelude::*;
use draggy_core::{
    DownloadObserver, DownloadProgressRecord, EngineInstaller, InstallObserver,
    InstallProgressRecord, InstalledModelRecord, LibraryModelRecord, LoadObserver, LoadStageRecord,
};
use draggy_linux::models::{self, GPU_MEMORY_GB, remaining_label, size_label, stage_text};
use draggy_linux::runtime::runtime;
use gtk::glib;

use crate::state::AppState;

/// Hands a callback from the core's thread to the main loop.
struct Sink<T>(async_channel::Sender<T>);

impl DownloadObserver for Sink<DownloadProgressRecord> {
    fn on_progress(&self, progress: DownloadProgressRecord) {
        drop(self.0.try_send(progress));
    }
}

impl InstallObserver for Sink<InstallProgressRecord> {
    fn on_progress(&self, progress: InstallProgressRecord) {
        drop(self.0.try_send(progress));
    }
}

impl LoadObserver for Sink<LoadStageRecord> {
    fn on_stage(&self, stage: LoadStageRecord) {
        drop(self.0.try_send(stage));
    }
}

struct Ui {
    state: Rc<AppState>,
    notify: Rc<dyn Fn(&str)>,
    engine_row: adw::ActionRow,
    install: gtk::Button,
    run: gtk::Button,
    status: adw::ActionRow,
    installed: gtk::ListBox,
    results: gtk::ListBox,
    search: gtk::SearchEntry,
    download_row: adw::ActionRow,
    cancel: gtk::Button,
    /// The file being downloaded, once the first progress report names it.
    downloading: RefCell<Option<String>>,
    starting: Cell<bool>,
    installing: Cell<bool>,
    running: Cell<bool>,
    searched: Cell<bool>,
}

fn escape(text: &str) -> String {
    glib::markup_escape_text(text).to_string()
}

fn group(title: &str, description: &str) -> adw::PreferencesGroup {
    adw::PreferencesGroup::builder()
        .title(escape(title))
        .description(escape(description))
        .build()
}

fn list() -> gtk::ListBox {
    gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .build()
}

fn button(label: &str, class: &str) -> gtk::Button {
    gtk::Button::builder()
        .label(label)
        .valign(gtk::Align::Center)
        .css_classes([class])
        .build()
}

fn message_row(text: &str) -> gtk::Label {
    gtk::Label::builder()
        .label(text)
        .wrap(true)
        .xalign(0.0)
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .css_classes(["dim-label"])
        .build()
}

fn replace(list: &gtk::ListBox, rows: &[impl IsA<gtk::Widget>]) {
    while let Some(child) = list.first_child() {
        list.remove(&child);
    }
    for row in rows {
        list.append(row);
    }
}

/// Builds the page. `notify` shows a short message, such as a download that failed.
pub fn build(state: &Rc<AppState>, notify: impl Fn(&str) + 'static) -> gtk::Widget {
    let engine_row = adw::ActionRow::builder()
        .title("llama-server")
        .subtitle("Not installed")
        .build();
    let install = button("Install", "suggested-action");
    let run = button("Start", "suggested-action");
    run.set_sensitive(false);
    engine_row.add_suffix(&install);
    engine_row.add_suffix(&run);
    let status = adw::ActionRow::builder()
        .title("Status")
        .subtitle("Stopped")
        .build();
    let engine_group = group(
        "Engine",
        "The program that runs a model on this computer. It is downloaded once.",
    );
    engine_group.add(&engine_row);
    engine_group.add(&status);

    let installed = list();
    let installed_group = group("Installed models", "Pick one to start it.");
    installed_group.add(&installed);

    let search = gtk::SearchEntry::builder()
        .placeholder_text("Search the library")
        .margin_bottom(6)
        .build();
    let results = list();
    let download_row = adw::ActionRow::builder()
        .title("Downloading")
        .visible(false)
        .build();
    let cancel = button("Cancel", "destructive-action");
    download_row.add_suffix(&cancel);
    let library_group = group(
        "Library",
        "Press Enter to search. An empty search lists the top models.",
    );
    library_group.add(&search);
    library_group.add(&download_row);
    library_group.add(&results);

    let content = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(18)
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .build();
    content.append(&engine_group);
    content.append(&installed_group);
    content.append(&library_group);
    let clamp = adw::Clamp::builder()
        .maximum_size(720)
        .child(&content)
        .build();
    let page = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .child(&clamp)
        .build();

    let ui = Rc::new(Ui {
        state: state.clone(),
        notify: Rc::new(notify),
        engine_row,
        install,
        run,
        status,
        installed,
        results,
        search,
        download_row,
        cancel,
        downloading: RefCell::new(None),
        starting: Cell::new(false),
        installing: Cell::new(false),
        running: Cell::new(false),
        searched: Cell::new(false),
    });

    ui.install.connect_clicked({
        let ui = ui.clone();
        move |_| install_engine(&ui)
    });
    ui.run.connect_clicked({
        let ui = ui.clone();
        move |_| {
            if ui.running.get() {
                stop_engine(&ui);
            } else {
                start_engine(&ui);
            }
        }
    });
    ui.cancel.connect_clicked({
        let ui = ui.clone();
        move |_| {
            let file = ui.downloading.borrow().clone();
            if let (Some(file), Some(library)) = (file, ui.state.library()) {
                library.cancel(file);
            }
        }
    });
    ui.search.connect_activate({
        let ui = ui.clone();
        move |_| search_library(&ui)
    });
    page.connect_map({
        let ui = ui.clone();
        move |_| {
            find_engine(&ui);
            refresh_installed(&ui);
            show_engine_state(&ui);
            if !ui.searched.replace(true) {
                search_library(&ui);
            }
        }
    });
    page.upcast()
}

fn say(ui: &Ui, text: &str) {
    (ui.notify)(text);
}

fn show_engine_state(ui: &Ui) {
    let binary = ui.state.engine_binary.borrow().clone();
    if binary.is_empty() {
        ui.engine_row.set_subtitle("Not installed");
        ui.install.set_label("Install");
    } else {
        ui.engine_row.set_subtitle(&escape(&binary));
        ui.install.set_label("Reinstall");
    }
    ui.install.set_sensitive(!ui.installing.get());
    ui.run
        .set_label(if ui.running.get() { "Stop" } else { "Start" });
    ui.run.set_sensitive(
        !ui.starting.get()
            && (ui.running.get()
                || (!binary.is_empty() && !ui.state.engine_model.borrow().is_empty())),
    );
}

/// Picks up an engine installed by an earlier run, and a server the page already started.
fn find_engine(ui: &Ui) {
    if ui.state.engine_binary.borrow().is_empty()
        && let Some(dir) = models::data_dir()
        && let Ok(installer) = EngineInstaller::new(dir.to_string_lossy().into_owned())
        && let Some(found) = installer.installed()
    {
        *ui.state.engine_binary.borrow_mut() = found.binary_path;
    }
    if let Some(engine) = ui.state.engine_if_started() {
        let state = engine.state();
        if state.running {
            ui.running.set(true);
            let model = state.model.unwrap_or_default();
            ui.status.set_subtitle(&escape(&format!("Running {model}")));
        }
    }
}

fn install_engine(ui: &Rc<Ui>) {
    let Some(dir) = models::data_dir() else {
        say(ui, "There is no data folder for the engine.");
        return;
    };
    ui.installing.set(true);
    show_engine_state(ui);
    let (tx, rx) = async_channel::unbounded::<InstallProgressRecord>();
    glib::spawn_future_local({
        let ui = ui.clone();
        async move {
            while let Ok(progress) = rx.recv().await {
                let text = if progress.phase == "download" {
                    format!("Downloading the engine {:.0}%", progress.percent)
                } else {
                    "Unpacking the engine...".to_owned()
                };
                ui.engine_row.set_subtitle(&escape(&text));
            }
        }
    });
    let task = runtime().spawn(async move {
        let installer = EngineInstaller::new(dir.to_string_lossy().into_owned())?;
        installer.install(GPU_MEMORY_GB, Arc::new(Sink(tx))).await
    });
    glib::spawn_future_local({
        let ui = ui.clone();
        async move {
            match task.await {
                Ok(Ok(done)) => {
                    *ui.state.engine_binary.borrow_mut() = done.binary_path;
                    say(&ui, "The engine is installed.");
                }
                Ok(Err(error)) => say(&ui, &error.to_string()),
                Err(_) => say(&ui, "The install was interrupted."),
            }
            ui.installing.set(false);
            show_engine_state(&ui);
        }
    });
}

fn start_engine(ui: &Rc<Ui>) {
    let binary = ui.state.engine_binary.borrow().clone();
    let model = ui.state.engine_model.borrow().clone();
    if binary.is_empty() || model.is_empty() {
        say(ui, "Install the engine and pick a model first.");
        return;
    }
    ui.starting.set(true);
    show_engine_state(ui);
    let (tx, rx) = async_channel::unbounded::<LoadStageRecord>();
    glib::spawn_future_local({
        let ui = ui.clone();
        async move {
            while let Ok(stage) = rx.recv().await {
                ui.status.set_subtitle(&escape(&stage_text(&stage)));
            }
        }
    });
    let engine = ui.state.engine();
    let task = runtime().spawn(async move {
        let observer: Arc<dyn LoadObserver> = Arc::new(Sink(tx));
        engine
            .start(binary, model, None, GPU_MEMORY_GB, Some(observer))
            .await
    });
    glib::spawn_future_local({
        let ui = ui.clone();
        async move {
            match task.await {
                Ok(Ok(info)) => {
                    {
                        let mut settings = ui.state.settings.borrow_mut();
                        settings.server_url = info.base_url;
                        settings.model = info.model.clone();
                    }
                    ui.running.set(true);
                    ui.status
                        .set_subtitle(&escape(&format!("Running {}", info.model)));
                    if info.projector_refused {
                        say(
                            &ui,
                            "The model's image support was refused, so images will not work.",
                        );
                    }
                }
                Ok(Err(error)) => {
                    ui.status.set_subtitle(&escape(&error.to_string()));
                    say(&ui, &error.to_string());
                }
                Err(_) => say(&ui, "The start was interrupted."),
            }
            ui.starting.set(false);
            show_engine_state(&ui);
        }
    });
}

fn stop_engine(ui: &Rc<Ui>) {
    ui.starting.set(true);
    show_engine_state(ui);
    let engine = ui.state.engine();
    let task = runtime().spawn(async move { engine.stop().await });
    glib::spawn_future_local({
        let ui = ui.clone();
        async move {
            drop(task.await);
            ui.running.set(false);
            ui.starting.set(false);
            ui.status.set_subtitle("Stopped");
            show_engine_state(&ui);
        }
    });
}

fn refresh_installed(ui: &Rc<Ui>) {
    let Some(library) = ui.state.library() else {
        replace(
            &ui.installed,
            &[message_row("The model library could not start.")],
        );
        return;
    };
    match library.installed() {
        Ok(models) if models.is_empty() => {
            replace(&ui.installed, &[message_row("No model is downloaded yet.")]);
        }
        Ok(models) => {
            let rows: Vec<gtk::Widget> = models
                .iter()
                .map(|model| installed_row(ui, model))
                .collect();
            replace(&ui.installed, &rows);
        }
        Err(error) => replace(&ui.installed, &[message_row(&error.to_string())]),
    }
}

fn installed_row(ui: &Rc<Ui>, model: &InstalledModelRecord) -> gtk::Widget {
    let mut detail = size_label(model.bytes);
    if !model.capabilities.is_empty() {
        detail = format!("{detail} · {}", model.capabilities.join(", "));
    }
    let row = adw::ActionRow::builder()
        .title(escape(&model.filename))
        .subtitle(escape(&detail))
        .build();
    let chosen = *ui.state.engine_model.borrow() == model.path;
    let use_button = button(if chosen { "Selected" } else { "Use" }, "suggested-action");
    use_button.set_sensitive(!chosen);
    let delete = gtk::Button::builder()
        .icon_name("user-trash-symbolic")
        .tooltip_text("Delete the file")
        .valign(gtk::Align::Center)
        .css_classes(["flat"])
        .build();
    use_button.connect_clicked({
        let ui = ui.clone();
        let path = model.path.clone();
        move |_| {
            *ui.state.engine_model.borrow_mut() = path.clone();
            refresh_installed(&ui);
            show_engine_state(&ui);
            if !ui.starting.get() && !ui.state.engine_binary.borrow().is_empty() {
                start_engine(&ui);
            }
        }
    });
    delete.connect_clicked({
        let ui = ui.clone();
        let (filename, path) = (model.filename.clone(), model.path.clone());
        move |_| {
            if let Some(library) = ui.state.library() {
                match library.delete(filename.clone()) {
                    Ok(_) => {
                        if *ui.state.engine_model.borrow() == path {
                            ui.state.engine_model.borrow_mut().clear();
                        }
                    }
                    Err(error) => say(&ui, &error.to_string()),
                }
            }
            refresh_installed(&ui);
            show_engine_state(&ui);
        }
    });
    row.add_suffix(&delete);
    row.add_suffix(&use_button);
    row.upcast()
}

fn search_library(ui: &Rc<Ui>) {
    let Some(library) = ui.state.library() else {
        replace(
            &ui.results,
            &[message_row("The model library could not start.")],
        );
        return;
    };
    replace(&ui.results, &[message_row("Searching...")]);
    let query = ui.search.text().trim().to_owned();
    let task = runtime().spawn(async move { library.search(query).await });
    glib::spawn_future_local({
        let ui = ui.clone();
        async move {
            let found = task.await.unwrap_or_default();
            if found.is_empty() {
                replace(&ui.results, &[message_row("No model matches.")]);
                return;
            }
            let rows: Vec<gtk::Widget> =
                found.iter().map(|model| library_row(&ui, model)).collect();
            replace(&ui.results, &rows);
        }
    });
}

fn library_row(ui: &Rc<Ui>, model: &LibraryModelRecord) -> gtk::Widget {
    let mut detail = model.description.clone();
    if !model.sizes.is_empty() {
        detail = format!("{detail}\nSizes: {}", model.sizes.join(", "));
    }
    let row = adw::ActionRow::builder()
        .title(escape(&model.name))
        .subtitle(escape(&detail))
        .subtitle_lines(0)
        .build();
    let get = button("Download", "suggested-action");
    get.connect_clicked({
        let ui = ui.clone();
        let reference = model.name.clone();
        move |_| download(&ui, &reference)
    });
    row.add_suffix(&get);
    row.upcast()
}

fn download(ui: &Rc<Ui>, reference: &str) {
    if ui.downloading.borrow().is_some() || ui.download_row.is_visible() {
        say(ui, "A download is already running.");
        return;
    }
    let Some(library) = ui.state.library() else {
        say(ui, "The model library could not start.");
        return;
    };
    ui.download_row.set_visible(true);
    ui.download_row
        .set_title(&escape(&format!("Downloading {reference}")));
    ui.download_row.set_subtitle("Starting...");
    let (tx, rx) = async_channel::unbounded::<DownloadProgressRecord>();
    glib::spawn_future_local({
        let ui = ui.clone();
        async move {
            while let Ok(progress) = rx.recv().await {
                let mut text =
                    format!("{:.0}% of {}", progress.percent, size_label(progress.total));
                if let Some(left) = remaining_label(progress.remaining_seconds) {
                    text = format!("{text} · {left}");
                }
                ui.download_row.set_subtitle(&escape(&text));
                *ui.downloading.borrow_mut() = Some(progress.filename);
            }
        }
    });
    let reference = reference.to_owned();
    let task = runtime().spawn(async move {
        let observer: Arc<dyn DownloadObserver> = Arc::new(Sink(tx));
        library.download(reference, observer).await
    });
    glib::spawn_future_local({
        let ui = ui.clone();
        async move {
            match task.await {
                Ok(Ok(filename)) => say(&ui, &format!("{filename} is downloaded.")),
                Ok(Err(error)) => say(&ui, &error.to_string()),
                Err(_) => say(&ui, "The download was interrupted."),
            }
            ui.download_row.set_visible(false);
            *ui.downloading.borrow_mut() = None;
            refresh_installed(&ui);
        }
    });
}
