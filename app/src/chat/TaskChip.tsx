import { useEffect, useSyncExternalStore } from "react";
import { Chip, Icon } from "../ui";
import { acknowledgeFailed, failedOf, runningOf, subscribeTasks, taskSnapshot, watchTasks } from "../tasks/taskStore";
import { requestShowTasks } from "../terminal/terminalBus";

interface TaskChipProps {
  chatId?: string;
  t: (key: string) => string;
}

/** The "2 running" line at the end of the last reply, for commands still going in the background.
 * It turns red when one failed. A click opens the Tasks tab. */
export function TaskChip({ chatId, t }: TaskChipProps) {
  const { tasks } = useSyncExternalStore(subscribeTasks, taskSnapshot);
  useEffect(() => watchTasks(chatId), [chatId]);

  const mine = tasks.filter((task) => task.chatId === chatId);
  const running = runningOf(mine);
  const failed = failedOf(mine);
  if (running.length === 0 && failed.length === 0) return null;

  const hasFailed = failed.length > 0;
  const label = running.length > 0 ? `${running.length} ${t("tasksRunningLabel")}` : `${failed.length} ${t("tasksFailedLabel")}`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5" role="status">
      <Chip
        size="dense"
        label={label}
        title={t("tasksTab")}
        icon={<Icon name={hasFailed ? "warning" : "terminal-window"} size={14} />}
        className={hasFailed ? "!text-danger !border-danger" : ""}
        onClick={() => {
          if (chatId) acknowledgeFailed(chatId);
          requestShowTasks();
        }}
      />
    </div>
  );
}
