import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import ContextWheel from "./ContextWheel";
import PermissionPicker from "./PermissionPicker";
import ModelChoices from "../providers/ModelChoices";
import RemoteFilesNotice from "../providers/RemoteFilesNotice";
import { ProviderIcon } from "../providers/ProviderIcon";
import { displayModelName, modelLabel } from "../llama";
import { isRemote } from "../ai/providers";
import { useSlowModel } from "./useSlowModel";
import { parseSlashArgument } from "./slashCommands";
import { FILL_EVENT, insertMention, mentionAt, useMentionHits, type Mention } from "./mentions";
import { isBinary } from "../utils";
import { Chip, Fuse, Icon, IconButton, Menu, Popover, type MenuEntry } from "../ui";
import type { ModelInfo } from "../llama";
import type { ContextWindowView } from "../agent/contextBreakdown";
import type { CompactOutcome } from "../agent/taskManager";
import type { SettingsTab } from "../settings/pages";
import { MicWave } from "./MicWave";
import type {
    AppSettings,
    Attachment,
    ChatSession,
    EffortLevel,
    InstalledSkill,
    PermissionMode,
    ProviderInstance,
} from "../types";
import { allowedEfforts, effectiveEffort, EFFORT_ORDER, nextEffort } from "../ai/effort";
import { EffortSlider } from "./EffortSlider";
import { EFFORT_LABELS } from "../settings/pages";

const MAX_INPUT_HEIGHT = 200;
const WEB_MODE_ORDER: AppSettings["webMode"][] = ["auto", "on", "off"];
const WEB_MODE_LABELS: Record<AppSettings["webMode"], string> = {
    auto: "webAuto",
    on: "webOn",
    off: "webOff",
};

const MODEL_CAPABILITIES = [
    { id: "tools", label: "capabilityTools" },
    { id: "vision", label: "capabilityVision" },
    { id: "thinking", label: "capabilityThinking" },
];

/** Grows the field with its text, up to the cap, and preserves scroll position. */
function fitHeight(field: HTMLTextAreaElement) {
    const prevScroll = field.scrollTop;
    field.style.height = "auto";
    const nextHeight = Math.min(field.scrollHeight, MAX_INPUT_HEIGHT);
    field.style.height = `${nextHeight}px`;
    field.style.overflowY = field.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
    field.scrollTop = prevScroll;
}

const MENU_SKILLS = 6;

type OpenMenu = "permission" | "effort" | "model" | null;

export interface ComposerProps {
    model: string;
    chat: ChatSession;
    surface: "chat" | "code";
    settings: AppSettings;
    skills: InstalledSkill[];
    unavailable?: string;
    input: string;
    setInput: React.Dispatch<React.SetStateAction<string>>;
    attachedFiles: Attachment[];
    fileErrors: string[];
    notice: string | null;
    micState: "idle" | "recording" | "loading" | "transcribing";
    micAnalyser?: AnalyserNode | null;
    micDetail: string;
    slashMatches: Array<{ id: string; label: string; description?: string }>;
    activeSlashIndex: number;
    modelInfo: ModelInfo | null;
    modelProvider?: ProviderInstance | null;
    thinkingUnavailable: boolean;
    toolsUnavailable: boolean;
    permissionMode?: PermissionMode;
    contextView: ContextWindowView;
    compacting: boolean;
    acceptAttribute: string;
    compactToolbar: boolean;
    tightToolbar: boolean;
    speechSupported: boolean;
    /** "home" sits centered on an empty session; "dock" is pinned under the transcript. */
    variant?: "home" | "dock";
    t: (key: string) => string;
    onSendMessage: (content: string, attachments?: Attachment[]) => void;
    onStopGeneration: () => void;
    onContinueGeneration: () => void;
    onDismissOutOfContext: () => void;
    onSelectModel: (name: string) => void;
    onOpenSettings: (tab: SettingsTab) => void;
    onPatchSettings: (patch: Partial<AppSettings>) => void;
    onPermissionMode?: (mode: PermissionMode) => void;
    onCompact?: () => Promise<CompactOutcome>;
    onImageCommand?: (argument: string, attachments: Attachment[]) => void;
    onOpenUsage?: () => void;
    onProjectMemory?: () => void;
    removeFile: (index: number) => void;
    handleMicClick: () => void;
    runSlashCommand: (id: string) => void;
    setSlashIndex: React.Dispatch<React.SetStateAction<number>>;
    onPaste: (e: React.ClipboardEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    processFiles: (files: File[]) => Promise<void>;
    setCompactLimit: (arg: string) => boolean;
    clearAttachments: () => void;
    /** Code mode: the project folder and branch the turn works in. */
    workContext?: WorkContext;
}

export interface WorkContext {
    folder: string;
    branch?: string | null;
    /** Brings the project's files into view. */
    onShow: () => void;
    /** Project files whose name contains the text, as paths relative to the folder. */
    searchFiles?: (name: string) => Promise<string[]>;
}

/* Prompt field, attachments, the mode, effort and model chips, and the token budget meter. */
/** Five small bars, filled up to the level; a dot marks a turn sent lower than asked. */
function EffortMeter({ level, sent }: { level: EffortLevel; sent: EffortLevel }) {
    const at = EFFORT_ORDER.indexOf(level);
    return (
        <span className="relative inline-flex items-end gap-px h-3" aria-hidden="true">
            {EFFORT_ORDER.slice(1).map((step, i) => (
                <span
                    key={step}
                    className={`w-[3px] rounded-pill ${i < at ? "bg-[var(--accent)]" : "bg-rule-strong"}`}
                    style={{ height: `${5 + i * 2}px` }}
                />
            ))}
            {sent !== level && <span className="absolute -top-0.5 -end-1 size-1.5 rounded-pill bg-[var(--accent)]" />}
        </span>
    );
}

export function Composer({
    model,
    chat,
    surface,
    settings,
    skills,
    unavailable: downloading,
    input,
    setInput,
    attachedFiles,
    fileErrors,
    notice,
    micState,
    micAnalyser,
    micDetail,
    slashMatches,
    activeSlashIndex,
    modelInfo,
    modelProvider,
    thinkingUnavailable,
    toolsUnavailable,
    permissionMode,
    contextView,
    compacting,
    acceptAttribute,
    compactToolbar,
    tightToolbar,
    speechSupported,
    variant = "dock",
    t,
    onSendMessage,
    onStopGeneration,
    onContinueGeneration,
    onDismissOutOfContext,
    onSelectModel,
    onOpenSettings,
    onPatchSettings,
    onPermissionMode,
    onCompact,
    onImageCommand,
    onOpenUsage,
    onProjectMemory,
    removeFile,
    handleMicClick,
    runSlashCommand,
    setSlashIndex,
    onPaste,
    onDrop,
    processFiles,
    setCompactLimit,
    clearAttachments,
    workContext,
}: ComposerProps) {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
    const showPermission = surface === "code" && Boolean(permissionMode && onPermissionMode);
    const [mention, setMention] = useState<Mention | null>(null);
    const [mentionIndex, setMentionIndex] = useState(0);
    const mentionHits = useMentionHits(mention?.query ?? null, workContext?.searchFiles);
    const mentioning = Boolean(mention) && mentionHits.length > 0 && slashMatches.length === 0;

    // The palette fills a command in; the caret goes where its value is typed.
    useEffect(() => {
        const focusEnd = () =>
            requestAnimationFrame(() => {
                const field = inputRef.current;
                if (!field) return;
                field.focus();
                field.setSelectionRange(field.value.length, field.value.length);
            });
        window.addEventListener(FILL_EVENT, focusEnd);
        return () => window.removeEventListener(FILL_EVENT, focusEnd);
    }, []);

    // Re-read on every edit and caret move, since the @word is whatever the caret ends.
    const trackMention = (field: HTMLTextAreaElement) => {
        if (!workContext?.searchFiles) return;
        const next = field.selectionStart === field.selectionEnd ? mentionAt(field.value, field.selectionStart) : null;
        setMention((current) => (current?.start === next?.start && current?.query === next?.query ? current : next));
        if (next?.query !== mention?.query) setMentionIndex(0);
    };

    const pickMention = (path: string) => {
        const field = inputRef.current;
        if (!field || !mention) return;
        const next = insertMention(input, mention, field.selectionStart, path);
        setInput(next.text);
        setMention(null);
        requestAnimationFrame(() => {
            field.focus();
            field.setSelectionRange(next.caret, next.caret);
        });
    };

    useLayoutEffect(() => {
        if (inputRef.current) fitHeight(inputRef.current);
    }, [input]);

    // The wrap changes with the width too, as when the field first lays out or the window is resized.
    useEffect(() => {
        const field = inputRef.current;
        if (!field || typeof ResizeObserver === "undefined") return;
        let width = field.clientWidth;
        const observer = new ResizeObserver(() => {
            if (field.clientWidth === width) return;
            width = field.clientWidth;
            fitHeight(field);
        });
        observer.observe(field);
        return () => observer.disconnect();
    }, []);

    // Max is locked in Chat only until picked once: picking it turns the allowance on.
    const lockedEfforts = EFFORT_ORDER.filter((level) => !allowedEfforts(surface, settings.allowMaxInChat).includes(level));
    const flashTimer = useRef<number | undefined>(undefined);
    // Ctrl+Shift+E steps to the next level and shows the slider for a moment, unless motion is reduced.
    const cycleEffort = () => {
        const next = nextEffort(settings.effort, { mode: surface, allowMaxInChat: settings.allowMaxInChat });
        onPatchSettings({ effort: next });
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        setOpenMenu("effort");
        window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setOpenMenu((current) => (current === "effort" ? null : current)), 1200);
    };
    useEffect(() => () => window.clearTimeout(flashTimer.current), []);

    // Claude Code's menu keys: Ctrl+Shift+M mode, Ctrl+Shift+E effort, Ctrl+Shift+I model.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
            const key = event.key.toLowerCase();
            if (key === "e" && !thinkingUnavailable) {
                event.preventDefault();
                cycleEffort();
                return;
            }
            const target: OpenMenu = key === "m" && showPermission ? "permission" : key === "i" ? "model" : null;
            if (!target) return;
            event.preventDefault();
            setOpenMenu((current) => (current === target ? null : target));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [showPermission, thinkingUnavailable, settings.effort, settings.allowMaxInChat, surface]);

    const menuState = (name: Exclude<OpenMenu, null>) => ({
        open: openMenu === name,
        onOpenChange: (next: boolean) => setOpenMenu(next ? name : null),
    });

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        await processFiles(Array.from(files));
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    // With no model loaded there is nothing to send to, so the composer says why and where to get one.
    const noModel = !model && !downloading;
    const slowModel = useSlowModel(model);
    const unavailable = downloading ?? (noModel ? t("composerNoModel") : undefined);
    // Drawing never reaches the chat model, so a missing or downloading one does not block it.
    const drawing = Boolean(onImageCommand) && parseSlashArgument(input.trim())?.id === "image";

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (chat.isGenerating) {
            onStopGeneration();
            return;
        }
        if (unavailable && !drawing) return;

        let sanitizedInput = input.trim();
        if (isBinary(sanitizedInput)) {
            sanitizedInput = "[Invalid text input removed]";
        }

        if (!sanitizedInput && attachedFiles.length === 0) return;

        const command = parseSlashArgument(sanitizedInput);
        if (command?.id === "compact-limit") {
            if (setCompactLimit(command.argument)) {
                setInput("");
                localStorage.removeItem(`draft_${chat.id}`);
            }
            return;
        }

        if (command?.id === "image" && onImageCommand) {
            onImageCommand(command.argument, attachedFiles);
            setInput("");
            localStorage.removeItem(`draft_${chat.id}`);
            clearAttachments();
            return;
        }

        onSendMessage(sanitizedInput, attachedFiles);
        setInput("");
        localStorage.removeItem(`draft_${chat.id}`);
    };

    const webMode = toolsUnavailable ? "off" : settings.webMode;
    // A short list; the slash menu and the Extensions page reach the rest.
    const offeredSkills = skills
        .filter((skill) => !skill.surface || skill.surface === "both" || skill.surface === surface)
        .slice(0, MENU_SKILLS);
    const plusItems: MenuEntry[] = [
        {
            id: "attach",
            label: t("addFiles"),
            icon: <Icon name="file-arrow-up" size={16} />,
            onSelect: () => fileInputRef.current?.click(),
        },
        {
            id: "folder",
            label: t("addFolder"),
            icon: <Icon name="folder-simple-plus" size={16} />,
            onSelect: () => onOpenSettings("library"),
        },
        {
            id: "extensions",
            label: t("extensions"),
            icon: <Icon name="puzzle-piece" size={16} />,
            onSelect: () => onOpenSettings("extensions"),
        },
        ...(offeredSkills.length > 0
            ? [
                  { type: "separator", id: "skills-sep" } as MenuEntry,
                  { type: "heading", id: "skills", label: t("extensionSkills") } as MenuEntry,
                  ...offeredSkills.map<MenuEntry>((skill) => ({
                      id: `skill-${skill.id}`,
                      label: skill.name,
                      title: skill.summary ?? skill.description,
                      onSelect: () => runSlashCommand(skill.id),
                  })),
              ]
            : []),
        { type: "separator", id: "web-sep" },
        { type: "heading", id: "web", label: t("webAccess") },
        ...WEB_MODE_ORDER.map<MenuEntry>((mode) => ({
            id: `web-${mode}`,
            label: t(WEB_MODE_LABELS[mode]),
            checked: webMode === mode,
            disabled: toolsUnavailable && mode !== "off",
            title: toolsUnavailable ? `${displayModelName(model)} ${t("toolsNotNative")}` : undefined,
            onSelect: () => onPatchSettings({ webMode: mode }),
        })),
    ];

    // What a turn actually sends can be lower than the level picked (Chat caps Max): say so on the pill.
    const sentLevel = effectiveEffort({
        asked: settings.effort,
        mode: surface,
        allowMaxInChat: settings.allowMaxInChat,
        canThink: true,
        supported: null,
        slowBlocksThinking: false,
    }).sent;
    const sentNote = sentLevel !== settings.effort ? ` · ${t("effortSentAs").replace("{level}", t(EFFORT_LABELS[sentLevel]))}` : "";

    const modelGlyph = modelProvider ? (
        <ProviderIcon type={modelProvider.type} name={modelProvider.label} size="w-4 h-4" />
    ) : (
        <Icon name={!isRemote(model) ? "cpu" : "cloud"} size={16} />
    );

    const canSend = (input.trim() !== "" || attachedFiles.length > 0) && (!unavailable || drawing);
    const micBusy = micState === "loading" || micState === "transcribing";
    const micLabel =
        micState === "recording"
            ? t("listening")
            : micState === "loading"
              ? `${t("loadingSpeechModel")} ${micDetail}`
              : micState === "transcribing"
                ? t("transcribing")
                : t("voiceInput");

    return (
        <div data-region="composer" tabIndex={-1} className={variant === "dock" ? "px-4 pb-4 pt-2 bg-surface-canvas z-10" : "w-full"}>
            <div className={`${variant === "dock" ? "max-w-[760px]" : "max-w-[720px]"} mx-auto relative`}>
                {mentioning && (
                    <div
                        role="listbox"
                        aria-label={t("mentionFiles")}
                        className="absolute bottom-full mb-2 start-0 end-0 z-40 py-1 max-h-80 overflow-y-auto rounded-sm bg-surface-base shadow-elev-1 float-in"
                    >
                        {mentionHits.map((path, index) => {
                            const cut = path.lastIndexOf("/") + 1;
                            return (
                                <button
                                    key={path}
                                    ref={index === mentionIndex ? (node) => node?.scrollIntoView?.({ block: "nearest" }) : undefined}
                                    type="button"
                                    role="option"
                                    aria-selected={index === mentionIndex}
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        pickMention(path);
                                    }}
                                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-start text-[13px] ${
                                        index === mentionIndex ? "bg-surface-raised text-text-primary" : "text-text-secondary hover:bg-surface-raised"
                                    }`}
                                >
                                    <Icon name="file" size={16} className="flex-shrink-0 text-text-tertiary" />
                                    <span className="font-mono text-[12px] text-text-primary flex-shrink-0">{path.slice(cut)}</span>
                                    {cut > 0 && (
                                        <span dir="ltr" className="min-w-0 truncate font-mono text-[12px] text-text-tertiary">
                                            {path.slice(0, cut - 1)}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}

                {slashMatches.length > 0 && (
                    <div
                        role="listbox"
                        aria-label={t("slashCommands")}
                        className="absolute bottom-full mb-2 start-0 end-0 z-40 py-1 max-h-80 overflow-y-auto rounded-sm bg-surface-base shadow-elev-1 float-in"
                    >
                        {slashMatches.map((command, index) => (
                            <button
                                key={command.id}
                                ref={index === activeSlashIndex ? (node) => node?.scrollIntoView?.({ block: "nearest" }) : undefined}
                                type="button"
                                role="option"
                                aria-selected={index === activeSlashIndex}
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    runSlashCommand(command.id);
                                }}
                                className={`w-full flex items-baseline gap-3 px-3 py-1.5 text-start text-[13px] ${
                                    index === activeSlashIndex ? "bg-surface-raised text-text-primary" : "text-text-secondary hover:bg-surface-raised"
                                }`}
                            >
                                <span className="font-mono text-[12px] text-text-primary flex-shrink-0">/{command.id}</span>
                                <span className="min-w-0 truncate">{command.description ?? t(command.label)}</span>
                            </button>
                        ))}
                    </div>
                )}

                {noModel && (
                    <p role="status" className="mb-2 px-1 text-[13px] text-text-secondary">
                        {t("composerNoModelHint")}{" "}
                        <button
                            type="button"
                            onClick={() => onOpenSettings("models")}
                            className="text-text-primary underline underline-offset-2 decoration-rule-strong hover:decoration-current"
                        >
                            {t("openModels")}
                        </button>
                    </p>
                )}

                {slowModel && surface === "code" && (
                    <p role="status" className="mb-2 px-1 text-[13px] text-text-secondary">
                        {t("slowCodeNotice")}
                    </p>
                )}

                <form
                    onSubmit={handleSubmit}
                    className="relative flex flex-col rounded-lg bg-surface-base border border-rule focus-within:border-rule-strong transition-colors duration-120"
                >
                    {chat.isGenerating && (
                        <div className="absolute inset-x-4 top-0 pointer-events-none">
                            <Fuse label={t("working")} />
                        </div>
                    )}

                    <div className="overflow-hidden rounded-t-lg flex-shrink-0">
                        <RemoteFilesNotice
                            model={model}
                            provider={modelProvider?.label}
                            inProject={surface === "code" && Boolean(onProjectMemory)}
                            t={t}
                        />
                        {chat.isOutOfContext && (
                            <div className="flex items-center gap-3 px-4 py-2 border-b border-rule bg-surface-tint text-[13px]">
                                <Icon name="warning" size={16} className="flex-shrink-0 text-warn" />
                                <p className="flex-1 min-w-0 text-text-primary">{t("outOfContextMessage")}</p>
                                <button
                                    type="button"
                                    onClick={onContinueGeneration}
                                    className="h-7 px-3 rounded-pill text-[12px] font-medium bg-action-bg text-action-fg hover:opacity-90 flex-shrink-0"
                                >
                                    {t("continueGenerating")}
                                </button>
                                <IconButton name="x" label={t("cancel")} size="sm" onClick={onDismissOutOfContext} />
                            </div>
                        )}
                    </div>

                    <textarea
                        ref={inputRef}
                        value={input}
                        aria-label={t("messageModel")}
                        onChange={(e) => {
                            setInput(e.target.value);
                            trackMention(e.target);
                        }}
                        onSelect={(e) => trackMention(e.currentTarget)}
                        onBlur={() => setMention(null)}
                        onPaste={onPaste}
                        onDrop={onDrop}
                        onKeyDown={(e) => {
                            if (mentioning) {
                                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                                    e.preventDefault();
                                    const step = e.key === "ArrowDown" ? 1 : -1;
                                    setMentionIndex((i) => (i + step + mentionHits.length) % mentionHits.length);
                                    return;
                                }
                                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                                    e.preventDefault();
                                    pickMention(mentionHits[Math.min(mentionIndex, mentionHits.length - 1)]);
                                    return;
                                }
                                if (e.key === "Escape") {
                                    e.preventDefault();
                                    setMention(null);
                                    return;
                                }
                            }
                            if (slashMatches.length > 0) {
                                if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    setSlashIndex((i) => (i + 1) % slashMatches.length);
                                    return;
                                }
                                if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                                    return;
                                }
                                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                                    e.preventDefault();
                                    runSlashCommand(slashMatches[activeSlashIndex].id);
                                    return;
                                }
                                if (e.key === "Escape") {
                                    e.preventDefault();
                                    setInput("");
                                    return;
                                }
                            }
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                if (chat.isGenerating) {
                                    onStopGeneration();
                                } else {
                                    handleSubmit();
                                }
                            }
                        }}
                        placeholder={unavailable ?? t(workContext?.searchFiles ? "composerPlaceholderCode" : chat.messages.length > 0 ? "composerReply" : "composerPlaceholder")}
                        className="w-full bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 text-text-primary placeholder:text-text-secondary resize-none overflow-y-auto focus:outline-none"
                        rows={1}
                        style={{ minHeight: variant === "home" ? "72px" : "48px", maxHeight: `${MAX_INPUT_HEIGHT}px` }}
                    />

                    {(notice || fileErrors.length > 0 || attachedFiles.length > 0) && (
                        <div className="px-3 pb-1.5 flex flex-wrap gap-1.5">
                            {notice && (
                                <span role="status" className="inline-flex items-center gap-1.5 h-6 px-2 rounded-pill bg-surface-tint text-[12px] text-text-secondary">
                                    <Icon name="check" size={16} />
                                    {notice}
                                </span>
                            )}
                            {fileErrors.map((message) => (
                                <span
                                    key={message}
                                    role="alert"
                                    className="inline-flex items-center gap-1.5 h-6 px-2 rounded-pill bg-danger/10 text-[12px] text-danger"
                                >
                                    <Icon name="warning-circle" size={16} />
                                    {message}
                                </span>
                            ))}
                            {attachedFiles.map((file, idx) => (
                                <Chip
                                    key={idx}
                                    size="dense"
                                    tabIndex={-1}
                                    className="max-w-[200px] cursor-default"
                                    icon={<Icon name={file.type.startsWith("image/") ? "file-image" : "file-text"} size={16} />}
                                    label={file.name}
                                    onDelete={() => removeFile(idx)}
                                />
                            ))}
                        </div>
                    )}

                    {/* Below 640px the controls take a second line instead of losing their labels. */}
                    <div className={`flex items-center gap-1 px-2 pb-2 pt-1 min-w-0 ${compactToolbar ? "flex-wrap" : ""}`}>
                        <input
                            type="file"
                            multiple
                            accept={acceptAttribute}
                            ref={fileInputRef}
                            className="hidden"
                            onChange={handleFileChange}
                        />
                        <Menu
                            label={t("composerAdd")}
                            side="top"
                            items={plusItems}
                            trigger={(props) => (
                                <IconButton {...props} name="plus" label={t("composerAdd")} size="dense" />
                            )}
                        />

                        {showPermission && (
                            <PermissionPicker
                                mode={permissionMode!}
                                {...menuState("permission")}
                                onPick={onPermissionMode!}
                                toolsUnavailable={toolsUnavailable}
                                t={t}
                            />
                        )}

                        <div className={`flex items-center justify-end gap-1 min-w-0 ${compactToolbar ? "basis-full" : "ms-auto"}`}>
                            {thinkingUnavailable ? (
                                <Chip
                                    disabled
                                    icon={<Icon name="brain" size={16} />}
                                    label={t("effortOff")}
                                    title={`${displayModelName(model)} ${t("thinkingNotSupported")}`}
                                />
                            ) : (
                                <Popover
                                    label={t("effort")}
                                    side="top"
                                    align="end"
                                    className="p-3"
                                    {...menuState("effort")}
                                    trigger={(props) => (
                                        <Chip
                                            {...props}
                                            dropdown
                                            icon={<EffortMeter level={settings.effort} sent={sentLevel} />}
                                            className="max-w-[180px]"
                                            label={
                                                tightToolbar ? (
                                                    <span className="sr-only">{t(EFFORT_LABELS[settings.effort])}</span>
                                                ) : (
                                                    t(EFFORT_LABELS[settings.effort])
                                                )
                                            }
                                            title={`${t("effort")}: ${t(EFFORT_LABELS[settings.effort])} (Ctrl+Shift+E)${sentNote}`}
                                        />
                                    )}
                                >
                                    {() => (
                                        <EffortSlider
                                            value={settings.effort}
                                            onChange={(effort) => onPatchSettings({ effort })}
                                            locked={lockedEfforts}
                                            onLockedPick={(effort) => onPatchSettings({ effort, allowMaxInChat: true })}
                                            t={t}
                                        />
                                    )}
                                </Popover>
                            )}

                            <Popover
                                label={t("model")}
                                side="top"
                                align="end"
                                className="w-72 p-2 flex flex-col gap-2"
                                {...menuState("model")}
                                trigger={(props) => (
                                    <Chip
                                        {...props}
                                        dropdown
                                        icon={modelGlyph}
                                        className="max-w-[220px]"
                                        label={
                                            tightToolbar ? (
                                                <span className="sr-only">{modelLabel(model)}</span>
                                            ) : (
                                                modelLabel(model)
                                            )
                                        }
                                        title={`${modelProvider ? `${modelProvider.label} · ` : ""}${displayModelName(model)} (Ctrl+Shift+I)`}
                                    />
                                )}
                            >
                                {(close) => (
                                    <>
                                        <ModelChoices
                                            open
                                            model={model}
                                            onPick={(name) => {
                                                onSelectModel(name);
                                                close();
                                            }}
                                            t={t}
                                        />
                                        {modelInfo && modelInfo.capabilities.length > 0 && (
                                            <div className="flex flex-wrap gap-1 px-1">
                                                {MODEL_CAPABILITIES.filter((c) => modelInfo.capabilities.includes(c.id)).map((c) => (
                                                    <span key={c.id} className="h-5 px-1.5 inline-flex items-center rounded-pill bg-surface-tint text-[11px] text-text-secondary">
                                                        {t(c.label)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <div className="border-t border-rule -mx-2" />
                                        {(["models", "providers"] as const).map((tab) => (
                                            <button
                                                key={tab}
                                                type="button"
                                                onClick={() => {
                                                    close();
                                                    onOpenSettings(tab);
                                                }}
                                                className="w-full text-start px-2 py-1.5 rounded-xs text-[13px] text-text-primary hover:bg-surface-raised"
                                            >
                                                {t(tab === "models" ? "manageModels" : "providers")}
                                            </button>
                                        ))}
                                    </>
                                )}
                            </Popover>

                            {surface === "code" && (
                                <ContextWheel
                                    view={contextView}
                                    t={t}
                                    compacting={compacting}
                                    onCompact={onCompact ? () => void onCompact() : undefined}
                                    onOpenUsage={onOpenUsage}
                                />
                            )}

                            {micState === "recording" && micAnalyser && <MicWave analyser={micAnalyser} />}

                            {speechSupported && (
                                <IconButton
                                    name={micState === "recording" ? "microphone-slash" : micBusy ? "circle-notch" : "microphone"}
                                    label={micLabel}
                                    size="dense"
                                    disabled={micBusy}
                                    onClick={handleMicClick}
                                    className={`${micBusy ? "[&_svg]:animate-spin" : ""} ${micState === "recording" ? "!text-danger" : ""}`}
                                />
                            )}

                            {chat.isGenerating ? (
                                <IconButton data-stop="true" name="stop" filled label={t("stopGenerating")} shortcut="Esc" size="dense" variant="primary" onClick={onStopGeneration} />
                            ) : (
                                <IconButton
                                    type="submit"
                                    name="arrow-up"
                                    label={t("send")}
                                    size="dense"
                                    variant="primary"
                                    disabled={!canSend}
                                    title={unavailable ?? t("send")}
                                />
                            )}
                        </div>
                    </div>
                </form>

                {workContext && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
                        <Chip
                            size="dense"
                            label={workContext.folder}
                            title={workContext.folder}
                            icon={<Icon name="folder-simple" size={14} />}
                            onClick={workContext.onShow}
                            className="max-w-[16rem]"
                        />
                        {workContext.branch && (
                            <Chip
                                size="dense"
                                label={<span className="font-mono">{workContext.branch}</span>}
                                title={workContext.branch}
                                icon={<Icon name="git-branch" size={14} />}
                                onClick={workContext.onShow}
                                className="max-w-[16rem]"
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
