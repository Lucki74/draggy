import { useState } from "react";
import { Block, Button, Group, Page, Row, Select, Toggle } from "./Controls";
import PermissionChoice from "./PermissionChoice";
import { parseSchedule } from "../routines/schedule";
import { DEFAULT_ROUTINE_MODE, type Routine } from "../routines/store";
import { workspaceLabel } from "../workspaces";
import { generateId } from "../utils";
import type { AppSettings, PermissionMode, Workspace } from "../types";

type Translate = (key: string) => string;

interface RoutinesPageProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  /** Every workspace a routine can run in: the default chat one and the projects. */
  workspaces: Workspace[];
  onRunNow: (id: string) => void;
  onOpenChat: (chatId: string) => void;
  t: Translate;
}

const INPUT =
  "h-8 w-full rounded-lg border border-rule-control bg-surface-canvas px-2.5 text-[13px] text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus sm:w-72";

/** The sentence a schedule reads as, from its translation key and values. */
function meaningText(schedule: string, t: Translate): string | null {
  const parsed = parseSchedule(schedule, document.documentElement.lang || "en");
  if (!parsed.ok) return null;
  let text = t(parsed.meaning.key);
  for (const [name, value] of Object.entries(parsed.meaning.vars)) text = text.replace(`{${name}}`, value);
  return text;
}

interface Draft {
  id: string | null;
  name: string;
  prompt: string;
  schedule: string;
  workspaceId: string;
  permissionMode: PermissionMode;
  enabled: boolean;
}

const blank = (workspaceId: string): Draft => ({
  id: null,
  name: "",
  prompt: "",
  schedule: "every day at 9",
  workspaceId,
  permissionMode: DEFAULT_ROUTINE_MODE,
  enabled: true,
});

/** Code > Routines: prompts that run on a schedule, each in its own project and permission mode. */
export default function RoutinesPage({ settings, onUpdate, workspaces, onRunNow, onOpenChat, t }: RoutinesPageProps) {
  const routines = settings.routines;
  const [draft, setDraft] = useState<Draft | null>(null);
  const nameOf = (id: string) => workspaceLabel(workspaces.find((one) => one.id === id), t);

  const save = (next: Routine[]) => onUpdate({ routines: next });

  const commit = () => {
    if (!draft) return;
    const parsed = parseSchedule(draft.schedule);
    if (!parsed.ok || !draft.prompt.trim() || !draft.workspaceId) return;
    const name = draft.name.trim() || t("routineUntitled");
    if (draft.id) {
      save(
        routines.map((routine) =>
          routine.id === draft.id
            ? {
                ...routine,
                name,
                prompt: draft.prompt,
                schedule: draft.schedule.trim(),
                cron: parsed.cron,
                workspaceId: draft.workspaceId,
                permissionMode: draft.permissionMode,
                enabled: draft.enabled,
              }
            : routine,
        ),
      );
    } else {
      save([
        ...routines,
        {
          id: generateId(),
          name,
          prompt: draft.prompt,
          schedule: draft.schedule.trim(),
          cron: parsed.cron,
          workspaceId: draft.workspaceId,
          permissionMode: draft.permissionMode,
          enabled: draft.enabled,
          createdAt: Date.now(),
          lastRunAt: null,
          lastStatus: null,
          lastChatId: null,
        },
      ]);
    }
    setDraft(null);
  };

  const statusText = (routine: Routine) => {
    if (!routine.lastRunAt) return t("routineNeverRun");
    const when = new Date(routine.lastRunAt).toLocaleString();
    const state = routine.lastStatus === "running" ? t("routineRunning") : routine.lastStatus === "failed" ? t("routineFailed") : t("routineDone");
    return `${state} · ${when}`;
  };

  const defaultWorkspace = workspaces[0]?.id ?? "";

  return (
    <Page title={t("routinesPage")} description={t("routinesPageDescription")}>
      <Group title={t("routinesGroup")}>
        {routines.length === 0 ? (
          <Block>
            <p className="text-[13px] leading-5 text-text-tertiary">{t("routinesNone")}</p>
          </Block>
        ) : (
          routines.map((routine) => (
            <Row
              key={routine.id}
              label={routine.name}
              description={
                <>
                  <span className="block">
                    {meaningText(routine.schedule, t) ?? t("routineBadSchedule")} · {nameOf(routine.workspaceId)}
                  </span>
                  <span className="block">
                    {routine.lastChatId ? (
                      <button
                        type="button"
                        className="text-accent-ink underline-offset-2 hover:underline"
                        onClick={() => onOpenChat(routine.lastChatId as string)}
                      >
                        {statusText(routine)}
                      </button>
                    ) : (
                      statusText(routine)
                    )}
                  </span>
                </>
              }
            >
              <div className="flex flex-wrap items-center gap-3">
                <Toggle
                  label={t("routineEnabled")}
                  checked={routine.enabled}
                  disabled={!routine.cron}
                  onChange={(enabled) => save(routines.map((one) => (one.id === routine.id ? { ...one, enabled } : one)))}
                />
                <Button onClick={() => onRunNow(routine.id)} disabled={routine.lastStatus === "running"}>
                  {t("routineRunNow")}
                </Button>
                <Button
                  onClick={() =>
                    setDraft({
                      id: routine.id,
                      name: routine.name,
                      prompt: routine.prompt,
                      schedule: routine.schedule,
                      workspaceId: routine.workspaceId,
                      permissionMode: routine.permissionMode,
                      enabled: routine.enabled,
                    })
                  }
                >
                  {t("routineEdit")}
                </Button>
                <Button tone="danger" onClick={() => save(routines.filter((one) => one.id !== routine.id))}>
                  {t("routineDelete")}
                </Button>
              </div>
            </Row>
          ))
        )}
      </Group>

      {draft ? (
        <Group title={draft.id ? t("routineEdit") : t("routineAdd")}>
          <Row label={t("routineName")}>
            <input
              aria-label={t("routineName")}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className={INPUT}
            />
          </Row>
          <Row label={t("routinePrompt")}>
            <textarea
              aria-label={t("routinePrompt")}
              value={draft.prompt}
              rows={4}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              className="w-full rounded-lg border border-rule-control bg-surface-canvas px-2.5 py-2 text-[13px] text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus sm:w-96"
            />
          </Row>
          <Row
            label={t("routineSchedule")}
            description={
              meaningText(draft.schedule, t) ?? <span className="text-danger">{t("routineBadSchedule")}</span>
            }
          >
            <input
              aria-label={t("routineSchedule")}
              value={draft.schedule}
              placeholder={t("routineSchedulePlaceholder")}
              onChange={(e) => setDraft({ ...draft, schedule: e.target.value })}
              className={INPUT}
            />
          </Row>
          <Row label={t("routineProject")}>
            <Select
              label={t("routineProject")}
              value={draft.workspaceId}
              options={workspaces.map((one) => ({ id: one.id, label: workspaceLabel(one, t) }))}
              onChange={(workspaceId) => setDraft({ ...draft, workspaceId })}
            />
          </Row>
          <Block>
            <p className="mb-2 text-[13px] leading-5 text-text-secondary">{t("routineModeNote")}</p>
            <PermissionChoice
              value={draft.permissionMode}
              onChange={(permissionMode) => setDraft({ ...draft, permissionMode })}
              label={t("routineMode")}
              t={t}
            />
          </Block>
          <Row label={t("routineEnabled")}>
            <Toggle checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
          </Row>
          <Block>
            <div className="flex gap-2">
              <Button
                tone="primary"
                onClick={commit}
                disabled={!parseSchedule(draft.schedule).ok || !draft.prompt.trim() || !draft.workspaceId}
              >
                {t("routineSave")}
              </Button>
              <Button onClick={() => setDraft(null)}>{t("routineCancel")}</Button>
            </div>
          </Block>
        </Group>
      ) : (
        <Block>
          <Button tone="primary" onClick={() => setDraft(blank(defaultWorkspace))}>
            {t("routineAdd")}
          </Button>
        </Block>
      )}
    </Page>
  );
}
