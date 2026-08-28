import { useState, useMemo } from "react";
import { Search, MessageSquare, Trash } from "lucide-react";
import type { ChatSession, AppSettings } from "./types";
import { translations } from "./translations";

interface ChatHistoryProps {
  sessions: ChatSession[];
  onSelectChat: (id: string) => void;
  onDeleteChat: (e: React.MouseEvent, id: string) => void;
  settings: AppSettings;
}

const THINK_BLOCK_RE =
  /<think>[\s\S]*?(?:<\/think>|<\/?channel>|<\/thought>|<\/thinking>|(?=<tool>)|$)/gi;

export default function ChatHistory({
  sessions,
  onSelectChat,
  onDeleteChat,
  settings,
}: ChatHistoryProps) {
  const t = (key: string) =>
    translations[settings.language]?.[key] || translations["en"][key] || key;

  const [searchQuery, setSearchQuery] = useState("");

  const filteredSessions = useMemo(() => {
    if (!searchQuery) return sessions;
    const lowerQ = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(lowerQ) ||
        s.messages.some((m) => m.content.toLowerCase().includes(lowerQ)),
    );
  }, [sessions, searchQuery]);

  const getFirstAiResponse = (session: ChatSession) => {
    const aiMessage = session.messages.find((m) => m.role === "assistant");
    if (!aiMessage) return t("noResponseYet");

    const preview =
      aiMessage.textContent?.trim() ||
      aiMessage.content.replace(THINK_BLOCK_RE, "").trim();
    return preview || t("noResponseYet");
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-base)] p-6 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto flex flex-col h-full space-y-4">
        <h1 className="text-2xl font-bold tracking-wider text-[var(--text-main)] uppercase">
          {t("chatHistory")}
        </h1>

        <div className="relative w-full">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            type="text"
            placeholder={t("searchAllChats")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border-[3px] rounded-xl py-3 pl-10 pr-4 text-base font-bold focus:outline-none transition-colors"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderColor: "var(--border-light)",
              color: "var(--text-main)",
            }}
          />
        </div>

        <div className="flex-1 flex flex-col space-y-2">
          {filteredSessions.length === 0 ? (
            <div className="text-[var(--text-muted)] font-bold mt-4">
              {t("noChatsFound")}
            </div>
          ) : (
            filteredSessions.map((session) => (
              <div
                key={session.id}
                onClick={() => onSelectChat(session.id)}
                className="group relative flex flex-col p-4 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] hover:bg-[var(--hover-bg)] hover:border-[var(--text-main)] transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center space-x-3">
                    <MessageSquare className="w-4 h-4 text-[var(--text-main)]" />
                    <h2 className="text-base font-bold text-[var(--text-main)] truncate">
                      {session.title}
                    </h2>
                  </div>
                  <button
                    onClick={(e) => onDeleteChat(e, session.id)}
                    className="p-1.5 text-[var(--text-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-[var(--text-muted)] text-[13px] font-medium line-clamp-2 leading-relaxed">
                  {getFirstAiResponse(session)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
