import { useMemo, useState } from "react";
import { ComposerQueueContext, type ComposerQueue } from "../../chat/Composer";
import { Transcript } from "../../chat/Transcript";
import { defaultSettings } from "../../app/settings";
import { translations } from "../../translations";
import { ComposerPreview } from "./ComposerPreview";
import type { ChatSession, QueuedMessage } from "../../types";

const NOTES: QueuedMessage[] = [
  { id: "a", content: "Also add a test for the empty case" },
  { id: "b", content: "Then update the changelog and bump the version number in package.json" },
  { id: "c", content: "Finally summarise what changed in two sentences" },
];

/** The composer with a live local queue, so reorder, edit, send now and clear all work in the gallery. */
export function QueueComposer({ initial = NOTES, language = "en" }: { initial?: QueuedMessage[]; language?: keyof typeof translations }) {
  const [queue, setQueue] = useState<QueuedMessage[]>(initial);
  const ctx = useMemo<ComposerQueue>(
    () => ({
      chatId: "preview",
      queue,
      pendingSteers: [],
      enqueue: (content) => setQueue((q) => [...q, { id: String(Math.random()), content }]),
      steer: () => {},
      sendNow: () => {},
      editQueued: (id, content) => setQueue((q) => q.map((m) => (m.id === id ? { ...m, content } : m))),
      removeQueued: (id) => setQueue((q) => q.filter((m) => m.id !== id)),
      moveQueued: (id, offset) =>
        setQueue((q) => {
          const from = q.findIndex((m) => m.id === id);
          const to = from + offset;
          if (from < 0 || to < 0 || to >= q.length) return q;
          const next = q.slice();
          const [item] = next.splice(from, 1);
          next.splice(to, 0, item);
          return next;
        }),
      sendQueuedNow: (id) => setQueue((q) => q.filter((m) => m.id !== id)),
    }),
    [queue],
  );
  return (
    <ComposerQueueContext.Provider value={ctx}>
      <ComposerPreview generating attachedFiles={[]} language={language} />
    </ComposerQueueContext.Provider>
  );
}

const chatOf = (messages: ChatSession["messages"]): ChatSession => ({
  id: "preview",
  title: "Queue",
  updatedAt: 0,
  isGenerating: true,
  messages,
});

/** Transcript states around the queue: notes the turn has not read yet, a note that landed, and a chat parked behind another. */
export function QueueTranscript({ kind }: { kind: "pending" | "parked" | "landed" }) {
  const t = (key: string) => translations.en[key] || key;
  const user = { id: "u1", role: "user" as const, content: "Refactor the resize handler into a hook" };
  const messages =
    kind === "parked"
      ? [
          user,
          {
            id: "a1",
            role: "assistant" as const,
            content: "",
            steps: [{ id: "s1", type: "loading" as const, content: "Message queued (1/2)…", isComplete: false }],
          },
        ]
      : [
          user,
          {
            id: "a1",
            role: "assistant" as const,
            content: "",
            steps: [
              { id: "r1", type: "reading" as const, content: "Read **Viewer.tsx**", isComplete: true },
              ...(kind === "landed"
                ? [{ id: "n1", type: "steer" as const, content: "Use tabs, not spaces", isComplete: true }]
                : []),
              { id: "l1", type: "loading" as const, content: "Working…", isComplete: false },
            ],
          },
        ];
  const pending = kind === "pending" ? ["Use tabs, not spaces", "And keep the diff small"] : [];
  const ctx = { chatId: "preview", queue: [], pendingSteers: pending } as unknown as ComposerQueue;
  return (
    <ComposerQueueContext.Provider value={ctx}>
      <div className="h-[260px] flex flex-col">
        <Transcript
          chat={chatOf(messages)}
          copiedIndex={null}
          settings={{ ...defaultSettings, showMetrics: false }}
          onRegenerate={() => {}}
          onSwitchVersion={() => {}}
          onEditMessage={() => {}}
          copyToClipboard={async () => {}}
          t={t}
        />
      </div>
    </ComposerQueueContext.Provider>
  );
}
