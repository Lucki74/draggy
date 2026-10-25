import { commandRanges } from "../../chat/slashCommands";
import { useState } from "react";
import { Composer, type ComposerProps, type WorkContext } from "../../chat/Composer";
import { translations } from "../../translations";
import type { AppSettings, ChatSession, PermissionMode } from "../../types";
import type { ContextWindowView } from "../../agent/contextBreakdown";

const noop = () => {};

const VIEW = {
    measured: true,
    exact: true,
    usedTokens: 18_400,
    windowTokens: 64_000,
    percent: 28.75,
    rows: [],
    compactAtTokens: 52_000,
    compactSource: "auto",
    details: { toolCount: 12, skillCount: 3, loadedSkills: [] },
} as unknown as ContextWindowView;

/* Dev-only: the composer in its home and docked forms, with stubbed session state. */
const FILES = ["src/chat/Composer.tsx", "src/chat/mentions.ts", "src/ui/gallery/ComposerPreview.tsx", "docs/UI-OVERHAUL-PLAN.md"];

const PROJECT: WorkContext = {
    folder: "draggy",
    branch: "ui-overhaul",
    onShow: noop,
    searchFiles: async (name) => FILES.filter((path) => path.toLowerCase().includes(name.toLowerCase())),
};

export function ComposerPreview({
    generating = false,
    variant = "dock",
    workContext = PROJECT,
    onOpenSettings = noop,
    runSlashCommand = noop,
    language = "en",
    narrow = false,
    model = "qwen3:8b",
    onSendMessage = noop,
    onImageCommand,
    clearAttachments = noop,
}: {
    generating?: boolean;
    variant?: "home" | "dock";
    workContext?: WorkContext;
    onOpenSettings?: (tab: string) => void;
    runSlashCommand?: (id: string) => void;
    language?: keyof typeof translations;
    /** As the composer looks under 640px wide. */
    narrow?: boolean;
    /** Empty for a first run with no model loaded. */
    model?: string;
    onSendMessage?: ComposerProps["onSendMessage"];
    onImageCommand?: ComposerProps["onImageCommand"];
    clearAttachments?: () => void;
}) {
    const t = (key: string) => translations[language][key] || translations.en[key] || key;
    const [input, setInput] = useState("");
    const [settings, setSettings] = useState({ effort: "medium", webMode: "on", language } as AppSettings);
    const [mode, setMode] = useState<PermissionMode>("acceptEdits");

    const props = {
        model,
        chat: { id: "preview", title: "", messages: [], updatedAt: 0, isGenerating: generating } as ChatSession,
        surface: "code",
        settings,
        input,
        setInput,
        attachedFiles: [{ name: "screenshot.png", type: "image/png" }],
        fileErrors: [],
        notice: null,
        micState: "idle",
        micDetail: "",
        slashMatches: [],
        activeSlashIndex: 0,
        modelInfo: null,
        modelProvider: null,
        thinkingUnavailable: false,
        toolsUnavailable: false,
        permissionMode: mode,
        contextView: VIEW,
        compacting: false,
        acceptAttribute: "*",
        compactToolbar: narrow,
        tightToolbar: false,
        speechSupported: true,
        variant,
        t,
        onSendMessage,
        onImageCommand,
        onStopGeneration: noop,
        onDismissOutOfContext: noop,
        onSelectModel: noop,
        onOpenSettings,
        onPatchSettings: (patch: Partial<AppSettings>) => setSettings((s) => ({ ...s, ...patch })),
        onPermissionMode: setMode,
        removeFile: noop,
        clearAttachments,
        handleMicClick: noop,
        runSlashCommand,
        setSlashIndex: noop,
        setCaret: noop,
        chipRanges: commandRanges(input, { surface: "code" }),
        onPaste: noop,
        onDrop: noop,
        processFiles: async () => {},
        setCompactLimit: () => false,
        workContext,
    } as unknown as ComposerProps;

    return <Composer {...props} />;
}
