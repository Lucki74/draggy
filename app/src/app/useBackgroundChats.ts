import { swallowed } from "../logger";
import { useCallback, useEffect, useRef } from "react";
import type { AppSettings, ChatSession, Workspace } from "../types";
import type { ToolEnvironment } from "../tools/registry";
import type { AgentRuns } from "./useAgentRuns";
import type { SessionStore } from "./useSessions";
import { isProject } from "./modes";
import { rulesFor } from "../agent/permissionRules";
import { generateId, titleFromContent, writeLocalStorage } from "../utils";
import { dueRoutines, msToNextMinute, runTitle } from "../routines/scheduler";
import type { Routine } from "../routines/store";
import { answerFor, approvalText, chunkReply, readChatMap, resolveChat, telegramChatOf, type ChatMap } from "../telegram/mapping";

const CHAT_MAP_KEY = "draggy_telegram_chats";

interface Input {
  store: SessionStore;
  runs: AgentRuns;
  workspaces: Workspace[];
  defaultWorkspaceId: string;
  environment: ToolEnvironment;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  /** False until the chats and projects have loaded, so no run starts on half a picture. */
  ready: boolean;
  t: (key: string) => string;
}

/** The tools a chat in `workspace` gets, whichever workspace is on screen. */
function environmentFor(base: ToolEnvironment, workspace: Workspace, code: boolean): ToolEnvironment {
  const hasCommands = Boolean(window.draggy?.commands);
  return {
    ...base,
    canRunCommands: code && hasCommands,
    canElevate: false,
    libraryReady: base.libraryReady && !code,
    chatFolder: !code && !workspace.rootPath && hasCommands,
    hasFolder: Boolean(workspace.rootPath),
    projectRoot: workspace.rootPath ?? undefined,
    hasGit: false,
  };
}

function lastReply(session: ChatSession | undefined): string {
  const messages = session?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i].content.trim();
  }
  return "";
}

/** Chats nobody is looking at: scheduled routines, and conversations that arrive from Telegram. Each
 * runs in its own project with its own permission mode, whatever is on screen. */
export function useBackgroundChats(input: Input) {
  const latest = useRef(input);
  const routinesRef = useRef<Routine[]>(input.settings.routines);
  // Read by timers and listeners, which must see the newest props without being set up again.
  useEffect(() => {
    latest.current = input;
    routinesRef.current = input.settings.routines;
  });
  const running = useRef(new Set<string>());

  const patchRoutine = useCallback((id: string, patch: Partial<Routine>) => {
    const next = routinesRef.current.map((routine) => (routine.id === id ? { ...routine, ...patch } : routine));
    routinesRef.current = next;
    latest.current.updateSettings({ routines: next });
  }, []);

  const startRoutine = useCallback(
    (id: string) => {
      const { store, runs, workspaces, environment, t } = latest.current;
      const routine = routinesRef.current.find((one) => one.id === id);
      if (!routine || running.current.has(id)) return;
      const workspace = workspaces.find((one) => one.id === routine.workspaceId);
      const now = Date.now();
      if (!workspace || !routine.prompt.trim()) {
        patchRoutine(id, { lastRunAt: now, lastStatus: "failed" });
        return;
      }
      const chatId = generateId();
      store.addSession({
        id: chatId,
        workspaceId: workspace.id,
        title: runTitle(routine.name, new Date(now)),
        messages: [],
        updatedAt: now,
        isGenerating: false,
      });
      running.current.add(id);
      patchRoutine(id, { lastRunAt: now, lastStatus: "running", lastChatId: chatId });
      runs.setChatContext(chatId, {
        workspaceId: workspace.id,
        environment: environmentFor(environment, workspace, isProject(workspace)),
        // The most the routine may do is the mode saved on it. Nobody answers a prompt, so a call that
        // needs approval is refused.
        permission: { mode: routine.permissionMode, grants: [], rules: rulesFor(settings.permissionRules, workspace) },
        unattended: true,
        onEnded: (endedChat, outcome) => {
          running.current.delete(id);
          runs.setChatContext(endedChat, null);
          const failed = outcome.failed || outcome.aborted;
          patchRoutine(id, { lastStatus: failed ? "failed" : "done" });
          void window.draggy?.notifyShow(routine.name, t(failed ? "routineRunFailed" : "routineRunDone"))?.catch(swallowed("app", "a notification that did not show changes nothing"));
        },
      });
      runs.send(chatId, routine.prompt);
    },
    [patchRoutine],
  );

  // One timer, on the minute. The first tick also catches up one run missed while the computer slept.
  useEffect(() => {
    if (!input.ready) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      for (const routine of dueRoutines(routinesRef.current, Date.now(), running.current)) startRoutine(routine.id);
      timer = setTimeout(tick, msToNextMinute(Date.now()));
    };
    tick();
    return () => clearTimeout(timer);
  }, [input.ready, startRoutine]);

  // Telegram.
  const chatMap = useRef<ChatMap | null>(null);
  const loadMap = (): ChatMap => {
    if (!chatMap.current) {
      try {
        chatMap.current = readChatMap(localStorage.getItem(CHAT_MAP_KEY));
      } catch {
        chatMap.current = {};
      }
    }
    return chatMap.current;
  };
  const saveMap = (map: ChatMap) => {
    chatMap.current = map;
    writeLocalStorage(CHAT_MAP_KEY, JSON.stringify(map));
  };

  useEffect(() => {
    const api = window.draggy?.telegram;
    if (!api || !input.ready) return;

    const reply = (telegramChat: string, text: string) => {
      for (const part of chunkReply(text)) void api.send(telegramChat, part).catch(swallowed("app", "a notification that did not show changes nothing"));
    };

    const offMessage = api.onMessage((message) => {
      const { store, runs, workspaces, defaultWorkspaceId, environment, settings, t } = latest.current;
      const map = loadMap();

      if (message.command === "stop") {
        const chatId = map[message.chatId];
        if (chatId) runs.stop(chatId);
        reply(message.chatId, t("telegramStopped"));
        return;
      }

      const fresh = message.command === "new";
      const resolved = resolveChat(map, message.chatId, generateId(), fresh);
      const chatId = resolved.chatId;
      if (resolved.created) {
        const old = map[message.chatId];
        if (old) runs.stop(old);
        saveMap(resolved.map);
      }
      const workspace =
        workspaces.find((one) => one.id === settings.telegramWorkspaceId) ??
        workspaces.find((one) => one.id === defaultWorkspaceId) ??
        workspaces[0];
      if (!workspace) return;
      if (resolved.created) {
        store.addSession({
          id: chatId,
          workspaceId: workspace.id,
          title: fresh ? t("telegramChatTitle") : titleFromContent(message.text, t("telegramChatTitle")),
          messages: [],
          updatedAt: Date.now(),
          isGenerating: false,
        });
      }
      if (fresh) {
        reply(message.chatId, t("telegramNewChat"));
        if (!message.text.trim()) return;
      }

      const code = settings.telegramMode === "code" && isProject(workspace);
      runs.setChatContext(chatId, {
        workspaceId: workspace.id,
        environment: environmentFor(environment, workspace, code),
        // Calls ask on Telegram like anywhere else; nothing is remembered from a button.
        permission: { mode: "ask", grants: [], rules: rulesFor(settings.permissionRules, workspace) },
        onApproval: (approval) => {
          const target = telegramChatOf(loadMap(), chatId);
          if (!target) {
            runs.answerApproval(approval.id, "no");
            return;
          }
          void api
            .askApproval(target, approval.id, approvalText(approval, { ask: t("telegramAllowAsk") }))
            .then((result) => {
              if (!result.success) runs.answerApproval(approval.id, "no");
            })
            .catch(() => runs.answerApproval(approval.id, "no"));
        },
        onEnded: () => {
          // The store settles a moment after the turn ends.
          setTimeout(() => {
            const text = lastReply(latest.current.store.getSession(chatId));
            reply(message.chatId, text || latest.current.t("telegramNoReply"));
          }, 150);
        },
      });
      if (runs.running.includes(chatId)) runs.enqueue(chatId, message.text);
      else runs.send(chatId, message.text);
    });

    const offApproval = api.onApproval((answer) => {
      latest.current.runs.answerApproval(answer.approvalId, answerFor(answer.allow));
    });

    return () => {
      if (typeof offMessage === "function") offMessage();
      if (typeof offApproval === "function") offApproval();
    };
  }, [input.ready]);

  return { startRoutine };
}
