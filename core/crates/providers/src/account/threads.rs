//! Matches a request to the runtime thread that has already seen its start, by the stored messages' `draggy_ref`s and
//! never the wire, whose time note and skills change on every turn.

use std::collections::HashMap;

use serde_json::{Map, Value, json};
use tracing::debug;

use crate::js::truthy;

/// The reference hash of a list of refs: SHA-256 over the JSON of `[[id, hash], ...]`, as hex.
pub fn hash_refs(refs: &[Value]) -> String {
    let pairs: Vec<Value> = refs
        .iter()
        .map(|reference| {
            json!([
                reference.get("id").cloned().unwrap_or(Value::Null),
                reference.get("hash").cloned().unwrap_or(Value::Null),
            ])
        })
        .collect();
    let text = serde_json::to_string(&pairs).unwrap_or_default();
    ring::digest::digest(&ring::digest::SHA256, text.as_bytes())
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Where each stored message sits in the request, since the wire adds the system prompt and a summary between them.
fn ref_indexes(messages: &[Value]) -> Vec<usize> {
    messages
        .iter()
        .enumerate()
        .filter(|(_, message)| truthy(message.get("draggy_ref")))
        .map(|(index, _)| index)
        .collect()
}

fn refs_at(messages: &[Value], indexes: &[usize]) -> Vec<Value> {
    indexes
        .iter()
        .map(|&i| messages[i]["draggy_ref"].clone())
        .collect()
}

/// The state the latest message tagged for this instance carries; `None` when there is none.
pub fn latest_state(messages: &[Value], instance_id: &str) -> Option<Value> {
    for message in messages.iter().rev() {
        let tagged = &message["provider_state"];
        if tagged["instanceId"].as_str() == Some(instance_id) {
            return tagged
                .get("state")
                .filter(|state| !state.is_null())
                .cloned();
        }
    }
    None
}

/// The history to inject, and the user's input that starts the turn.
#[derive(Debug, Clone, PartialEq)]
pub struct Split {
    pub history: Vec<Value>,
    pub input: Option<Value>,
}

/// Splits what a thread has to be told into history and the user's input, which is the last message when it is a user's.
pub fn split(messages: &[Value]) -> Split {
    let body: Vec<Value> = messages
        .iter()
        .filter(|m| m["role"].as_str() != Some("system"))
        .cloned()
        .collect();
    match body.last() {
        Some(last) if last["role"].as_str() == Some("user") => {
            let input = last.clone();
            Split {
                history: body[..body.len() - 1].to_vec(),
                input: Some(input),
            }
        }
        _ => Split {
            history: body,
            input: None,
        },
    }
}

/// A stored state that its own messages still vouch for, and what came after it.
#[derive(Debug, Clone, PartialEq)]
pub struct Stored {
    pub state: Value,
    pub history: Vec<Value>,
    pub input: Option<Value>,
}

/// What a plan says to do: resume the live thread with only the new input, or start a thread from the transcript.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub id: Option<String>,
    pub history: Vec<Value>,
    pub input: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Live {
    consumed: u64,
    prefix_hash: String,
}

/// Threads for one instance. A thread missing here is gone from the runtime too, after a restart or a stop.
pub struct Threads {
    instance_id: String,
    key: String,
    live: HashMap<String, Live>,
}

impl Threads {
    /// `key` is what the runtime calls its thread: `threadId` for Codex, `sessionId` for the others.
    pub fn new(instance_id: &str, key: &str) -> Self {
        Self {
            instance_id: instance_id.to_owned(),
            key: key.to_owned(),
            live: HashMap::new(),
        }
    }

    /// The latest state this request's own messages still vouch for, live or not, and what came after it.
    pub fn stored(&self, messages: &[Value]) -> Option<Stored> {
        let state = latest_state(messages, &self.instance_id)?;
        let indexes = ref_indexes(messages);
        if !truthy(state.get(&self.key)) {
            return None;
        }
        let consumed = state.get("consumed")?.as_u64()?;
        let prefix = state.get("prefixHash")?.as_str()?;
        if consumed > indexes.len() as u64 {
            return None;
        }
        let used = consumed as usize;
        if hash_refs(&refs_at(messages, &indexes[..used])) != prefix {
            return None;
        }
        let after = if used == 0 { 0 } else { indexes[used - 1] + 1 };
        let own = state.get(&self.key).cloned();
        // The thread wrote its own replies, so they are not news to it; another provider's are.
        let fresh: Vec<Value> = messages[after..]
            .iter()
            .filter(|message| message["provider_state"]["state"].get(&self.key) != own.as_ref())
            .cloned()
            .collect();
        let rest = split(&fresh);
        Some(Stored {
            state,
            history: rest.history,
            input: rest.input,
        })
    }

    pub fn plan(&self, messages: &[Value]) -> Plan {
        let found = self.stored(messages);
        let resumed = found.as_ref().is_some_and(|found| {
            let id = found
                .state
                .get(&self.key)
                .and_then(Value::as_str)
                .unwrap_or_default();
            let consumed = found.state.get("consumed").and_then(Value::as_u64);
            let prefix = found.state.get("prefixHash").and_then(Value::as_str);
            self.live.get(id).is_some_and(|seen| {
                Some(seen.consumed) == consumed && Some(seen.prefix_hash.as_str()) == prefix
            })
        });
        debug!(target: "providers.account", key = %self.key, resumed, messages = messages.len(), "thread plan");
        match (resumed, found) {
            (true, Some(found)) => Plan {
                id: found
                    .state
                    .get(&self.key)
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                history: found.history,
                input: found.input,
            },
            _ => {
                let rest = split(messages);
                Plan {
                    id: None,
                    history: rest.history,
                    input: rest.input,
                }
            }
        }
    }

    /// Called once a turn completes: the state to persist, and the record that the thread is live.
    pub fn record(&mut self, id: &str, messages: &[Value]) -> Value {
        let indexes = ref_indexes(messages);
        let refs = refs_at(messages, &indexes);
        let entry = Live {
            consumed: refs.len() as u64,
            prefix_hash: hash_refs(&refs),
        };
        let mut state = Map::new();
        state.insert(self.key.clone(), json!(id));
        state.insert("consumed".to_owned(), json!(entry.consumed));
        state.insert("prefixHash".to_owned(), json!(entry.prefix_hash));
        self.live.insert(id.to_owned(), entry);
        json!({ "instanceId": self.instance_id, "state": Value::Object(state) })
    }

    /// A stopped or failed turn leaves the thread in a state no stored message describes, so it is not reused.
    pub fn forget(&mut self, id: &str) {
        self.live.remove(id);
    }

    pub fn clear(&mut self) {
        self.live.clear();
    }
}

/// Whether the earlier messages are the start of this request, by their refs: another conversation's state never is.
pub fn same_conversation(earlier: &[Value], messages: &[Value]) -> bool {
    let ids = |list: &[Value]| -> Vec<Value> {
        list.iter()
            .filter(|message| truthy(message.get("draggy_ref")))
            .map(|message| message["draggy_ref"]["id"].clone())
            .collect()
    };
    let before = ids(earlier);
    let now = ids(messages);
    !before.is_empty()
        && before
            .iter()
            .enumerate()
            .all(|(i, id)| now.get(i) == Some(id))
}
