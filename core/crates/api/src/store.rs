//! Responses kept in memory, so `previous_response_id` and the `GET` and `DELETE` routes can find them.

use std::collections::{HashMap, VecDeque};

use serde_json::Value;

/// How many responses are kept. The oldest goes first.
pub const CAPACITY: usize = 256;

/// One kept response: the chat so far, the items its request carried, and the response object.
#[derive(Debug, Clone, PartialEq)]
pub struct Stored {
    pub messages: Vec<Value>,
    pub input: Vec<Value>,
    pub response: Value,
}

#[derive(Debug, Default)]
pub struct Store {
    order: VecDeque<String>,
    items: HashMap<String, Stored>,
}

impl Store {
    pub fn put(&mut self, id: &str, stored: Stored) {
        if self.items.insert(id.to_owned(), stored).is_some() {
            self.order.retain(|have| have != id);
        }
        self.order.push_back(id.to_owned());
        while self.order.len() > CAPACITY {
            if let Some(oldest) = self.order.pop_front() {
                self.items.remove(&oldest);
            }
        }
    }

    pub fn get(&self, id: &str) -> Option<&Stored> {
        self.items.get(id)
    }

    /// Whether `id` was kept.
    pub fn remove(&mut self, id: &str) -> bool {
        self.order.retain(|have| have != id);
        self.items.remove(id).is_some()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn stored(n: usize) -> Stored {
        Stored { messages: Vec::new(), input: Vec::new(), response: json!(n) }
    }

    #[test]
    fn the_oldest_response_goes_first() {
        let mut store = Store::default();
        for n in 0..CAPACITY + 2 {
            store.put(&format!("r{n}"), stored(n));
        }
        assert!(store.get("r0").is_none() && store.get("r1").is_none());
        assert!(store.get("r2").is_some() && store.get(&format!("r{}", CAPACITY + 1)).is_some());
    }

    #[test]
    fn a_response_put_again_is_the_newest() {
        let mut store = Store::default();
        store.put("a", stored(1));
        store.put("b", stored(2));
        store.put("a", stored(3));
        for n in 0..CAPACITY - 1 {
            store.put(&format!("x{n}"), stored(n));
        }
        assert!(store.get("a").is_some() && store.get("b").is_none());
        assert!(store.remove("a") && !store.remove("a"));
    }
}
