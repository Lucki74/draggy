import React from "react";
import ChatScreen from "../ChatScreen";
import ChatHistory from "../ChatHistory";
import TalkScreen from "../TalkScreen";
import Explorer from "../files/Explorer";
import { OpenFileContext } from "../chat/openFileContext";
import { OpenDiffContext } from "../chat/openDiffContext";
import { relativePaths } from "../chat/mentions";
import { folderName } from "../workspaces";
import { shouldShowStrip } from "../project/gitView";
import CodeHome from "./CodeHome";
import DownloadBar from "../onboarding/DownloadBar";
import type { FirstDownload } from "../onboarding/useFirstDownload";
import type { AppMode } from "./modes";
import type { ViewMode } from "./AppShell";
import type {
    AppSettings,
    ApprovalAnswer,
    Attachment,
    ChatSession,
    GitStatus,
    InstalledSkill,
    PermissionMode,
    Workspace,
} from "../types";
import type { ContextMeasurement } from "../agent/agentLoop";
import type { CompactOutcome } from "../agent/taskManager";
import type { Utterance } from "../voice/conversation";
import type { SettingsTab } from "../settings/pages";

export interface MainColumnProps {
    arrivingModel?: FirstDownload;
    settings: AppSettings;
    t: (key: string) => string;
    viewMode: ViewMode;
    mode: AppMode;
    codeHome: boolean;
    projects: Workspace[];
    active: Workspace;
    canvasPath: string | null;
    visibleSessions: ChatSession[];
    currentChatId: string | null;
    currentSession?: ChatSession;
    openedAt: number;
    turnModel: string;
    skills: InstalledSkill[];
    effectiveSettings: AppSettings;
    gitStatus: GitStatus | null;
    seedPrompt?: string;
    observeWorkArea: (node: HTMLDivElement | null) => void;
    onSetTreeOpen: (open: boolean) => void;
    onSelectWorkspace: (id: string) => void;
    onNewProject: () => void;
    onSelectChat: (id: string) => void;
    onDeleteChat: (e: React.MouseEvent, id: string) => void;
    onExportChat?: (e: React.MouseEvent, id: string) => void;
    onOpenProjectMemory: () => void;
    onSelectFile: (path: string) => void;
    onSendMessage: (content: string, attachments?: Attachment[]) => void;
    onRegenerateChat: (idx: number) => void;
    onSwitchVersionChat: (mIdx: number, vIdx: number) => void;
    onEditMessageChat: (mIdx: number, content: string) => void;
    onStopGeneration: () => void;
    onContinueGeneration: () => void;
    onDismissOutOfContext: () => void;
    onApproval?: (approvalId: string, answer: ApprovalAnswer) => void;
    onRevert: (checkpointId: number) => Promise<boolean>;
    onInitProject?: () => void;
    onCompact: () => Promise<CompactOutcome>;
    onImageCommand: (argument: string, attachments: Attachment[]) => void;
    onOpenUsage: () => void;
    onMeasureContext: (
        draft: string,
        attachments: Attachment[],
        options: { signal: AbortSignal; allowLoad: boolean },
    ) => Promise<ContextMeasurement | null>;
    onSelectModel: (name: string) => void;
    onOpenSettings: (tab: SettingsTab) => void;
    onNewChat: () => void;
    /** Opens Talk from the empty chat's home. */
    onTalkTurn: (turn: Utterance) => void;
    onLeaveTalk: () => void;
    onSeedUsed?: () => void;
    patchFromComposer: (patch: Partial<AppSettings>) => void;
    onPermissionMode?: (next: PermissionMode) => void;
    onOpenDiff?: (filePath?: string) => void;
    dockNode?: React.ReactNode;
}

/* Primary workspace column presenting transcripts, file trees, home or explorer screens. */
export function MainColumn({
    arrivingModel,
    settings,
    t,
    viewMode,
    mode,
    codeHome,
    projects,
    active,
    canvasPath,
    visibleSessions,
    currentChatId,
    currentSession,
    openedAt,
    turnModel,
    skills,
    effectiveSettings,
    gitStatus,
    seedPrompt,
    observeWorkArea,
    onSetTreeOpen,
    onSelectWorkspace,
    onNewProject,
    onSelectChat,
    onDeleteChat,
    onExportChat,
    onOpenProjectMemory,
    onSelectFile,
    onSendMessage,
    onRegenerateChat,
    onSwitchVersionChat,
    onEditMessageChat,
    onStopGeneration,
    onContinueGeneration,
    onDismissOutOfContext,
    onApproval,
    onRevert,
    onInitProject,
    onCompact,
    onImageCommand,
    onOpenUsage,
    onMeasureContext,
    onSelectModel,
    onOpenSettings,
    onNewChat,
    onTalkTurn,
    onLeaveTalk,
    onSeedUsed,
    patchFromComposer,
    onPermissionMode,
    onOpenDiff,
    dockNode,
}: MainColumnProps) {
    const workspaceId = active.id;
    const rootPath = active.rootPath;
    const searchFiles = React.useCallback(
        async (name: string) => {
            if (!rootPath) return [];
            const result = await window.electronAPI?.files?.search(workspaceId, { name, limit: 20 });
            return result?.success ? relativePaths(rootPath, result.hits ?? []) : [];
        },
        [workspaceId, rootPath],
    );

    if (arrivingModel && viewMode !== "settings") {
        // Rendered at top of main column
    }

    return (
        <div className="flex-1 flex flex-col min-w-0 relative">
            {arrivingModel && viewMode !== "settings" && (
                <DownloadBar download={arrivingModel} placement="top" language={settings.language} t={t} />
            )}
            {codeHome && viewMode !== "settings" ? (
                <CodeHome
                    projects={projects}
                    onOpenFolder={onNewProject}
                    onSelectProject={onSelectWorkspace}
                    t={t}
                />
            ) : viewMode === "history" ? (
                <ChatHistory
                    sessions={visibleSessions}
                    onSelectChat={onSelectChat}
                    onDeleteChat={onDeleteChat}
                    onExportChat={mode === "chat" ? onExportChat : undefined}
                    settings={settings}
                    surface={mode}
                />
            ) : viewMode === "files" ? (
                <Explorer
                    settings={settings}
                    workspace={active}
                    initialPath={canvasPath}
                />
            ) : viewMode === "talk" && mode === "chat" ? (
                <TalkScreen
                    key={currentChatId ?? "talk"}
                    settings={settings}
                    seed={talkSeed(currentSession)}
                    onTurn={onTalkTurn}
                    onLeave={onLeaveTalk}
                />
            ) : currentChatId ? (
                <div ref={observeWorkArea} className="flex-1 flex min-h-0 min-w-0">
                    <div className="flex-1 min-w-[340px] flex">
                        <OpenDiffContext.Provider value={onOpenDiff ?? null}>
                        <OpenFileContext.Provider value={active.rootPath ? onSelectFile : null}>
                        <ChatScreen
                            key={mode}
                            model={turnModel}
                            chat={
                                currentSession || {
                                    id: currentChatId,
                                    title: t("newDiscussion"),
                                    messages: [],
                                    updatedAt: openedAt,
                                    isGenerating: false,
                                }
                            }
                            onSendMessage={onSendMessage}
                            onRegenerate={onRegenerateChat}
                            onSwitchVersion={onSwitchVersionChat}
                            onEditMessage={onEditMessageChat}
                            onStopGeneration={onStopGeneration}
                            onContinueGeneration={onContinueGeneration}
                            onDismissOutOfContext={onDismissOutOfContext}
                            onApproval={onApproval}
                            onRevert={onRevert}
                            onProjectMemory={active.rootPath ? onOpenProjectMemory : undefined}
                            onInitProject={active.rootPath ? onInitProject : undefined}
                            onCompact={onCompact}
                            onImageCommand={onImageCommand}
                            onOpenUsage={onOpenUsage}
                            onMeasureContext={onMeasureContext}
                            onSelectModel={onSelectModel}
                            onOpenSettings={onOpenSettings}
                            onNewChat={onNewChat}
                            surface={mode}
                            skills={skills}
                            unavailable={arrivingModel ? t("onbStillDownloading") : undefined}
                            seedDraft={mode === "chat" ? seedPrompt : undefined}
                            onSeedUsed={onSeedUsed}
                            settings={effectiveSettings}
                            onPatchSettings={patchFromComposer}
                            permissionMode={mode === "code" ? active.permissionMode : undefined}
                            onPermissionMode={onPermissionMode}
                            workContext={
                                mode === "code" && active.rootPath
                                    ? {
                                          folder: active.name || folderName(active.rootPath),
                                          branch: shouldShowStrip(gitStatus)
                                              ? gitStatus.detached
                                                  ? t("gitDetached")
                                                  : gitStatus.branch
                                              : null,
                                          onShow: () => onSetTreeOpen(true),
                                          projects: projects.map((project) => ({
                                              id: project.id,
                                              name: project.name || (project.rootPath ? folderName(project.rootPath) : ""),
                                          })),
                                          activeProjectId: active.id,
                                          onSelectProject: onSelectWorkspace,
                                          onNewProject,
                                          searchFiles,
                                      }
                                    : undefined
                            }
                        />
                        </OpenFileContext.Provider>
                        </OpenDiffContext.Provider>
                    </div>

                    {viewMode !== "settings" && dockNode}
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center bg-[var(--bg-base)]" />
            )}
        </div>
    );
}

/** What Talk hears of the chat before it, as plain turns. Failed turns are left out. */
function talkSeed(session?: ChatSession) {
    return (session?.messages ?? [])
        .filter((message) => (message.role === "user" || message.role === "assistant") && !message.failed)
        .map((message) => ({ role: message.role as "user" | "assistant", text: message.content }));
}
