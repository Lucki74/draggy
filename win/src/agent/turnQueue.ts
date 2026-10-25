import type { QueuedMessage } from "../types";
import { logSwallow } from "../logger";

/** Queued messages survive a restart the way drafts do, in this window's storage. Attachments are
 * left out: a picture or two would fill the space drafts also need. */

const PREFIX = "queue_";
const keyFor = (chatId: string) => `${PREFIX}${chatId}`;

function parse(raw: string | null): QueuedMessage[] {
  const saved = JSON.parse(raw || "[]") as unknown;
  if (!Array.isArray(saved)) return [];
  return saved.filter(
    (item): item is QueuedMessage =>
      Boolean(item) && typeof item.id === "string" && typeof item.content === "string",
  );
}

/** Every conversation's saved queue, read once when the app starts. */
export function loadQueues(): Record<string, QueuedMessage[]> {
  const queues: Record<string, QueuedMessage[]> = {};
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const queue = parse(localStorage.getItem(key));
        if (queue.length > 0) queues[key.slice(PREFIX.length)] = queue;
      } catch (error) {
        logSwallow("chat", error, "a queue that cannot be read starts empty");
      }
    }
  } catch (error) {
    logSwallow("chat", error, "without storage the queues start empty");
  }
  return queues;
}

export function saveQueue(chatId: string, queue: QueuedMessage[]): void {
  try {
    if (queue.length === 0) {
      localStorage.removeItem(keyFor(chatId));
      return;
    }
    const stored = queue.map(({ id, content }) => ({ id, content }));
    localStorage.setItem(keyFor(chatId), JSON.stringify(stored));
  } catch (error) {
    logSwallow("chat", error, "the queue still works for this run");
  }
}
