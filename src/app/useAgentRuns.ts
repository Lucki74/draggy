import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createTaskManager } from "../agent/taskManager";
import type { TaskHost, TaskManager } from "../agent/taskManager";
import type { ToolEnvironment } from "../tools/registry";
import type { Grant } from "../agent/permissions";
import type {
  ApprovalAnswer,
  AppSettings,
  Attachment,
  ChatSession,
  MessageVersion,
  PermissionMode,
} from "../types";

interface AgentRunsInput {
  model: string | null;
  settings: AppSettings;
  environment: ToolEnvironment;
  workspaceId: string;
  permission: { mode: PermissionMode; grants: Grant[] };
  /** Keeps a permission for the workspace, past the task that asked for it. */
  onGrant: (grant: Grant) => void;
  /** A turn that finished on its own, so the window can say so. */
  onFinished: (chatId: string) => void;
  t: (key: string) => string;
  getSession: (chatId: string) => ChatSession | undefined;
  addSession: (session: ChatSession) => void;
  updateSession: (
    chatId: string,
    updater: (session: ChatSession) => ChatSession,
  ) => void;
  patchActiveMessage: (
    chatId: string,
    patch: Partial<MessageVersion>,
    sessionPatch?: Partial<ChatSession>,
  ) => void;
}

export interface AgentRuns {
  /** Ids of the conversations with a turn in flight right now. */
  running: string[];
  send: (chatId: string, content: string, attachments?: Attachment[]) => void;
  regenerate: (chatId: string, index?: number) => void;
  editMessage: (chatId: string, messageIndex: number, content: string) => void;
  switchVersion: (
    chatId: string,
    messageIndex: number,
    versionIndex: number,
  ) => void;
  continueGeneration: (chatId: string) => void;
  dismissOutOfContext: (chatId: string) => void;
  answerApproval: (approvalId: string, answer: ApprovalAnswer) => void;
  stop: (chatId: string) => void;
  stopAll: () => void;
}

/**
 * The task manager, wired to React. The manager is created once and pointed at
 * the current state after every render, so every handler it hands back keeps
 * one identity for the life of the window while never reading a stale model.
 */
export function useAgentRuns(input: AgentRunsInput): AgentRuns {
  const host: TaskHost = {
    getModel: () => input.model,
    getSettings: () => input.settings,
    getEnvironment: () => input.environment,
    getWorkspaceId: () => input.workspaceId,
    getPermission: () => input.permission,
    onGrant: (grant) => input.onGrant(grant),
    onFinished: (chatId) => input.onFinished(chatId),
    getSession: input.getSession,
    addSession: input.addSession,
    updateSession: input.updateSession,
    patchActiveMessage: input.patchActiveMessage,
    t: input.t,
  };

  const [manager] = useState<TaskManager>(() => createTaskManager(host));

  useEffect(() => {
    manager.configure(host);
  });

  const running = useSyncExternalStore(manager.subscribe, manager.running);

  return useMemo(
    () => ({
      running,
      send: manager.send,
      regenerate: manager.regenerate,
      editMessage: manager.editMessage,
      switchVersion: manager.switchVersion,
      continueGeneration: manager.continueGeneration,
      dismissOutOfContext: manager.dismissOutOfContext,
      answerApproval: manager.answerApproval,
      stop: manager.stop,
      stopAll: manager.stopAll,
    }),
    [running, manager],
  );
}
