import { useState } from "react";
import Sidebar from "../../app/Sidebar";
import { translations } from "../../translations";
import type { ChatSession, Workspace } from "../../types";

const t = (key: string) => translations.en[key] || key;
const hour = 60 * 60 * 1000;

const PROJECTS = [
  { id: "w1", name: "draggy", rootPath: "D:/dev/draggy" },
  { id: "w2", name: "video-studio", rootPath: "D:/dev/video-studio" },
] as Workspace[];

const SAMPLE: ChatSession[] = [
  { id: "a", title: "Fix the crash on boot", updatedAt: Date.now() - hour, messages: [], workspaceId: "w1", isGenerating: false },
  { id: "b", title: "Stream replies a line at a time", updatedAt: Date.now() - 2 * hour, messages: [], workspaceId: "w1", isGenerating: false, unread: true },
  { id: "c", title: "Render the trailer at 60 fps", updatedAt: Date.now() - 30 * hour, messages: [], workspaceId: "w2", isGenerating: false, pinned: true },
];

/** The sidebar with sample sessions, for checking rows, marks and menus without Electron. */
export function SidebarPreview({ mode = "code" }: { mode?: "chat" | "code" }) {
  const [sessions, setSessions] = useState(SAMPLE);
  const [current, setCurrent] = useState("a");
  const update = (id: string, change: (s: ChatSession) => ChatSession) =>
    setSessions((list) => list.map((s) => (s.id === id ? change(s) : s)));

  return (
    <div className="h-[520px] flex">
      <Sidebar
        mode={mode}
        codeHome={false}
        activeWorkspaceId="w1"
        projects={PROJECTS}
        runningSessionIds={["a"]}
        sessions={sessions}
        currentChatId={current}
        t={t}
        onSwitchMode={() => {}}
        onNewChat={() => {}}
        onNewProject={() => {}}
        onSelectChat={setCurrent}
        onDeleteChat={(_, id) => setSessions((list) => list.filter((s) => s.id !== id))}
        onRenameChat={(id, title) => update(id, (s) => ({ ...s, title }))}
        onPinChat={(id) => update(id, (s) => ({ ...s, pinned: !s.pinned }))}
        onOpenSettings={() => {}}
        onSelectWorkspace={() => {}}
        onRemoveWorkspace={() => {}}
        open
        onToggleOpen={() => {}}
      />
    </div>
  );
}
