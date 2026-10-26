use super::search_engine::{search_in_directory, SearchResult};
use std::sync::{Arc, Mutex};

#[derive(Default, Clone)]
pub struct SearchStore {
    pub query: Arc<Mutex<String>>,
    pub results: Arc<Mutex<Vec<SearchResult>>>,
    pub selected_index: Arc<Mutex<Option<usize>>>,
    pub is_searching: Arc<Mutex<bool>>,
}

impl SearchStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_query(&self, q: &str) {
        *self.query.lock().unwrap() = q.to_string();
    }

    pub fn execute_search(&self, root_dir: &str) {
        let q = self.query.lock().unwrap().clone();
        if q.trim().is_empty() {
            self.results.lock().unwrap().clear();
            *self.selected_index.lock().unwrap() = None;
            return;
        }

        *self.is_searching.lock().unwrap() = true;
        let res = search_in_directory(root_dir, &q, 100);
        *self.results.lock().unwrap() = res;
        *self.selected_index.lock().unwrap() = if !self.results.lock().unwrap().is_empty() {
            Some(0)
        } else {
            None
        };
        *self.is_searching.lock().unwrap() = false;
    }

    pub fn get_results(&self) -> Vec<SearchResult> {
        self.results.lock().unwrap().clone()
    }
}
