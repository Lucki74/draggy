/** Matches a request to the runtime thread that has already seen its start, by the stored messages'
 * `draggy_ref`s and never the wire, whose time note and skills change on every turn (spec §4.3). */
const crypto = require("node:crypto");

function hashRefs(refs) {
  return crypto.createHash("sha256").update(JSON.stringify(refs.map((ref) => [ref.id, ref.hash]))).digest("hex");
}

/** Where each stored message sits in the request, since the wire adds the system prompt and a summary between them. */
function refIndexes(messages) {
  const indexes = [];
  messages.forEach((message, index) => {
    if (message.draggy_ref) indexes.push(index);
  });
  return indexes;
}

function latestState(messages, instanceId) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const tagged = messages[i].provider_state;
    if (tagged && tagged.instanceId === instanceId) return tagged.state ?? null;
  }
  return null;
}

/** Splits what a thread has to be told into history to inject and the user's input that starts the turn. */
function split(messages) {
  const body = messages.filter((message) => message.role !== "system");
  const last = body[body.length - 1];
  return last && last.role === "user" ? { history: body.slice(0, -1), input: last } : { history: body, input: null };
}

/** `key` is what the runtime calls its thread: `threadId` for Codex, `sessionId` for the others. */
function createThreads({ instanceId, key }) {
  // Threads are ephemeral, so one missing here is gone from the runtime too, after a restart or a stop.
  const live = new Map();

  /** The latest state this request's own messages still vouch for, live or not, and what came after it. */
  function stored(messages) {
    const state = latestState(messages, instanceId);
    const indexes = refIndexes(messages);
    const matches =
      state?.[key] &&
      state.consumed <= indexes.length &&
      hashRefs(indexes.slice(0, state.consumed).map((i) => messages[i].draggy_ref)) === state.prefixHash;
    if (!matches) return null;

    const after = state.consumed === 0 ? 0 : indexes[state.consumed - 1] + 1;
    // The thread wrote its own replies, so they are not news to it; another provider's are.
    const fresh = messages.slice(after).filter((message) => message.provider_state?.state?.[key] !== state[key]);
    return { state, ...split(fresh) };
  }

  function plan(messages) {
    const found = stored(messages);
    const seen = found && live.get(found.state[key]);
    if (!seen || seen.consumed !== found.state.consumed || seen.prefixHash !== found.state.prefixHash) return { id: null, ...split(messages) };
    return { id: found.state[key], history: found.history, input: found.input };
  }

  /** Called once a turn completes: the state to persist, and the record that it is live. */
  function record(id, messages) {
    const refs = refIndexes(messages).map((i) => messages[i].draggy_ref);
    const entry = { consumed: refs.length, prefixHash: hashRefs(refs) };
    live.set(id, entry);
    return { instanceId, state: { [key]: id, ...entry } };
  }

  /** A stopped or failed turn leaves the thread in a state no stored message describes, so it is not reused. */
  function forget(id) {
    live.delete(id);
  }

  return { plan, stored, record, forget, clear: () => live.clear() };
}

module.exports = { createThreads, hashRefs, latestState };
