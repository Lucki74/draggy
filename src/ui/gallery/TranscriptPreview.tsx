import MessageItem from "../../chat/MessageItem";
import { defaultSettings } from "../../app/settings";
import { Transcript } from "../../chat/Transcript";
import { translations } from "../../translations";
import type { ChatSession, Message, SearchStep } from "../../types";

const step = (id: string, type: SearchStep["type"], content: string, extra: Partial<SearchStep> = {}): SearchStep => ({
  id,
  type,
  content,
  isComplete: true,
  ...extra,
});

const REPLY = `The leak comes from the resize listener: it is added on every render and never removed.

### What changed

- The listener moves into an effect with a cleanup.
- The handler is throttled to one call per frame.

| File | Change |
| --- | --- |
| \`Viewer.tsx\` | effect cleanup |
| \`throttle.ts\` | new helper |

\`\`\`ts
useEffect(() => {
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}, [onResize]);
\`\`\`

> [!TIP]
> Run the profiler again after a few resizes; the listener count should stay at one.`;

const MESSAGES: Message[] = [
  { id: "u1", role: "user", content: "Why does the viewer get slower every time I resize the window?" },
  {
    id: "a1",
    role: "assistant",
    content: REPLY,
    steps: [
      step("t1", "thinking", "The slowdown grows with each resize, so something accumulates.", { thoughtTime: 4 }),
      step("r1", "reading", "Read **Viewer.tsx**"),
      step("r2", "reading", "Read **useResize.ts**"),
      step("e1", "edit_file", "Edited **Viewer.tsx**", {
        filename: "Viewer.tsx",
        filepath: "C:/project/src/Viewer.tsx",
        before: 'window.addEventListener("resize", onResize);\n',
        after: 'useEffect(() => {\n  window.addEventListener("resize", onResize);\n  return () => window.removeEventListener("resize", onResize);\n}, [onResize]);\n',
      }),
      step("c1", "command", "Ran `npm test -- viewer`"),
    ],
  },
  { id: "u2", role: "user", content: "Now run the full suite." },
  { id: "a2", role: "assistant", content: "Could not reach the engine. Is it still running?", failed: true },
];

/* The transcript with sample turns, so restyles can be checked without a live model. */
export function TranscriptPreview() {
  return (
    <div className="flex flex-col gap-6 py-6 px-4 text-text-primary">
      {MESSAGES.map((msg, idx) => (
        <MessageItem
          key={msg.id}
          msg={msg}
          idx={idx}
          isGenerating={false}
          isLast={idx === MESSAGES.length - 1}
          onRegenerate={() => {}}
          onSwitchVersion={() => {}}
          copiedIndex={null}
          copyToClipboard={() => {}}
          settings={{ ...defaultSettings, showMetrics: false }}
          onEditMessage={() => {}}
        />
      ))}
    </div>
  );
}

const PROMPTS = [
  "Why does the viewer get slower every minute?",
  "Show me where the listener is added.",
  "Throttle it to one call per frame.",
  "Now the tooltip lags. Can it read the cached size?",
  "Run the tests.",
  "Two failed. What broke?",
];

/** A session long enough to show the prompt jump list on the end edge. */
export function LongTranscriptPreview() {
  const chat: ChatSession = {
    id: "long",
    title: "Viewer slowdown",
    updatedAt: 0,
    isGenerating: false,
    messages: Array.from({ length: 24 }, (_, index) => [
      { id: `u${index}`, role: "user" as const, content: PROMPTS[index % PROMPTS.length] },
      { id: `a${index}`, role: "assistant" as const, content: `Done. Step ${index + 1} of the fix is in.` },
    ]).flat(),
  };
  return (
    <div className="h-[420px] flex flex-col">
      <Transcript
        chat={chat}
        copiedIndex={null}
        settings={{ ...defaultSettings, showMetrics: false }}
        onRegenerate={() => {}}
        onSwitchVersion={() => {}}
        onEditMessage={() => {}}
        copyToClipboard={async () => {}}
        t={(key) => translations.en[key] || key}
      />
    </div>
  );
}
