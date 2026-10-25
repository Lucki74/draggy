import type { Message, MessageVersion, TurnErrorKind } from "../types";

/** Versions and branches of a conversation. A message's own fields are its newest version; older
 * ones sit in `versions`, each holding the conversation that followed it in `tail`. */

/** Which slot is on screen: an index into `versions`, or `versions.length` for the newest. */
export function shownSlot(message: Message): number {
  const count = message.versions?.length ?? 0;
  const index = message.currentVersionIndex;
  return index === undefined || index > count || index < 0 ? count : index;
}

/** The newest version as a stored one. */
function ownVersion(message: Message): MessageVersion {
  const version: MessageVersion = { content: message.content };
  if (message.role === "user") {
    if (message.attachments) version.attachments = message.attachments;
    return version;
  }
  version.thinkingContent = message.thinkingContent;
  version.textContent = message.textContent;
  version.thoughtTime = message.thoughtTime;
  version.steps = message.steps;
  version.metrics = message.metrics;
  if (message.provider_state) version.provider_state = message.provider_state;
  if (message.failed) version.failed = true;
  if (message.error) version.error = message.error;
  if (message.errorKind) version.errorKind = message.errorKind;
  if (message.stopped) version.stopped = true;
  return version;
}

/** A failed attempt that wrote nothing is not worth a version of its own. */
function isEmptyFailure(version: MessageVersion): boolean {
  return Boolean(
    version.failed &&
      !version.content?.trim() &&
      !version.textContent?.trim() &&
      !(version.steps && version.steps.length > 0) &&
      !(version.tail && version.tail.length > 0),
  );
}

/** The message as it reads on screen, with the shown version's fields in place of the newest. */
export function shownMessage(message: Message): Message {
  const slot = shownSlot(message);
  const version = message.versions?.[slot];
  if (!version) return message;

  const { tail: _tail, attachments, ...fields } = version;
  const shown: Message = { ...message, ...fields };
  if (message.role === "user") shown.attachments = attachments ?? message.attachments;
  if (message.role === "assistant") {
    for (const key of ["failed", "error", "errorKind", "stopped"] as const) {
      if (version[key] === undefined) delete shown[key];
    }
    delete shown.interrupted;
  }
  return shown;
}

/** Puts the conversation after `index` into the slot on screen, so it comes back with it. */
function stashTail(message: Message, tail: Message[]): Message {
  const slot = shownSlot(message);
  const versions = message.versions ? message.versions.slice() : [];
  if (slot < versions.length) {
    versions[slot] = { ...versions[slot], tail };
    return { ...message, versions };
  }
  return { ...message, tail };
}

/** Moves the newest version into `versions` and starts a blank one in its place. */
function pushNewest(message: Message, tail: Message[]): Message {
  const stashed = stashTail(message, tail);
  const newest = { ...ownVersion(stashed), tail: stashed.tail ?? [] };
  const versions = [...(stashed.versions ?? [])];
  if (!isEmptyFailure(newest)) versions.push(newest);

  const next: Message = { ...stashed, versions, currentVersionIndex: versions.length };
  delete next.tail;
  delete next.interrupted;
  return next;
}

/** The conversation for a fresh reply in place of the assistant message at `index`. The old reply
 * and everything after it stay reachable from its version arrows. */
export function retryAt(messages: Message[], index: number): Message[] | null {
  const target = messages[index];
  if (!target || target.role !== "assistant") return null;

  const pushed = pushNewest(target, messages.slice(index + 1));
  const fresh: Message = {
    ...pushed,
    content: "",
    thinkingContent: null,
    textContent: "",
    thoughtTime: undefined,
    steps: [],
    metrics: null,
  };
  for (const key of ["provider_state", "failed", "error", "errorKind", "stopped"] as const) delete fresh[key];
  return [...messages.slice(0, index), fresh];
}

/** The conversation after the user rewords the message at `index`. */
export function editAt(messages: Message[], index: number, content: string): Message[] | null {
  const target = messages[index];
  if (!target || target.role !== "user") return null;

  const pushed = pushNewest(target, messages.slice(index + 1));
  return [...messages.slice(0, index), { ...pushed, content }];
}

/** Shows another version of the message at `index`, with the conversation that followed it. */
export function switchAt(messages: Message[], index: number, slot: number): Message[] {
  const target = messages[index];
  if (!target) return messages;
  const count = target.versions?.length ?? 0;
  if (slot < 0 || slot > count || slot === shownSlot(target)) return messages;

  const stashed = stashTail(target, messages.slice(index + 1));
  const versions = stashed.versions ? stashed.versions.slice() : [];
  let tail: Message[];
  const next: Message = { ...stashed, currentVersionIndex: slot };

  if (slot === count) {
    tail = stashed.tail ?? [];
    delete next.tail;
  } else {
    tail = versions[slot].tail ?? [];
    versions[slot] = { ...versions[slot] };
    delete versions[slot].tail;
  }
  next.versions = versions;
  return [...messages.slice(0, index), next, ...tail];
}

/** Carrying on a reply needs the version on screen to be the newest, since that is where it writes. */
export function promoteShown(message: Message): Message {
  const slot = shownSlot(message);
  const count = message.versions?.length ?? 0;
  if (slot === count) return message;

  const versions = message.versions!.slice();
  const shown = versions[slot];
  versions[slot] = { ...ownVersion(message), tail: message.tail ?? [] };
  const { tail: _tail, attachments: _attachments, ...fields } = shown;
  const promoted: Message = { ...message, ...fields, versions, currentVersionIndex: count };
  delete promoted.tail;
  return promoted;
}

const FAILED_REPLY = "[This reply failed before any text was written.]";

/** What the model is shown of the conversation: the versions on screen, failures without their
 * error text, and notes added mid-turn. Indexes are kept, since compaction counts by them. */
export function modelHistory(messages: Message[]): Message[] {
  return messages.map((original) => {
    const message = shownMessage(original);
    if (message.role !== "assistant") return message;

    let content = message.content || "";
    const steers = (message.steps ?? []).filter((step) => step.type === "steer" && step.content.trim());
    if (steers.length > 0) {
      content += steers.map((step) => `\n\n[The user added during this reply: ${step.content.trim()}]`).join("");
    }
    // Older failures kept the error itself in `content`, with no visible text beside it.
    if (message.failed && !message.textContent?.trim()) content = FAILED_REPLY;
    return content === message.content ? message : { ...message, content };
  });
}

/** Sorts a turn's error into what can be done about it. */
export function classifyTurnError(text: string): TurnErrorKind {
  if (/out of memory|failed to allocate|cudaMalloc|OutOfDeviceMemory|OutOfHostMemory/i.test(text)) return "memory";
  if (/context size|context length|context window|too many tokens|maximum context/i.test(text)) return "context";
  if (/\b429\b|rate.?limit|too many requests|overloaded|\b529\b/i.test(text)) return "rate-limit";
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|fetch failed|failed to fetch|socket hang up|\b50[234]\b/i.test(text)) return "network";
  if (/engine (stopped|crashed|exited)|server (stopped|crashed|exited)|not running|unreachable|stopped loading/i.test(text)) return "engine";
  return "unknown";
}

/** Failures worth one quiet retry before the user is told. */
export function isTransient(kind: TurnErrorKind): boolean {
  return kind === "engine" || kind === "network" || kind === "rate-limit";
}
