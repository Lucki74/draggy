//! The saved research runs, for shells that keep no database of their own: keep time, past runs, one run's view.

use std::sync::Arc;

use draggy_storage::{SavedRun, Storage, retention_days};
use serde_json::{Value, json};

use crate::error::CoreError;

/// One saved run in the past-runs list.
#[derive(uniffi::Record, Debug, Clone, PartialEq)]
pub struct PastRunRecord {
    pub id: String,
    pub question: String,
    /// `quick`, `standard` or `deep`.
    pub depth: String,
    /// `done` or `cancelled`.
    pub status: String,
    /// Milliseconds since the epoch.
    pub started_at: i64,
    pub source_count: i64,
    pub note_count: i64,
}

/// The research library in the app data folder.
#[derive(uniffi::Object)]
pub struct ResearchStore {
    pub(crate) storage: Arc<Storage>,
}

fn failed(error: impl std::fmt::Display) -> CoreError {
    CoreError::Internal { message: error.to_string() }
}

/// The run as the shells' run card reads it, the same shape as the live `research_run` step.
fn view_json(saved: &SavedRun) -> String {
    let plan: Value = serde_json::from_str(&saved.plan_json).unwrap_or(Value::Null);
    let questions: Vec<Value> = plan
        .get("subQuestions")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .enumerate()
                .map(|(at, text)| {
                    let notes = saved.notes.iter().filter(|n| usize::try_from(n.sub_question).is_ok_and(|q| q == at + 1)).count();
                    json!({"text": text.as_str().unwrap_or_default(), "notes": notes})
                })
                .collect()
        })
        .unwrap_or_default();
    let hosts: Value = serde_json::from_str(&saved.hosts_json).unwrap_or_else(|_| json!([]));
    let summary = &saved.summary;
    json!({
        "id": summary.id,
        "question": summary.question,
        "depth": summary.depth,
        "startedAt": summary.started_at,
        "endedAt": summary.ended_at,
        "wallMs": summary.ended_at.map_or(0, |end| (end - summary.started_at).max(0)),
        "gathering": false,
        "questions": questions,
        "sources": saved.sources.iter().map(|s| json!({
            "id": s.id, "url": s.url, "title": s.title, "site": s.site,
            "published": s.published, "status": s.status,
        })).collect::<Vec<_>>(),
        "notes": saved.notes.iter().map(|n| json!({
            "id": n.id, "sourceId": n.source_id, "quote": n.quote, "verified": n.verified,
        })).collect::<Vec<_>>(),
        "hosts": hosts,
    })
    .to_string()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

#[uniffi::export]
impl ResearchStore {
    /// Opens the library in `data_dir`, making it on first use.
    #[uniffi::constructor]
    pub fn open(data_dir: String) -> Result<Arc<Self>, CoreError> {
        let storage = Storage::open(std::path::Path::new(&data_dir)).map_err(failed)?;
        Ok(Arc::new(Self { storage: Arc::new(storage) }))
    }

    /// Applies a keep time (`30`, `90` or `forever`) now: runs older than it are deleted. Returns how many went.
    pub fn apply_retention(&self, keep: String) -> Result<u32, CoreError> {
        let removed = self
            .storage
            .apply_research_retention(retention_days(&keep), now_ms())
            .map_err(failed)?;
        Ok(u32::try_from(removed).unwrap_or(u32::MAX))
    }

    /// Saved runs, newest first.
    pub fn list_runs(&self, limit: u32) -> Result<Vec<PastRunRecord>, CoreError> {
        let runs = self.storage.list_research_runs(None, limit as usize).map_err(failed)?;
        Ok(runs
            .into_iter()
            .map(|run| PastRunRecord {
                id: run.id,
                question: run.question,
                depth: run.depth,
                status: run.status,
                started_at: run.started_at,
                source_count: run.source_count,
                note_count: run.note_count,
            })
            .collect())
    }

    /// One run as run-card JSON, or `None` when it is gone.
    pub fn run_view(&self, id: String) -> Result<Option<String>, CoreError> {
        Ok(self.storage.get_research_run(&id).map_err(failed)?.map(|saved| view_json(&saved)))
    }

    /// Deletes one run and any page copies nothing else uses.
    pub fn remove_run(&self, id: String) -> Result<(), CoreError> {
        self.storage.remove_research_run(&id).map_err(failed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use draggy_storage::{NoteSave, RunSave, SourceSave};

    fn run(id: &str, started_at: i64) -> RunSave {
        RunSave {
            id: id.into(),
            question: "Why".into(),
            depth: "quick".into(),
            status: "done".into(),
            plan_json: r#"{"subQuestions":["One","Two"]}"#.into(),
            sub_questions: vec!["One".into(), "Two".into()],
            started_at,
            ended_at: Some(started_at + 500),
            hosts_json: r#"["a.test"]"#.into(),
            sources: vec![SourceSave { id: "s1".into(), url: "https://a.test/p".into(), status: "read".into(), ..Default::default() }],
            notes: vec![NoteSave {
                id: "n1".into(),
                sub_question: 2,
                claim: "c".into(),
                quote: "q".into(),
                source_id: "s1".into(),
                confidence: "high".into(),
                verified: true,
            }],
            ..Default::default()
        }
    }

    #[test]
    fn runs_list_open_and_delete_and_old_ones_expire() {
        let dir = tempfile::tempdir().unwrap();
        let store = ResearchStore::open(dir.path().to_string_lossy().into_owned()).unwrap();
        store.storage.save_research_run(&run("old", 1)).unwrap();
        store.storage.save_research_run(&run("new", now_ms())).unwrap();
        assert_eq!(store.apply_retention("forever".into()).unwrap(), 0);
        assert_eq!(store.list_runs(10).unwrap().len(), 2);
        assert_eq!(store.apply_retention("30".into()).unwrap(), 1);
        let runs = store.list_runs(10).unwrap();
        assert_eq!((runs.len(), runs[0].id.as_str(), runs[0].note_count), (1, "new", 1));
        let view: Value = serde_json::from_str(&store.run_view("new".into()).unwrap().unwrap()).unwrap();
        assert_eq!(view["questions"][1]["notes"], 1);
        assert_eq!(view["sources"][0]["status"], "read");
        assert_eq!(view["hosts"][0], "a.test");
        store.remove_run("new".into()).unwrap();
        assert!(store.run_view("new".into()).unwrap().is_none());
    }
}
