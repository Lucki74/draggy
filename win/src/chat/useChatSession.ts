import { useEffect, useMemo, useRef, useState } from "react";
import {
    ACCEPTED_EXTENSIONS,
    DOCUMENT_EXTENSIONS,
    IMAGE_EXTENSIONS,
    planAttachment,
} from "./attachments";
import {
    CONTEXT_BUCKETS,
    FALLBACK_CONTEXT_LENGTH,
    getModelInfo,
    needsTextModeTools,
    onModelInfoChange,
    windowCeiling,
} from "../llama";
import { isRemote } from "../ai/providers";
import type { ContextMeasurement } from "../agent/agentLoop";
import {
    MIN_COMPACT_LIMIT,
    contextDetails,
    describeContextWindow,
    formatTokenCount,
    measureBreakdown,
    parseTokenCount,
} from "../agent/contextBreakdown";
import type { ContextBreakdown } from "../agent/contextBreakdown";
import { useLiveTurn } from "../agent/liveTurn";
import { loadedSkillIds } from "../skills/skills";
import { useProviderOf } from "../providers/useProviders";
import { isSpeechSupported, startRecording, transcribe } from "../speech";
import type { Recorder } from "../speech";
import type { ModelInfo } from "../llama";
import type { CompactOutcome } from "../agent/taskManager";
import type { SettingsTab } from "../settings/pages";
import {
    clampSlashIndex,
    matchSlashCommands,
    commandRanges,
    replaceSlashToken,
    slashTokenAt,
} from "./slashCommands";
import { isBinary, writeLocalStorage } from "../utils";
import { appendMention, FILL_EVENT, MENTION_EVENT } from "./mentions";
import type {
    AppSettings,
    Attachment,
    ChatSession,
    InstalledSkill,
} from "../types";
import { swallowed } from "../logger";

const MEASURE_DELAY_MS = 400;

export interface UseChatSessionOptions {
    model: string;
    chat: ChatSession;
    surface: "chat" | "code";
    settings: AppSettings;
    skills: InstalledSkill[];
    seedDraft?: string;
    onSeedUsed?: () => void;
    onNewChat: () => void;
    onOpenSettings: (tab: SettingsTab) => void;
    onPatchSettings: (patch: Partial<AppSettings>) => void;
    onMeasureContext?: (
        draft: string,
        attachments: Attachment[],
        options: { signal: AbortSignal; allowLoad: boolean },
    ) => Promise<ContextMeasurement | null>;
    onCompact?: () => Promise<CompactOutcome>;
    onProjectMemory?: () => void;
    onInitProject?: () => void;
    t: (key: string) => string;
}

const canDecodeImage = async (file: File): Promise<boolean> => {
    if (file.size === 0) return false;
    try {
        const bitmap = await createImageBitmap(file);
        const usable = bitmap.width > 0 && bitmap.height > 0;
        bitmap.close();
        return usable;
    } catch {
        return false;
    }
};

const readDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(file);
    });

/* State coordinator for draft persistence, model telemetry, slash actions and mic input. */
/** Where a chat's unsent text is kept. A chat with nothing sent yet shares one key per mode, so a
 * draft typed on the new chat screen is still there the next time it opens. */
export function draftKeyFor(chat: Pick<ChatSession, "id" | "messages">, surface: "chat" | "code"): string {
    return chat.messages.length === 0 ? `draft_new_${surface}` : `draft_${chat.id}`;
}

export function useChatSession({
    model,
    chat,
    surface,
    settings,
    skills,
    seedDraft,
    onSeedUsed,
    onNewChat,
    onOpenSettings,
    onPatchSettings,
    onMeasureContext,
    onCompact,
    onProjectMemory,
    onInitProject,
    t,
}: UseChatSessionOptions) {
    const draftKey = draftKeyFor(chat, surface);
    const [input, setInput] = useState(() => seedDraft || localStorage.getItem(draftKey) || "");

    useEffect(() => {
        if (seedDraft) onSeedUsed?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const add = (event: Event) => {
            const path = (event as CustomEvent<string>).detail;
            if (typeof path === "string" && path) setInput((text) => appendMention(text, path));
        };
        window.addEventListener(MENTION_EVENT, add);
        return () => window.removeEventListener(MENTION_EVENT, add);
    }, []);

    useEffect(() => {
        const fill = (event: Event) => {
            const text = (event as CustomEvent<string>).detail;
            if (typeof text === "string") setInput(text);
        };
        window.addEventListener(FILL_EVENT, fill);
        return () => window.removeEventListener(FILL_EVENT, fill);
    }, []);

    const [loadedDraftKey, setLoadedDraftKey] = useState(draftKey);
    if (loadedDraftKey !== draftKey) {
        setLoadedDraftKey(draftKey);
        setInput(localStorage.getItem(draftKey) || "");
    }

    useEffect(() => {
        const handle = setTimeout(() => {
            writeLocalStorage(draftKey, input);
        }, 300);
        return () => clearTimeout(handle);
    }, [input, draftKey]);

    const [attachedFiles, setAttachedFiles] = useState<Attachment[]>([]);
    const [fileErrors, setFileErrors] = useState<string[]>([]);
    const [notice, setNotice] = useState<string | null>(null);
    const [micState, setMicState] = useState<"idle" | "recording" | "loading" | "transcribing">("idle");
    const [micDetail, setMicDetail] = useState("");
    const [micAnalyser, setMicAnalyser] = useState<AnalyserNode | null>(null);
    const [slashIndex, setSlashIndex] = useState(0);
    // Where the caret is in the field, so a /command typed mid-message opens the menu too.
    const [caret, setCaret] = useState<number | null>(null);
    const [lastSlashQuery, setLastSlashQuery] = useState<string | null>(null);
    const recorderRef = useRef<Recorder | null>(null);

    const [probedModel, setProbedModel] = useState<{ model: string; info: ModelInfo | null }>({
        model,
        info: null,
    });
    const modelProvider = useProviderOf(model);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;

        const probe = (attempt: number) => {
            getModelInfo(model).then((info) => {
                if (cancelled) return;
                if (info) setProbedModel({ model, info });
                else if (attempt < 5) timer = setTimeout(() => probe(attempt + 1), 3000);
            });
        };
        probe(0);

        const stopListening = onModelInfoChange(() => probe(0));
        return () => {
            cancelled = true;
            clearTimeout(timer);
            stopListening();
        };
    }, [model]);

    const modelInfo = probedModel.model === model ? probedModel.info : null;
    const thinkingUnavailable = modelInfo !== null && !modelInfo.capabilities.includes("thinking");
    const toolsUnavailable = needsTextModeTools(modelInfo);

    useEffect(() => {
        return () => recorderRef.current?.cancel();
    }, []);

    const handleMicClick = async () => {
        if (micState === "loading" || micState === "transcribing") return;

        if (micState === "recording") {
            const recorder = recorderRef.current;
            recorderRef.current = null;
            if (!recorder) {
                setMicState("idle");
                return;
            }

            setMicAnalyser(null);
            setMicState("transcribing");
            setMicDetail("");
            try {
                const audio = await recorder.stop();
                const text = await transcribe(audio, {
                    language: settings.language,
                    onProgress: (progress) => {
                        setMicState("loading");
                        setMicDetail(`${Math.round(progress.percent)}%`);
                    },
                });
                if (text) {
                    setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
                }
            } catch (err) {
                setFileErrors([err instanceof Error ? err.message : t("micUnavailable")]);
            } finally {
                setMicState("idle");
                setMicDetail("");
            }
            return;
        }

        try {
            recorderRef.current = await startRecording();
            setMicAnalyser(recorderRef.current.analyser);
            setMicState("recording");
        } catch {
            setFileErrors([t("micUnavailable")]);
            setMicState("idle");
        }
    };

    const runCompact = async () => {
        if (!onCompact) return;
        const outcome = await onCompact();
        if (outcome === "nothing") setNotice(t("nothingToCompact"));
        else if (outcome === "busy") setNotice(t("compactWhileBusy"));
        else if (outcome === "failed") setFileErrors([t("compactFailed")]);
    };

    const clearAttachments = () => {
        setAttachedFiles([]);
        setFileErrors([]);
    };

    const setCompactLimit = (argument: string) => {
        const limit = parseTokenCount(argument);
        if (limit === undefined || (limit !== null && limit < MIN_COMPACT_LIMIT)) {
            setFileErrors([t("compactLimitInvalid")]);
            return false;
        }

        onPatchSettings({ compactLimit: limit });
        setNotice(
            limit === null
                ? t("compactLimitCleared")
                : t("compactLimitSet").replace("{count}", formatTokenCount(limit)),
        );
        return true;
    };

    const runSlashCommand = (id: string): number | void => {
        if (id === "compact-limit" || id === "image" || skills.some((skill) => skill.id === id)) {
            const token = slashTokenAt(input, Math.min(caret ?? input.length, input.length));
            if (!token) {
                setInput(`/${id} `);
                return;
            }
            const next = replaceSlashToken(input, token, id);
            setInput(next.text);
            setCaret(next.caret);
            return next.caret;
        }

        setInput("");
        if (id === "new") onNewChat();
        else if (id === "compact") void runCompact();
        else if (id === "settings") onOpenSettings(surface);
        else if (id === "voice") void handleMicClick();
        else if (id === "memory") onProjectMemory?.();
        else if (id === "init") onInitProject?.();
    };

    useEffect(() => {
        if (fileErrors.length === 0) return;
        const handle = setTimeout(() => setFileErrors([]), 6000);
        return () => clearTimeout(handle);
    }, [fileErrors]);

    useEffect(() => {
        if (!notice) return;
        const handle = setTimeout(() => setNotice(null), 4000);
        return () => clearTimeout(handle);
    }, [notice]);

    const removeFile = (index: number) => {
        setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const visionSupported = modelInfo === null || modelInfo.capabilities.includes("vision");
    const documentsSupported = Boolean(window.electronAPI);

    const acceptAttribute = ACCEPTED_EXTENSIONS.filter(
        (extension) => documentsSupported || !DOCUMENT_EXTENSIONS.includes(extension),
    )
        .concat(visionSupported ? IMAGE_EXTENSIONS : [])
        .map((extension) => "." + extension)
        .join(",");

    const processFiles = async (files: File[]) => {
        const accepted: Attachment[] = [];
        const rejected: string[] = [];

        for (const file of files) {
            const plan = planAttachment(file, { visionSupported });

            if (plan.kind === "reject") {
                rejected.push(`${file.name} - ${t(plan.reason)}`);
                continue;
            }

            try {
                if (plan.kind === "image") {
                    if (!(await canDecodeImage(file))) {
                        rejected.push(`${file.name} - ${t("unreadableImage")}`);
                        continue;
                    }

                    accepted.push({
                        name: file.name,
                        type: file.type || `image/${plan.extension || "png"}`,
                        content: await readDataUrl(file),
                    });
                    continue;
                }

                if (plan.kind === "document") {
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    const parsed = await window.electronAPI?.readDocument(file.name, bytes);

                    if (!parsed?.success || !parsed.text) {
                        rejected.push(`${file.name} - ${parsed?.error || t("unsupportedFile")}`);
                        continue;
                    }

                    accepted.push({
                        name: file.name,
                        type: file.type || "application/octet-stream",
                        content: parsed.text,
                    });
                    continue;
                }

                const content = await file.text();
                if (isBinary(content)) {
                    rejected.push(`${file.name} - ${t("unsupportedFile")}`);
                    continue;
                }

                accepted.push({
                    name: file.name,
                    type: file.type || "text/plain",
                    content,
                });
            } catch {
                rejected.push(`${file.name} - ${t("unsupportedFile")}`);
            }
        }

        if (accepted.length > 0) {
            setAttachedFiles((prev) => [...prev, ...accepted]);
        }
        setFileErrors(rejected);
    };

    const chipRanges = useMemo(() => commandRanges(input, { surface, skills }), [input, surface, skills]);
    const slashQuery = slashTokenAt(input, Math.min(caret ?? input.length, input.length))?.query ?? null;
    const slashMatches = matchSlashCommands(input, { surface, skills, caret: caret ?? undefined });

    if (lastSlashQuery !== slashQuery) {
        setLastSlashQuery(slashQuery);
        setSlashIndex(0);
    }
    const activeSlashIndex = clampSlashIndex(slashIndex, slashMatches.length);

    const lastMetrics = useMemo(() => {
        for (let i = chat.messages.length - 1; i >= 0; i--) {
            const message = chat.messages[i];
            if (message.role !== "assistant") continue;

            const versionIndex = message.currentVersionIndex;
            const active =
                message.versions && versionIndex !== undefined && versionIndex < message.versions.length
                    ? message.versions[versionIndex]
                    : message;

            if (active.metrics) return active.metrics;
        }
        return null;
    }, [chat.messages]);

    const compacting = chat.messages.some((message) => message.fold?.status === "running");
    const live = useLiveTurn(chat.id);
    const drafting = input.trim().length > 0 || attachedFiles.length > 0;
    const lastMessage = chat.messages[chat.messages.length - 1];

    const historyKey = [
        model,
        chat.id,
        chat.messages.length,
        lastMessage?.id ?? "",
        lastMessage?.content.length ?? 0,
        settings.effort,
        settings.webMode,
        chat.compaction?.throughIndex ?? -1,
    ].join("|");
    const measureKey = `${historyKey}|${input}|${attachedFiles.map((file) => file.name).join(",")}`;

    const [measured, setMeasured] = useState<{
        key: string;
        historyKey: string;
        drafted: boolean;
        value: ContextMeasurement;
    } | null>(null);
    const [undrafted, setUndrafted] = useState<{ historyKey: string; tokens: number } | null>(null);

    useEffect(() => {
        if (!onMeasureContext || chat.isGenerating) return;

        const controller = new AbortController();
        const timer = setTimeout(
            () => {
                onMeasureContext(input, attachedFiles, { signal: controller.signal, allowLoad: false })
                    .then((value) => {
                        if (!value || controller.signal.aborted) return;
                        setMeasured({ key: measureKey, historyKey, drafted: drafting, value });
                        if (!drafting) setUndrafted({ historyKey, tokens: value.tokens });
                    })
                    .catch(swallowed("chat", "best effort, the screen works without it"));
            },
            drafting ? MEASURE_DELAY_MS : 0,
        );

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [measureKey, chat.isGenerating, onMeasureContext]);

    const current = measured?.key === measureKey ? measured : null;
    const lastTotal = lastMetrics ? lastMetrics.promptTokens + lastMetrics.responseTokens : null;

    let usedTokens: number | null = null;
    let exactFigure = true;
    let loadedTokens = lastMetrics?.contextWindow ?? null;
    let draftTokens = 0;

    if (chat.isGenerating && live) {
        usedTokens = live.contextTokens;
        exactFigure = live.contextExact;
        loadedTokens = live.contextWindow;
    } else if (chat.isGenerating && measured?.drafted) {
        usedTokens = measured.value.tokens;
        loadedTokens = measured.value.window;
    } else if (current) {
        usedTokens = current.value.tokens;
        loadedTokens = current.value.window;
        if (current.drafted && undrafted?.historyKey === historyKey) {
            draftTokens = Math.max(0, current.value.tokens - undrafted.tokens);
        }
    } else if (measured?.historyKey === historyKey) {
        usedTokens = measured.value.tokens;
        exactFigure = false;
        loadedTokens = measured.value.window;
    } else if (!chat.isGenerating && lastTotal !== null && lastMessage?.role === "assistant") {
        usedTokens = lastTotal;
    }

    const parts = live?.parts ?? measured?.value.parts ?? null;
    const contextBreakdown: ContextBreakdown | null =
        usedTokens === null
            ? null
            : parts
              ? measureBreakdown(parts, usedTokens)
              : lastMetrics?.breakdown && usedTokens === lastTotal
                ? lastMetrics.breakdown
                : { messages: usedTokens, system: 0, tools: 0, memory: 0, skills: 0, loadedSkills: 0, summary: 0 };

    const loadedSkillNames = loadedSkillIds(chat.messages, skills).map((id) => ({
        id,
        name: skills.find((skill) => skill.id === id)?.name ?? id,
    }));

    const contextView = describeContextWindow({
        breakdown: contextBreakdown,
        draftTokens,
        exact: exactFigure,
        windowTokens: settings.fixedContextSize === "max"
            ? (modelInfo?.contextLength ?? FALLBACK_CONTEXT_LENGTH)
            : typeof settings.fixedContextSize === "number"
              ? settings.fixedContextSize
              : isRemote(model)
                ? windowCeiling(modelInfo?.contextLength ?? null, loadedTokens ?? 0)
                : Math.min(
                    CONTEXT_BUCKETS[CONTEXT_BUCKETS.length - 1],
                    windowCeiling(modelInfo?.contextLength ?? null, loadedTokens ?? 0),
                ),
        limitTokens: settings.compactLimit ?? null,
        paid: modelInfo?.cloud === true,
        details: contextDetails(parts, loadedSkillNames),
    });

    return {
        input,
        setInput,
        attachedFiles,
        fileErrors,
        notice,
        micState,
        micDetail,
        micAnalyser,
        slashMatches,
        activeSlashIndex,
        setSlashIndex,
        setCaret,
        chipRanges,
        modelInfo,
        modelProvider,
        thinkingUnavailable,
        toolsUnavailable,
        contextView,
        compacting,
        acceptAttribute,
        speechSupported: isSpeechSupported(),
        handleMicClick,
        runCompact,
        setCompactLimit,
        clearAttachments,
        runSlashCommand,
        removeFile,
        processFiles,
    };
}
