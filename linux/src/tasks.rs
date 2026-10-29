//! The background tasks of a chat as the chip under the last reply and the Tasks list show them. The logic is here, with
//! no widget, so it can be checked without a display.

use std::collections::HashSet;

use draggy_core::TaskRecord;

/// The tasks still running.
pub fn running_count(tasks: &[TaskRecord]) -> usize {
    tasks.iter().filter(|task| task.status == "running").count()
}

/// The failed tasks the person has not looked at yet.
pub fn unacknowledged_failures(tasks: &[TaskRecord], acknowledged: &HashSet<String>) -> usize {
    tasks
        .iter()
        .filter(|task| task.status == "failed" && !acknowledged.contains(&task.id))
        .count()
}

/// Marks the failed tasks as looked at. Called when the person opens the Tasks list.
pub fn acknowledge_failures(tasks: &[TaskRecord], acknowledged: &mut HashSet<String>) {
    acknowledged.extend(
        tasks
            .iter()
            .filter(|task| task.status == "failed")
            .map(|task| task.id.clone()),
    );
}

/// The chip's line: "2 running", "1 failed", or both. `None` when there is nothing to show.
pub fn chip_label(running: usize, failed: usize) -> Option<String> {
    match (running, failed) {
        (0, 0) => None,
        (running, 0) => Some(format!("{running} running")),
        (0, failed) => Some(format!("{failed} failed")),
        (running, failed) => Some(format!("{running} running · {failed} failed")),
    }
}

/// Whether the chip takes the alert colour: a failure nobody has looked at yet.
pub fn chip_alarm(failed: usize) -> bool {
    failed > 0
}

/// A task's status as the list shows it.
pub fn status_text(status: &str, exit_code: Option<i32>) -> String {
    match (status, exit_code) {
        ("exited", _) => "done".to_owned(),
        ("failed", Some(code)) => format!("failed, exit code {code}"),
        ("failed", None) => "failed".to_owned(),
        ("stopped", _) => "stopped".to_owned(),
        (other, _) => other.to_owned(),
    }
}

/// How long a task has run, such as "45s", "3m 5s" or "2h 10m".
pub fn runtime_text(running_for_ms: u64) -> String {
    let seconds = running_for_ms.saturating_add(500) / 1000;
    if seconds < 60 {
        return format!("{seconds}s");
    }
    let minutes = seconds / 60;
    if minutes < 60 {
        format!("{minutes}m {}s", seconds % 60)
    } else {
        format!("{}h {}m", minutes / 60, minutes % 60)
    }
}

/// The line under a task's command in the list: its status and how long it has run.
pub fn task_meta(task: &TaskRecord) -> String {
    format!(
        "{} · {}",
        status_text(&task.status, task.exit_code),
        runtime_text(task.running_for_ms)
    )
}

/// Whether a chat watches its tasks: a folder is open and the model may run commands in it. Only such a session can
/// start a background task.
pub fn watches_tasks(folder: &str, allow_commands: bool) -> bool {
    allow_commands && !folder.trim().is_empty()
}

/// Whether the chip refreshes on a timer: only while a watched chat has a task running or the Tasks list is open.
/// Without either there is nothing to change, so no timer runs.
pub fn keeps_polling(watching: bool, running: usize, list_open: bool) -> bool {
    watching && (running > 0 || list_open)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: &str, status: &str, exit_code: Option<i32>, running_for_ms: u64) -> TaskRecord {
        TaskRecord {
            id: id.to_owned(),
            command: format!("cmd {id}"),
            status: status.to_owned(),
            exit_code,
            running_for_ms,
            last_line: String::new(),
        }
    }

    #[test]
    fn running_and_unseen_failures_are_counted_apart() {
        let tasks = [
            task("a", "running", None, 0),
            task("b", "failed", Some(2), 0),
            task("c", "exited", Some(0), 0),
            task("d", "failed", Some(1), 0),
        ];
        assert_eq!(running_count(&tasks), 1);
        let mut seen = HashSet::new();
        assert_eq!(unacknowledged_failures(&tasks, &seen), 2);
        seen.insert("b".to_owned());
        assert_eq!(unacknowledged_failures(&tasks, &seen), 1);
    }

    #[test]
    fn opening_the_list_acknowledges_only_the_failures() {
        let tasks = [
            task("a", "running", None, 0),
            task("b", "failed", Some(2), 0),
        ];
        let mut seen = HashSet::new();
        acknowledge_failures(&tasks, &mut seen);
        assert!(seen.contains("b"));
        assert!(!seen.contains("a"));
        assert_eq!(unacknowledged_failures(&tasks, &seen), 0);
    }

    #[test]
    fn the_chip_says_what_is_running_or_failed() {
        assert_eq!(chip_label(0, 0), None);
        assert_eq!(chip_label(2, 0).as_deref(), Some("2 running"));
        assert_eq!(chip_label(0, 1).as_deref(), Some("1 failed"));
        assert_eq!(chip_label(1, 3).as_deref(), Some("1 running · 3 failed"));
        assert!(chip_alarm(1));
        assert!(!chip_alarm(0));
    }

    #[test]
    fn statuses_read_as_people_say_them() {
        assert_eq!(status_text("running", None), "running");
        assert_eq!(status_text("exited", Some(0)), "done");
        assert_eq!(status_text("failed", Some(2)), "failed, exit code 2");
        assert_eq!(status_text("failed", None), "failed");
        assert_eq!(status_text("stopped", None), "stopped");
        assert_eq!(status_text("odd", None), "odd");
    }

    #[test]
    fn runtimes_round_to_the_second_and_step_up_the_units() {
        assert_eq!(runtime_text(0), "0s");
        assert_eq!(runtime_text(499), "0s");
        assert_eq!(runtime_text(1500), "2s");
        assert_eq!(runtime_text(59_000), "59s");
        assert_eq!(runtime_text(185_000), "3m 5s");
        assert_eq!(runtime_text(7_800_000), "2h 10m");
        assert_eq!(runtime_text(259_200_000), "72h 0m");
        assert_eq!(runtime_text(u64::MAX), "5124095576030h 25m");
    }

    #[test]
    fn a_task_line_shows_status_and_runtime() {
        let mut finished = task("a", "failed", Some(3), 65_000);
        assert_eq!(task_meta(&finished), "failed, exit code 3 · 1m 5s");
        finished.status = "running".to_owned();
        finished.exit_code = None;
        assert_eq!(task_meta(&finished), "running · 1m 5s");
    }

    #[test]
    fn only_a_chat_with_a_folder_and_commands_is_watched() {
        assert!(watches_tasks("/home/me/project", true));
        assert!(!watches_tasks("/home/me/project", false));
        assert!(!watches_tasks("   ", true));
        assert!(!watches_tasks("", false));
    }

    #[test]
    fn the_timer_runs_only_for_running_tasks_or_an_open_list() {
        assert!(keeps_polling(true, 1, false));
        assert!(keeps_polling(true, 0, true));
        assert!(!keeps_polling(true, 0, false));
        assert!(!keeps_polling(false, 2, true));
    }
}
