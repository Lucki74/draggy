import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import InView from "./chat/InView";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Loader2,
  ChevronRight,
  Check,
  Square,
  Globe,
  FileText,
  FileUp,
  X,
  Plus,
  Brain,
  ImageIcon,
  File,
  Cpu,
  AlertTriangle,
  Mic,
  MicOff,
} from "lucide-react";
import Logo from "./Logo";
import { pickGreeting } from "./greetings";
import TypedGreeting from "./TypedGreeting";
import MessageItem from "./chat/MessageItem";
import ContextWheel from "./chat/ContextWheel";
import CrossedIcon from "./chat/CrossedIcon";
import PermissionPicker from "./chat/PermissionPicker";
import { useToollessPlan } from "./chat/useToollessPlan";
import {
  MIN_COMPACT_LIMIT,
  contextDetails,
  describeContextWindow,
  formatTokenCount,
  measureBreakdown,
  parseTokenCount,
} from "./agent/contextBreakdown";
import { loadedSkillIds } from "./skills/skills";
import type { ContextBreakdown } from "./agent/contextBreakdown";
import { useLiveTurn } from "./agent/liveTurn";
import type { CompactOutcome } from "./agent/taskManager";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async";
import {
} from "./chat/markdown";
import { selectableModels } from "./modelKinds";
import type { SettingsTab } from "./settings/pages";
import { translations } from "./translations";
import {
  copyText,
  isBinary,
  writeLocalStorage,
} from "./utils";
import {
  FALLBACK_CONTEXT_LENGTH,
  displayModelName,
  getModelInfo,
  isCloudModel,
  listInstalledModels,
  needsTextModeTools,
  onModelInfoChange,
  warmModel,
  windowCeiling,
} from "./llama";
import { KEEP_ALIVE } from "./agent/agentLoop";
import type { ContextMeasurement } from "./agent/agentLoop";
import {
  ACCEPTED_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  planAttachment,
} from "./chat/attachments";
import {
  clampSlashIndex,
  matchSlashCommands,
  parseSlashArgument,
  slashQueryFor,
} from "./chat/slashCommands";
import { isSpeechSupported, startRecording, transcribe } from "./speech";
import type { Recorder } from "./speech";
import type { InstalledModel, ModelInfo } from "./llama";

const MAX_INPUT_HEIGHT = 150;

/** How long typing pauses before the model is asked how big the next turn would be. */
const MEASURE_DELAY_MS = 400;

const THINKING_ORDER: AppSettings["thinkingMode"][] = ["low", "medium", "high"];
const WEB_MODE_ORDER: AppSettings["webMode"][] = ["auto", "on", "off"];

const WEB_MODE_LABELS: Record<AppSettings["webMode"], string> = {
  auto: "webAuto",
  on: "webOn",
  off: "webOff",
};

const nextThinkingMode = (current: AppSettings["thinkingMode"]) =>
  THINKING_ORDER[(THINKING_ORDER.indexOf(current) + 1) % THINKING_ORDER.length];

const nextWebMode = (current: AppSettings["webMode"]) =>
  WEB_MODE_ORDER[(WEB_MODE_ORDER.indexOf(current) + 1) % WEB_MODE_ORDER.length];

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });

// A file named .jpg is not necessarily a JPEG. Decoding it here turns a
// cryptic model error into a clear message at the point of upload.
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

const MODEL_CAPABILITIES = [
  { id: "tools", label: "capabilityTools" },
  { id: "vision", label: "capabilityVision" },
  { id: "thinking", label: "capabilityThinking" },
];

/** One shared empty list, so a screen without skills does not see a new one every render. */
const NO_SKILLS: InstalledSkill[] = [];


import type {
  ApprovalAnswer,
  ChatSession,
  AppSettings,
  Attachment,
  InstalledSkill,
  PermissionMode,
} from "./types";

interface ChatScreenProps {
  model: string;
  chat: ChatSession;
  onSendMessage: (content: string, attachments?: Attachment[]) => void;
  onRegenerate: (index: number) => void;
  onSwitchVersion: (messageIndex: number, versionIndex: number) => void;
  onEditMessage: (messageIndex: number, newContent: string) => void;
  onStopGeneration: () => void;
  onContinueGeneration: () => void;
  onDismissOutOfContext: () => void;
  onSelectModel: (name: string) => void;
  onOpenSettings: (tab: SettingsTab) => void;
  onNewChat: () => void;
  /** Which side this is. Code adds the permission picker, running code and the project commands. */
  surface: "chat" | "code";
  /** The skills switched on for this side, each one a slash command too. */
  skills?: InstalledSkill[];
  /** The settings this side runs with. */
  settings: AppSettings;
  /** A change from the composer, which the shell writes to this side's own settings. */
  onPatchSettings: (patch: Partial<AppSettings>) => void;
  /** The project's permission mode. Code only. */
  permissionMode?: PermissionMode;
  onPermissionMode?: (mode: PermissionMode) => void;
  /** Answers a tool call the model is waiting on the user for. */
  onApproval?: (approvalId: string, answer: ApprovalAnswer) => void;
  /** Puts a file back the way it was before Draggy changed it. */
  onRevert?: (checkpointId: number) => Promise<boolean>;
  /** Opens the project's instruction file. Absent outside a project. */
  onProjectMemory?: () => void;
  /** Writes a first draft of that file from what is in the folder. */
  onInitProject?: () => void;
  /** Folds the older conversation into notes now. */
  onCompact?: () => Promise<CompactOutcome>;
  /** Asks the model how many tokens the next turn takes, draft included. */
  onMeasureContext?: (
    draft: string,
    attachments: Attachment[],
    options: { signal: AbortSignal; allowLoad: boolean },
  ) => Promise<ContextMeasurement | null>;
}

export default function ChatScreen({
  model,
  chat,
  onSendMessage,
  onRegenerate,
  onSwitchVersion,
  onEditMessage,
  onStopGeneration,
  onContinueGeneration,
  onDismissOutOfContext,
  onSelectModel,
  onOpenSettings,
  onNewChat,
  surface,
  skills = NO_SKILLS,
  settings,
  onPatchSettings,
  permissionMode,
  onPermissionMode,
  onApproval,
  onRevert,
  onProjectMemory,
  onInitProject,
  onCompact,
  onMeasureContext,
}: ChatScreenProps) {
  const t = useCallback(
    (key: string) =>
      translations[settings.language]?.[key] || translations["en"][key] || key,
    [settings.language],
  );

  const draftKey = `draft_${chat.id}`;
  const [input, setInput] = useState(
    () => localStorage.getItem(draftKey) || "",
  );
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

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<Attachment[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  /** A short confirmation, like a limit that was just set. Clears itself. */
  const [notice, setNotice] = useState<string | null>(null);
  const [micState, setMicState] = useState<
    "idle" | "recording" | "loading" | "transcribing"
  >("idle");
  const [micDetail, setMicDetail] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [lastSlashQuery, setLastSlashQuery] = useState<string | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const [probedModel, setProbedModel] = useState<{
    model: string;
    info: ModelInfo | null;
  }>({ model, info: null });
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);

  const modelInfo = probedModel.model === model ? probedModel.info : null;
  // Only when the model has said so: a probe that has not answered yet is not proof of anything.
  const thinkingUnavailable = modelInfo !== null && !modelInfo.capabilities.includes("thinking");
  const toolsUnavailable = needsTextModeTools(modelInfo);
  useToollessPlan({ active: surface === "code", toolsUnavailable, permissionMode, onPermissionMode });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAtBottom = useRef(true);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const preload = (
      SyntaxHighlighter as unknown as { preload?: () => Promise<unknown> }
    ).preload;
    if (!preload) return;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => preload());
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(preload, 2000);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const probe = (attempt: number) => {
      getModelInfo(model).then((info) => {
        if (cancelled) return;
        if (info) setProbedModel({ model, info });
        else if (attempt < 5)
          timer = setTimeout(() => probe(attempt + 1), 3000);
      });
    };
    probe(0);

    // Starting the model can show it reads fewer things than its files promised.
    const stopListening = onModelInfoChange(() => probe(0));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopListening();
    };
  }, [model]);

  useEffect(() => {
    if (!isModelMenuOpen) return;
    let cancelled = false;
    listInstalledModels()
      .then((models) => {
        if (!cancelled) setInstalledModels(selectableModels(models));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isModelMenuOpen]);

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [input]);

  // The toolbar is sized to the composer, not the window: with a panel open beside the chat, a
  // wide window still leaves it narrow, and the pills ran out past its border.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarWidth, setToolbarWidth] = useState(Infinity);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setToolbarWidth(Math.round(entry.contentRect.width)));
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  const compactToolbar = toolbarWidth < 640;
  const tightToolbar = toolbarWidth < 420;

  const lastScrollTop = useRef(0);
  const draggingScroll = useRef(false);

  // Only the user lets go of the bottom. Scrolls the app makes itself, and layout shifts, fire
  // events far from it too, and used to stop the view following a new reply.
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } =
      scrollContainerRef.current;
    if (scrollHeight - scrollTop - clientHeight < 100) isAtBottom.current = true;
    else if (draggingScroll.current && scrollTop < lastScrollTop.current) isAtBottom.current = false;
    lastScrollTop.current = scrollTop;
  };

  const scrollInput = {
    onWheel: (event: React.WheelEvent) => {
      if (event.deltaY < 0) isAtBottom.current = false;
    },
    onPointerDown: () => {
      draggingScroll.current = true;
    },
    onPointerUp: () => {
      draggingScroll.current = false;
    },
    onTouchStart: () => {
      draggingScroll.current = true;
    },
    onTouchEnd: () => {
      draggingScroll.current = false;
    },
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (isAtBottom.current) {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
  };

  useEffect(() => {
    if (chat.isGenerating) return;
    scrollToBottom("smooth");
  }, [chat.messages, chat.isGenerating]);

  // Words are revealed between updates, so while a reply streams, and briefly after, the view
  // follows every frame rather than every update.
  useEffect(() => {
    let frame = 0;
    const until = chat.isGenerating ? Infinity : performance.now() + 1200;

    const follow = (now: number) => {
      const box = scrollContainerRef.current;
      if (box && isAtBottom.current && box.scrollHeight - box.scrollTop - box.clientHeight > 1) {
        box.scrollTop = box.scrollHeight;
      }
      if (now < until) frame = requestAnimationFrame(follow);
    };

    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [chat.isGenerating]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(event.target as Node)
      ) {
        setIsModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await processFiles(Array.from(files));
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    let hasFiles = false;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        const file = items[i].getAsFile();
        if (file) {
          files.push(file);
          hasFiles = true;
        }
      }
    }
    if (hasFiles) {
      e.preventDefault();
      await processFiles(files);
    }
  };

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
          // HEIC photos and truncated downloads look plausible and decode to
          // nothing. This needs the file, so it cannot sit with the rules.
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
            // A PDF fails in more ways than "wrong format": a scan, or a
            // password. The reader says which, which is worth saying.
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    await processFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  useEffect(() => {
    return () => recorderRef.current?.cancel();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isModelMenuOpen) setIsModelMenuOpen(false);
        else if (chat.isGenerating) onStopGeneration();
        return;
      }

      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();

      if (key === "k") {
        event.preventDefault();
        setIsModelMenuOpen((open) => !open);
      } else if (key === "n") {
        event.preventDefault();
        onNewChat();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isModelMenuOpen, chat.isGenerating, onStopGeneration, onNewChat]);

  const handleMicClick = async () => {
    if (micState === "loading" || micState === "transcribing") return;

    if (micState === "recording") {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (!recorder) {
        setMicState("idle");
        return;
      }

      setMicState("transcribing");
      setMicDetail("");
      try {
        const audio = await recorder.stop();
        const text = await transcribe(audio, (progress) => {
          setMicState("loading");
          setMicDetail(`${Math.round(progress.percent)}%`);
        });
        if (text) {
          setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
          inputRef.current?.focus();
        }
      } catch (err) {
        setFileErrors([
          err instanceof Error ? err.message : t("micUnavailable"),
        ]);
      } finally {
        setMicState("idle");
        setMicDetail("");
      }
      return;
    }

    try {
      recorderRef.current = await startRecording();
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

  /** "/compact-limit 20k", read once the menu has closed on the space. */
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

  const runSlashCommand = (id: string) => {
    // A command that needs a value keeps its name in the box for the value, and so does a skill,
    // which runs with whatever is typed after it.
    if (id === "compact-limit" || skills.some((skill) => skill.id === id)) {
      setInput(`/${id} `);
      inputRef.current?.focus();
      return;
    }

    setInput("");
    if (id === "new") onNewChat();
    else if (id === "compact") void runCompact();
    else if (id === "model") setIsModelMenuOpen(true);
    else if (id === "settings") onOpenSettings(surface);
    else if (id === "files") fileInputRef.current?.click();
    else if (id === "voice") handleMicClick();
    else if (id === "web") {
      onPatchSettings({ webMode: nextWebMode(settings.webMode) });
    } else if (id === "think") {
      onPatchSettings({ thinkingMode: nextThinkingMode(settings.thinkingMode) });
    } else if (id === "permissions") setPermissionMenuOpen(true);
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

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (chat.isGenerating) {
      onStopGeneration();
      return;
    }

    let sanitizedInput = input.trim();
    if (isBinary(sanitizedInput)) {
      sanitizedInput = "[Invalid text input removed]";
    }

    if (!sanitizedInput && attachedFiles.length === 0) return;

    const command = parseSlashArgument(sanitizedInput);

    if (command?.id === "compact-limit") {
      if (setCompactLimit(command.argument)) {
        setInput("");
        localStorage.removeItem(draftKey);
      }
      return;
    }

    onSendMessage(sanitizedInput, attachedFiles);
    setInput("");
    localStorage.removeItem(draftKey);
    setAttachedFiles([]);
    setFileErrors([]);
    isAtBottom.current = true;
  };

  const copyToClipboard = useCallback(async (text: string, idx: number) => {
    if (!(await copyText(text))) return;
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  }, []);

  const greeting = useMemo(
    () => pickGreeting(settings.language, chat.id),
    [settings.language, chat.id],
  );

  /** The last turn's figures, counted by the model. */
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

  /** A fold under way in this conversation, shown on the wheel. */
  const compacting = chat.messages.some((message) => message.fold?.status === "running");

  const live = useLiveTurn(chat.id);
  const drafting = input.trim().length > 0 || attachedFiles.length > 0;
  const lastMessage = chat.messages[chat.messages.length - 1];

  // What a count is for: the model, the conversation as it stands, and the draft on top.
  const historyKey = [
    model,
    chat.id,
    chat.messages.length,
    lastMessage?.id ?? "",
    lastMessage?.content.length ?? 0,
    settings.thinkingMode,
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

  // No guessing: the meter shows what the model counts for the exact prompt the next turn sends.
  // Asked only when that costs a reply nothing, and given up the moment one starts.
  useEffect(() => {
    if (!onMeasureContext || chat.isGenerating) return;

    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        onMeasureContext(input, attachedFiles, { signal: controller.signal, allowLoad: drafting })
          .then((value) => {
            if (!value || controller.signal.aborted) return;
            setMeasured({ key: measureKey, historyKey, drafted: drafting, value });
            if (!drafting) setUndrafted({ historyKey, tokens: value.tokens });
          })
          .catch(() => undefined);
      },
      drafting ? MEASURE_DELAY_MS : 0,
    );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // The key stands for the draft, the attachments and the conversation it was taken from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureKey, chat.isGenerating, onMeasureContext]);

  // Loading on the first keystroke hides the load behind composing time. Loading through a count
  // sizes the window exactly as the turn will and fills the cache it reads from.
  const warmedForModelRef = useRef<string | null>(null);
  useEffect(() => {
    if (!input.trim()) {
      warmedForModelRef.current = null;
      return;
    }
    if (warmedForModelRef.current === model || isCloudModel(model)) return;
    warmedForModelRef.current = model;

    if (onMeasureContext) {
      void onMeasureContext(input, attachedFiles, {
        signal: new AbortController().signal,
        allowLoad: true,
      }).catch(() => undefined);
    } else {
      warmModel(model, KEEP_ALIVE, 0, settings.fixedContextSize).catch(() => undefined);
    }
    // Only the first keystroke for a model loads it; later ones are counted above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, model]);

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
    // The count taken of the draft just sent, until the turn reports its own.
    usedTokens = measured.value.tokens;
    loadedTokens = measured.value.window;
  } else if (current) {
    usedTokens = current.value.tokens;
    loadedTokens = current.value.window;
    if (current.drafted && undrafted?.historyKey === historyKey) {
      draftTokens = Math.max(0, current.value.tokens - undrafted.tokens);
    }
  } else if (measured?.historyKey === historyKey) {
    // The draft changed and its count is on the way: the last one stands in, marked as such.
    usedTokens = measured.value.tokens;
    exactFigure = false;
    loadedTokens = measured.value.window;
  } else if (!chat.isGenerating && lastTotal !== null && lastMessage?.role === "assistant") {
    usedTokens = lastTotal;
  }

  // The total is the model's; the parts are its prompt pieces measured out of that total.
  const parts = measured?.value.parts ?? null;
  const contextBreakdown: ContextBreakdown | null =
    usedTokens === null
      ? null
      : parts
        ? measureBreakdown(parts, usedTokens)
        : lastMetrics?.breakdown && usedTokens === lastTotal
          ? lastMetrics.breakdown
          : { messages: usedTokens, system: 0, tools: 0, memory: 0, skills: 0, loadedSkills: 0, summary: 0 };

  // Named from the conversation itself when no measured parts say what each one costs.
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
      : windowCeiling(modelInfo?.contextLength ?? null, loadedTokens ?? 0),
    limitTokens: settings.compactLimit ?? null,
    details: contextDetails(parts, loadedSkillNames),
  });
  const speechSupported = isSpeechSupported();
  const documentsSupported = Boolean(window.electronAPI);
  const visionSupported =
    modelInfo === null || modelInfo.capabilities.includes("vision");

  // What the picker offers. Documents need the main process and images need a
  // model that can see, so neither is listed when it would only be refused.
  const acceptAttribute = ACCEPTED_EXTENSIONS.filter(
    (extension) => documentsSupported || !DOCUMENT_EXTENSIONS.includes(extension),
  )
    .concat(visionSupported ? IMAGE_EXTENSIONS : [])
    .map((extension) => "." + extension)
    .join(",");

  const slashQuery = slashQueryFor(input);
  const slashMatches = matchSlashCommands(input, { surface, skills });

  if (lastSlashQuery !== slashQuery) {
    setLastSlashQuery(slashQuery);
    setSlashIndex(0);
  }

  const activeSlashIndex = clampSlashIndex(slashIndex, slashMatches.length);

  return (
    <div
      className="w-full h-full flex flex-col bg-[var(--bg-base)] relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-blue-500/20 backdrop-blur-sm flex items-center justify-center border-4 border-dashed border-blue-500 m-4 rounded-3xl pointer-events-none"
          >
            <div className="flex flex-col items-center space-y-4">
              <FileUp className="w-20 h-20 text-blue-500 animate-bounce" />
              <p className="text-2xl font-bold text-blue-500 uppercase tracking-widest">
                {t("dropFiles")}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pt-2 drag-region h-6 flex-shrink-0 w-full z-10" />

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        {...scrollInput}
        className="flex-1 overflow-y-auto p-6 space-y-6 pt-10"
      >
        {chat.messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] space-y-4">
            <Logo className="w-24 h-24 opacity-40" />
            <TypedGreeting
              key={greeting}
              text={greeting}
              className="text-xl font-bold uppercase tracking-wider"
            />
          </div>
        )}

        {chat.messages.map((msg, idx) => (
          <InView
            key={msg.id}
            estimatedHeight={100}
            forceRender={idx === chat.messages.length - 1 && chat.isGenerating}
          >
            <ErrorBoundary>
              {/* Messages above are folded into notes: still shown and searchable, but the model reads
                  the summary. Saying so turns "it forgot" into "it condensed". */}
              {chat.compaction?.throughIndex === idx && (
                <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-[var(--border-light)]" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap">
                    {t("earlierCondensed")}
                  </span>
                  <div className="h-px flex-1 bg-[var(--border-light)]" />
                </div>
              )}
              <MessageItem
                chatId={chat.id}
                msg={msg}
                idx={idx}
                isGenerating={chat.isGenerating}
                isLast={idx === chat.messages.length - 1}
                onRegenerate={onRegenerate}
                onSwitchVersion={onSwitchVersion}
                copiedIndex={copiedIndex}
                copyToClipboard={copyToClipboard}
                settings={settings}
                onEditMessage={onEditMessage}
                onApproval={onApproval}
                onRevert={onRevert}
              />
            </ErrorBoundary>
          </InView>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-6 bg-[var(--bg-base)] border-t-[3px] border-[var(--border-light)] shadow-[0_-4px_0_var(--border-light)] z-10">
        <div className="max-w-5xl mx-auto relative">
          {slashMatches.length > 0 && (
            <div className="absolute bottom-full mb-2 left-0 right-0 ui-box p-2 z-40 flex flex-col gap-1 max-h-80 overflow-y-auto">
              {slashMatches.map((command, index) => (
                <button
                  key={command.id}
                  // Skills make the list longer than the box, so the row the arrows reach scrolls in.
                  ref={index === activeSlashIndex ? (node) => node?.scrollIntoView?.({ block: "nearest" }) : undefined}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    runSlashCommand(command.id);
                  }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    index === activeSlashIndex
                      ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                      : "hover:bg-[var(--hover-bg)]"
                  }`}
                >
                  <span className="font-mono text-xs font-bold flex-shrink-0">
                    /{command.id}
                  </span>
                  <span className="min-w-0 truncate text-[11px] font-bold opacity-70">
                    {command.description ?? t(command.label)}
                  </span>
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="composer">
            <div className="overflow-hidden rounded-t-[9px] flex-shrink-0">
              {chat.isOutOfContext && (
                <div className="flex items-center gap-3 px-4 py-2.5 border-b-2 border-[var(--border-light)] bg-[var(--hover-bg)]">
                  <Brain className="w-4 h-4 flex-shrink-0 text-amber-500" />
                  <p className="flex-1 min-w-0 text-xs font-bold">
                    {t("outOfContextMessage")}
                  </p>
                  <button
                    type="button"
                    onClick={onContinueGeneration}
                    className="px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-[var(--bg-inverted)] text-[var(--text-inverted)] hover:opacity-90 transition-opacity flex-shrink-0"
                  >
                    {t("continueGenerating")}
                  </button>
                  <button
                    type="button"
                    onClick={onDismissOutOfContext}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors flex-shrink-0"
                    title={t("cancel")}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onKeyDown={(e) => {
                if (slashMatches.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashIndex((i) => (i + 1) % slashMatches.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashIndex(
                      (i) => (i - 1 + slashMatches.length) % slashMatches.length,
                    );
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
              placeholder={compactToolbar ? `${t("messageModel")}...` : `${t("messageModel")} ${displayModelName(model)}...`}
              className="w-full bg-transparent px-5 pt-4 pb-2 text-[var(--text-main)] placeholder-[var(--text-muted)] font-bold resize-none overflow-y-auto focus:outline-none"
              rows={1}
              style={{ minHeight: "56px", maxHeight: `${MAX_INPUT_HEIGHT}px` }}
            />

            {notice && (
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                <span
                  role="status"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border-2 border-[var(--border-light)] bg-[var(--bg-panel)] text-[10px] font-bold"
                >
                  <Check className="w-3 h-3 flex-shrink-0" />
                  {notice}
                </span>
              </div>
            )}

            {fileErrors.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                {fileErrors.map((message) => (
                  <span
                    key={message}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border-2 border-red-500/40 bg-red-500/10 text-red-500 text-[10px] font-bold"
                  >
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    {message}
                  </span>
                ))}
              </div>
            )}

            {attachedFiles.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                {attachedFiles.map((file, idx) => (
                  <span
                    key={idx}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border-2 border-[var(--border-light)] bg-[var(--bg-panel)] text-[10px] font-bold"
                  >
                    {file.type.startsWith("image/") ? (
                      <ImageIcon className="w-3 h-3 flex-shrink-0" />
                    ) : (
                      <FileText className="w-3 h-3 flex-shrink-0" />
                    )}
                    <span className="truncate max-w-[140px]">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="text-[var(--text-muted)] hover:text-red-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div ref={toolbarRef} className="flex flex-wrap items-center gap-1 px-3 pb-3 pt-1 min-w-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="composer-pill"
                title={t("addFiles")}
              >
                <Plus className="w-4 h-4" />
              </button>
              <input
                type="file"
                multiple
                accept={acceptAttribute}
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileChange}
              />

              {speechSupported && (
                <button
                  type="button"
                  onClick={handleMicClick}
                  disabled={
                    micState === "loading" || micState === "transcribing"
                  }
                  className={`composer-pill disabled:cursor-not-allowed ${
                    micState === "recording" ? "!bg-red-500 !text-white" : ""
                  }`}
                  title={t("voiceInput")}
                >
                  {micState === "recording" ? (
                    <MicOff className="w-4 h-4" />
                  ) : micState === "idle" ? (
                    <Mic className="w-4 h-4" />
                  ) : (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {!compactToolbar && micState === "recording" && t("listening")}
                  {!compactToolbar &&
                    micState === "loading" &&
                    `${t("loadingSpeechModel")} ${micDetail}`}
                  {!compactToolbar && micState === "transcribing" && t("transcribing")}
                </button>
              )}

              <button
                type="button"
                disabled={thinkingUnavailable}
                onClick={() =>
                  onPatchSettings({ thinkingMode: nextThinkingMode(settings.thinkingMode) })
                }
                className={`composer-pill ${thinkingUnavailable ? "cursor-not-allowed opacity-70" : ""}`}
                title={
                  thinkingUnavailable
                    ? `${displayModelName(model)} ${t("thinkingNotSupported")}`
                    : `${t("thinkingMode")}: ${t(settings.thinkingMode)}`
                }
              >
                {thinkingUnavailable ? (
                  <CrossedIcon icon={Brain} />
                ) : (
                  <Brain className="w-3.5 h-3.5 flex-shrink-0" />
                )}
                {!compactToolbar && (thinkingUnavailable ? t("thinkingOff") : t(settings.thinkingMode))}
              </button>

              <button
                type="button"
                disabled={toolsUnavailable}
                onClick={() => onPatchSettings({ webMode: nextWebMode(settings.webMode) })}
                className={`composer-pill ${
                  toolsUnavailable
                    ? "cursor-not-allowed opacity-70"
                    : settings.webMode === "on"
                      ? "!bg-[var(--bg-inverted)] !text-[var(--text-inverted)]"
                      : settings.webMode === "off"
                        ? "opacity-50"
                        : ""
                }`}
                title={
                  toolsUnavailable
                    ? `${displayModelName(model)} ${t("toolsNotNative")}`
                    : `${t("webSearch")}: ${t(WEB_MODE_LABELS[settings.webMode])}`
                }
              >
                {toolsUnavailable ? (
                  <CrossedIcon icon={Globe} />
                ) : (
                  <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                )}
                {!compactToolbar && t(WEB_MODE_LABELS[toolsUnavailable ? "off" : settings.webMode])}
              </button>

              {surface === "code" && permissionMode && onPermissionMode && (
                <PermissionPicker
                  mode={permissionMode}
                  open={permissionMenuOpen}
                  onOpenChange={setPermissionMenuOpen}
                  onPick={onPermissionMode}
                  toolsUnavailable={toolsUnavailable}
                  t={t}
                  compact={compactToolbar}
                />
              )}

              <div className="ml-auto flex items-center gap-1 min-w-0">
              <div className="relative min-w-0" ref={modelMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                  title={displayModelName(model)}
                  className={`composer-pill min-w-0 ${compactToolbar ? "max-w-[130px]" : "max-w-[190px]"}`}
                >
                  <Cpu className="w-3.5 h-3.5 flex-shrink-0" />
                  {!tightToolbar && <span className="truncate">{displayModelName(model)}</span>}
                  <ChevronRight
                    className={`w-3 h-3 flex-shrink-0 transition-transform ${
                      isModelMenuOpen ? "rotate-90" : "-rotate-90"
                    }`}
                  />
                </button>

                <AnimatePresence>
                  {isModelMenuOpen && (
                    <motion.div
                      key="model-menu"
                      initial={{ opacity: 0, y: 8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.97 }}
                      className="absolute bottom-[42px] right-0 w-72 ui-box p-3 z-50 flex flex-col gap-2"
                    >
                      <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                        {installedModels.length === 0 ? (
                          <p className="text-[11px] font-bold text-[var(--text-muted)] px-1 py-1">
                            {t("noModelsFound")}
                          </p>
                        ) : (
                          installedModels.map((entry) => (
                            <button
                              key={entry.name}
                              type="button"
                              onClick={() => {
                                onSelectModel(entry.name);
                                setIsModelMenuOpen(false);
                              }}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                                entry.name === model
                                  ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                                  : "hover:bg-[var(--hover-bg)]"
                              }`}
                            >
                              <span className="flex-1 min-w-0 truncate text-[11px] font-bold">
                                {displayModelName(entry.name)}
                              </span>
                              {entry.parameterSize && (
                                <span className="text-[9px] font-bold opacity-60 flex-shrink-0">
                                  {entry.parameterSize}
                                </span>
                              )}
                              {entry.name === model && (
                                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                              )}
                            </button>
                          ))
                        )}
                      </div>

                      {modelInfo && modelInfo.capabilities.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {MODEL_CAPABILITIES.filter((c) =>
                            modelInfo.capabilities.includes(c.id),
                          ).map((c) => (
                            <span
                              key={c.id}
                              className="px-1.5 py-0.5 rounded border border-[var(--border-light)] text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]"
                            >
                              {t(c.label)}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="h-[2px] bg-[var(--border-light)] w-full" />

                      <button
                        type="button"
                        onClick={() => {
                          setIsModelMenuOpen(false);
                          onOpenSettings("models");
                        }}
                        className="w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-bold hover:bg-[var(--hover-bg)] transition-colors"
                      >
                        {t("manageModels")}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <ContextWheel
                view={contextView}
                t={t}
                compacting={compacting}
                onCompact={onCompact ? () => void runCompact() : undefined}
              />

              <button
                type={chat.isGenerating ? "button" : "submit"}
                onClick={chat.isGenerating ? () => onStopGeneration() : undefined}
                disabled={
                  !input.trim() &&
                  attachedFiles.length === 0 &&
                  !chat.isGenerating
                }
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-[var(--bg-inverted)] text-[var(--text-inverted)] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
              >
                {chat.isGenerating ? (
                  <Square className="w-4 h-4 fill-current" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
