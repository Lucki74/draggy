import { Icon } from "../ui";
import type { Message } from "../types";

interface EndedTask {
  command: string;
  failed: boolean;
  after: string;
}

/** The tasks a "[Background tasks ended]" note names, read back from the note the model got. */
function endedTasks(content: string): EndedTask[] {
  const found: EndedTask[] = [];
  for (const match of content.matchAll(/^Task \S+ \((.*)\) (was stopped|finished with exit code 0|failed[^\n]*?) after ([^\n]+?)\.$/gm)) {
    found.push({ command: match[1], failed: match[2].startsWith("failed"), after: match[3] });
  }
  return found;
}

// A note the app sent for the user: one quiet line per task, its output a click away.
export function TaskNotice({ msg, t }: { msg: Message; t: (key: string) => string }) {
  const tasks = endedTasks(msg.content);
  return (
    <details data-testid="task-notice" className="group/notice w-full text-[13px] text-text-secondary">
      <summary className="flex cursor-pointer select-none list-none flex-col gap-0.5 [&::-webkit-details-marker]:hidden">
        {tasks.map((task, index) => (
          <span key={index} className="flex min-h-6 items-center gap-2">
            <Icon name="terminal" size={12} className={`flex-shrink-0 ${task.failed ? "text-danger" : ""}`} />
            <span className="flex-shrink-0">{task.failed ? t("backgroundTaskFailed") : t("backgroundTaskEnded")}</span>
            <span className="min-w-0 truncate font-mono text-[12.5px] text-text-tertiary">{task.command}</span>
            <span className="flex-shrink-0 tabular-nums text-text-tertiary">{task.after}</span>
            {index === 0 && (
              <Icon name="caret-right" size={12} mirrored className="flex-shrink-0 transition-transform group-open/notice:rotate-90" />
            )}
          </span>
        ))}
      </summary>
      <pre className="ms-5 mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] text-text-tertiary">{msg.content}</pre>
    </details>
  );
}
export default TaskNotice;
