import { useState } from "react";
import {
  Button,
  Chip,
  EmptyState,
  IconButton,
  Kbd,
  SegmentedControl,
  Skeleton,
  StatusDot,
} from "../index";
import { Spark } from "../signature/Spark";
import { EmberCaret } from "../signature/EmberCaret";
import { Fuse } from "../signature/Fuse";
import { Icon } from "../icons/Icon";
import { ComposerPreview } from "./ComposerPreview";
import { QueueComposer, QueueTranscript } from "./QueuePreview";
import { LongTranscriptPreview, TranscriptPreview } from "./TranscriptPreview";
import { SidebarPreview } from "./SidebarPreview";
import { DockPreview } from "./DockPreview";
import { PlanPreview } from "./PlanPreview";
import { HearthPreview } from "./HearthPreview";
import { StartupPreview } from "./StartupPreview";
import { ModelsPreview, SettingsPreview } from "./SettingsPreview";
import { ImagePreview } from "./ImagePreview";
import BrowserPane from "../../browser/BrowserPane";
import ExtensionsPanel from "../../extensions/ExtensionsPanel";
import StatsPanel from "../../stats/StatsPanel";
import { translations } from "../../translations";


type GalleryLanguage = "en" | "fr" | "ru";

const STRINGS = {
  en: {
    title: "Component Gallery",
    subtitle: "Verification surface for design primitives across themes and languages",
    buttons: "Buttons",
    chips: "Chips",
    controls: "Segmented Controls",
    status: "Status & Keyboard",
    signature: "Signature Ember",
    icons: "Phosphor Icons",
    continue: "Continue",
    save: "Save changes",
    cancel: "Cancel",
    delete: "Delete session",
    loading: "Loading...",
    allSessions: "All sessions",
    needsApproval: "Needs approval",
    ready: "Ready",
    warning: "Warning",
    error: "Error",
    idle: "Idle",
    chat: "Chat",
    code: "Code",
  },
  fr: {
    title: "Galerie de composants",
    subtitle: "Surface de vérification des primitives de conception selon le thème et la langue",
    buttons: "Boutons",
    chips: "Puces",
    controls: "Contrôles segmentés",
    status: "Statut et clavier",
    signature: "Signature braise",
    icons: "Icônes Phosphor",
    continue: "Continuer",
    save: "Enregistrer les modifications",
    cancel: "Annuler",
    delete: "Supprimer la session",
    loading: "Chargement...",
    allSessions: "Toutes les sessions",
    needsApproval: "Approbation requise",
    ready: "Prêt",
    warning: "Avertissement",
    error: "Erreur",
    idle: "Inactif",
    chat: "Discussion",
    code: "Code",
  },
  ru: {
    title: "Галерея компонентов",
    subtitle: "Площадка для проверки базовых элементов дизайна в разных темах и языках",
    buttons: "Кнопки",
    chips: "Чипы",
    controls: "Переключатели",
    status: "Статусы и клавиши",
    signature: "Фирменные угольки",
    icons: "Иконки Phosphor",
    continue: "Продолжить",
    save: "Сохранить изменения",
    cancel: "Отмена",
    delete: "Удалить сеанс",
    loading: "Загрузка...",
    allSessions: "Все сеансы",
    needsApproval: "Нужно одобрение",
    ready: "Готово",
    warning: "Предупреждение",
    error: "Ошибка",
    idle: "Простой",
    chat: "Обсуждение",
    code: "Код",
  },
};

// Dev-only gallery for verifying design tokens, typography, and primitives across locales.
export default function ComponentGallery() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [lang, setLang] = useState<GalleryLanguage>("en");
  const [segmentedVal, setSegmentedVal] = useState("chat");
  const [activeChip, setActiveChip] = useState("all");
  const [fuseProgress, setFuseProgress] = useState<number | undefined>(undefined);

  const t = STRINGS[lang];

  return (
    <div
      data-theme={theme}
      className={`h-screen overflow-y-auto p-8 transition-colors ${
        theme === "dark" ? "dark " : ""
      }bg-surface-canvas text-text-primary`}
    >
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-rule">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
            <p className="text-sm text-text-secondary mt-1">{t.subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <SegmentedControl
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              value={theme}
              onChange={(v) => setTheme(v as "light" | "dark")}
              size="dense"
            />
            <SegmentedControl
              options={[
                { value: "en", label: "English" },
                { value: "fr", label: "Français" },
                { value: "ru", label: "Русский" },
              ]}
              value={lang}
              onChange={(v) => setLang(v as GalleryLanguage)}
              size="dense"
            />
          </div>
        </header>

        {/* Buttons section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-secondary">{t.buttons}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">{t.continue}</Button>
            <Button variant="secondary">{t.save}</Button>
            <Button variant="ghost">{t.cancel}</Button>
            <Button variant="danger">{t.delete}</Button>
            <Button variant="primary" loading>
              {t.loading}
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="primary" size="dense">
              Dense Pill
            </Button>
            <IconButton name="copy" label="Copy text" shortcut="Ctrl+C" />
            <IconButton name="arrow-clockwise" label="Refresh" variant="secondary" />
            <IconButton name="trash" label="Delete" variant="danger" />
          </div>
        </section>

        {/* Chips section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-secondary">{t.chips}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Chip
              label={t.allSessions}
              count={12}
              selected={activeChip === "all"}
              onClick={() => setActiveChip("all")}
            />
            <Chip
              label={t.needsApproval}
              count={2}
              selected={activeChip === "approval"}
              onClick={() => setActiveChip("approval")}
            />
            <Chip label="draggy" icon={<Icon name="git-branch" size={14} />} />
            <Chip label="Qwen3 8B" dropdown />
            <Chip label="Dismissible" onDelete={() => {}} />
          </div>
        </section>

        {/* Segmented controls section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-secondary">{t.controls}</h2>
          <div className="flex flex-wrap items-center gap-4">
            <SegmentedControl
              options={[
                { value: "chat", label: t.chat, icon: <Icon name="chat-circle" size={14} /> },
                { value: "code", label: t.code, icon: <Icon name="code" size={14} /> },
              ]}
              value={segmentedVal}
              onChange={setSegmentedVal}
            />
            <SegmentedControl
              options={[
                { value: "normal", label: "Normal" },
                { value: "thinking", label: "Thinking" },
                { value: "verbose", label: "Verbose" },
              ]}
              value="normal"
              onChange={() => {}}
              size="dense"
            />
          </div>
        </section>

        {/* Status dots & Keyboard shortcuts */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-secondary">{t.status}</h2>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <StatusDot status="ok" />
              <span className="text-sm">{t.ready}</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status="warn" />
              <span className="text-sm">{t.warning}</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status="danger" />
              <span className="text-sm">{t.error}</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status="idle" />
              <span className="text-sm">{t.idle}</span>
            </div>
            <div className="flex items-center gap-2 ms-4">
              <Kbd>Ctrl</Kbd>
              <Kbd>Shift</Kbd>
              <Kbd>D</Kbd>
              <Kbd>Esc</Kbd>
            </div>
          </div>
        </section>

        {/* Loading & Empty states */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-secondary">Loading & Empty States</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-rule bg-surface-base space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </div>
            <div className="rounded-xl border border-rule bg-surface-base">
              <EmptyState
                message="No items in this collection"
                actionLabel="Create item"
                onAction={() => {}}
              />
            </div>
          </div>
        </section>

        {/* Signature Ember section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-secondary">{t.signature}</h2>
          <div className="p-4 rounded-xl border border-rule bg-surface-base space-y-4">
            <div className="flex items-center gap-3">
              <Spark />
              <span className="text-sm">Active generation spark</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span>Streaming answer simulation</span>
              <EmberCaret />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span>Composer fuse (indeterminate vs determinate)</span>
                <button
                  onClick={() => setFuseProgress((p) => (p === undefined ? 0.65 : undefined))}
                  className="hover:underline text-text-primary"
                >
                  Toggle progress: {fuseProgress !== undefined ? "65%" : "Indeterminate"}
                </button>
              </div>
              <div className="relative h-4 rounded-lg bg-surface-canvas p-2">
                <Fuse progress={fuseProgress} />
              </div>
            </div>
          </div>
        </section>

        {/* Phosphor icons showcase */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-secondary">{t.icons}</h2>
          <div className="flex flex-wrap items-center gap-4 text-text-secondary">
            <Icon name="chat-circle" size={24} />
            <Icon name="code" size={24} />
            <Icon name="git-branch" size={20} />
            <Icon name="terminal" size={20} />
            <Icon name="magnifying-glass" size={20} />
            <Icon name="folder-simple" size={20} />
            <Icon name="gear-six" size={20} />
            <Icon name="copy" size={16} />
            <Icon name="check" size={16} />
            <Icon name="x" size={16} />
          </div>
        </section>

        <section className="space-y-3" data-gallery="composer">
          <h2 className="text-sm font-semibold text-text-secondary">Composer</h2>
          <div className="rounded-lg bg-surface-canvas py-10 px-4 flex flex-col items-center">
            <h1 className="mb-6 display-line text-[32px] leading-10 font-semibold tracking-[-0.01em] text-text-primary">Where should we start?</h1>
            <ComposerPreview variant="home" />
          </div>
          <div className="rounded-lg bg-surface-canvas pt-4">
            <ComposerPreview generating />
          </div>
          <div className="rounded-lg bg-surface-canvas pt-4 max-w-[560px]">
            <ComposerPreview narrow language="fr" />
          </div>
          <div className="rounded-lg bg-surface-canvas pt-4" data-gallery="composer-no-model">
            <ComposerPreview model="" />
          </div>
        </section>

        <section className="space-y-3" data-gallery="queue">
          <h2 className="text-sm font-semibold text-text-secondary">Queue</h2>
          <div className="rounded-lg bg-surface-canvas pt-4" data-shot="queue-card">
            <QueueComposer />
          </div>
          <div className="rounded-lg bg-surface-canvas pt-4" data-shot="queue-keys">
            <QueueComposer initial={[]} />
          </div>
          <div className="rounded-lg bg-surface-canvas pt-4" data-shot="queue-one">
            <QueueComposer initial={[{ id: "a", content: "Also add a test for the empty case" }]} />
          </div>
          <div className="rounded-lg bg-surface-canvas pt-4" data-shot="queue-fr">
            <QueueComposer language="fr" />
          </div>
          <div className="rounded-lg bg-surface-canvas" data-shot="t-pending">
            <QueueTranscript kind="pending" />
          </div>
          <div className="rounded-lg bg-surface-canvas" data-shot="t-landed">
            <QueueTranscript kind="landed" />
          </div>
          <div className="rounded-lg bg-surface-canvas" data-shot="t-parked">
            <QueueTranscript kind="parked" />
          </div>
        </section>

        <section className="space-y-3" data-gallery="sidebar">
          <h2 className="text-sm font-semibold text-text-secondary">Sidebar</h2>
          <div className="flex gap-6">
            <div className="rounded-lg overflow-hidden border border-rule">
              <SidebarPreview />
            </div>
            <div className="rounded-lg overflow-hidden border border-rule">
              <SidebarPreview mode="chat" />
            </div>
          </div>
        </section>

        <section className="space-y-3" data-gallery="transcript">
          <h2 className="text-sm font-semibold text-text-secondary">Transcript</h2>
          <div className="rounded-lg bg-surface-canvas">
            <TranscriptPreview />
          </div>
          <div className="rounded-lg bg-surface-canvas" data-gallery="transcript-long">
            <LongTranscriptPreview />
          </div>
        </section>

        <section className="space-y-3" data-gallery="dock">
          <h2 className="text-sm font-semibold text-text-secondary">Dock & Panes</h2>
          <div className="rounded-lg bg-surface-canvas">
            <DockPreview />
          </div>
        </section>

        <section className="space-y-3" data-gallery="plan">
          <h2 className="text-sm font-semibold text-text-secondary">Plan pane</h2>
          <PlanPreview />
        </section>

        <section className="space-y-3" data-gallery="browser">
          <h2 className="text-sm font-semibold text-text-secondary">Browser pane</h2>
          <div className="h-72 w-[420px] overflow-hidden rounded-md border border-rule">
            <BrowserPane t={(key) => translations.en[key] || key} />
          </div>
        </section>

        <section className="space-y-3" data-gallery="startup">
          <h2 className="text-sm font-semibold text-text-secondary">Startup</h2>
          <StartupPreview />
        </section>

        <section className="space-y-3" data-gallery="hearth">
          <h2 className="text-sm font-semibold text-text-secondary">Talk hearth</h2>
          <HearthPreview />
        </section>

        <section className="space-y-3" data-gallery="settings">
          <h2 className="text-sm font-semibold text-text-secondary">Settings</h2>
          <SettingsPreview />
        </section>

        <section className="space-y-3" data-gallery="models">
          <h2 className="text-sm font-semibold text-text-secondary">Models</h2>
          <ModelsPreview />
        </section>

        <section className="space-y-3" data-gallery="images">
          <h2 className="text-sm font-semibold text-text-secondary">Images</h2>
          <ImagePreview />
        </section>

        <section className="max-w-[720px] space-y-3" data-gallery="extensions">
          <h2 className="text-sm font-semibold text-text-secondary">Extensions</h2>
          <ExtensionsPanel t={(key) => translations.en[key] || key} />
        </section>

        <section className="max-w-[720px] space-y-3" data-gallery="stats">
          <h2 className="text-sm font-semibold text-text-secondary">Statistics</h2>
          <StatsPanel t={(key) => translations.en[key] || key} />
        </section>
      </div>
    </div>
  );
}
