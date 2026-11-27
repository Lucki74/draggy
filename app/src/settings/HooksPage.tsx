import { useEffect, useState } from "react";
import { Block, Button, Group, Page, Row, Select, Toggle } from "./Controls";
import { loadProjectHooks, type ProjectHooks } from "../agent/projectHooks";
import { HOOK_EVENTS, type HookEntry, type HookEvent } from "../agent/hooks";
import { workspaceLabel } from "../workspaces";
import type { AppSettings, Workspace } from "../types";

type Translate = (key: string) => string;

interface HooksPageProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  projects: Workspace[];
  activeProjectId?: string | null;
  t: Translate;
}

const TOOL_EVENTS: HookEvent[] = ["PreToolUse", "PostToolUse"];

/** Code > Hooks: user hooks to edit, and the open project's hooks file with its trust state. */
export default function HooksPage({ settings, onUpdate, projects, activeProjectId, t }: HooksPageProps) {
  return (
    <Page title={t("hooksPage")} description={t("hooksPageDescription")}>
      <UserHooks settings={settings} onUpdate={onUpdate} t={t} />
      <ProjectHooksGroup settings={settings} onUpdate={onUpdate} projects={projects} activeProjectId={activeProjectId} t={t} />
    </Page>
  );
}

function UserHooks({ settings, onUpdate, t }: { settings: AppSettings; onUpdate: (patch: Partial<AppSettings>) => void; t: Translate }) {
  const hooks = settings.hooks;
  const setHooks = (next: HookEntry[]) => onUpdate({ hooks: next });
  return (
    <>
      <Group title={t("hooksUserGroup")}>
        {hooks.length === 0 ? (
          <Block>
            <p className="text-[13px] leading-5 text-text-tertiary">{t("hooksNone")}</p>
          </Block>
        ) : (
          hooks.map((hook, index) => (
            <Row key={index} label={hookTitle(hook)}>
              <div className="flex items-center gap-3">
                <Toggle
                  label={t("hooksEnabled")}
                  checked={hook.enabled}
                  onChange={(enabled) => setHooks(hooks.map((item, i) => (i === index ? { ...item, enabled } : item)))}
                />
                <Button onClick={() => setHooks(hooks.filter((_, i) => i !== index))}>{t("hooksDelete")}</Button>
              </div>
            </Row>
          ))
        )}
      </Group>
      <AddHook onAdd={(entry) => setHooks([...hooks, entry])} t={t} />
    </>
  );
}

function AddHook({ onAdd, t }: { onAdd: (entry: HookEntry) => void; t: Translate }) {
  const [event, setEvent] = useState<HookEvent>("PreToolUse");
  const [matcher, setMatcher] = useState("");
  const [command, setCommand] = useState("");
  const [timeout, setTimeoutSeconds] = useState("60");
  const isTool = TOOL_EVENTS.includes(event);
  const regexOk = !isTool || !matcher || matcher === "*" || isValidRegex(matcher);
  const trimmed = command.trim();
  const seconds = Number(timeout);
  const canAdd = trimmed.length > 0 && regexOk && Number.isFinite(seconds) && seconds > 0;

  const add = () => {
    if (!canAdd) return;
    onAdd({
      event,
      matcher: isTool ? matcher.trim() : "",
      command: trimmed,
      timeout: Math.min(Math.round(seconds), 600),
      enabled: true,
    });
    setCommand("");
    setMatcher("");
  };

  return (
    <Group title={t("hooksAddGroup")}>
      <Row label={t("hooksEvent")}>
        <Select
          label={t("hooksEvent")}
          value={event}
          options={HOOK_EVENTS.map((value) => ({ id: value, label: value }))}
          onChange={(value) => setEvent(value as HookEvent)}
        />
      </Row>
      {isTool && (
        <Row label={t("hooksMatcher")}>
          <input
            aria-label={t("hooksMatcher")}
            value={matcher}
            placeholder={t("hooksMatcherHint")}
            onChange={(e) => setMatcher(e.target.value)}
            className="h-8 w-56 rounded-lg border border-rule-control bg-surface-canvas px-2.5 font-mono text-[12px] text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </Row>
      )}
      <Row label={t("hooksCommand")}>
        <input
          aria-label={t("hooksCommand")}
          value={command}
          placeholder="node check.js"
          onChange={(e) => setCommand(e.target.value)}
          className="h-8 w-72 rounded-lg border border-rule-control bg-surface-canvas px-2.5 font-mono text-[12px] text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </Row>
      <Row label={t("hooksTimeout")}>
        <input
          aria-label={t("hooksTimeout")}
          type="number"
          min={1}
          max={600}
          value={timeout}
          onChange={(e) => setTimeoutSeconds(e.target.value)}
          className="h-8 w-24 rounded-lg border border-rule-control bg-surface-canvas px-2.5 text-[13px] text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </Row>
      <Block>
        {!regexOk && <p className="mb-2 text-[12px] text-danger">{t("hooksBadRegex")}</p>}
        <Button tone="primary" onClick={add} disabled={!canAdd}>
          {t("hooksAdd")}
        </Button>
      </Block>
    </Group>
  );
}

function ProjectHooksGroup({
  settings,
  onUpdate,
  projects,
  activeProjectId,
  t,
}: {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  projects: Workspace[];
  activeProjectId?: string | null;
  t: Translate;
}) {
  const initial = projects.find((p) => p.id === activeProjectId)?.id ?? projects[0]?.id ?? "";
  const [projectId, setProjectId] = useState(initial);
  const [loadedFor, setLoadedFor] = useState<{ id: string; result: ProjectHooks } | null>(null);
  const trustedDigest = projectId ? settings.hookTrust[projectId] : undefined;
  const loaded = loadedFor?.id === projectId ? loadedFor.result : null;

  useEffect(() => {
    let cancelled = false;
    if (!projectId) return;
    void loadProjectHooks(projectId, settings.hookTrust[projectId]).then((result) => {
      if (!cancelled) setLoadedFor({ id: projectId, result });
    });
    return () => {
      cancelled = true;
    };
    // Only a project switch reloads; the Trust button updates the loaded result itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (projects.length === 0) {
    return (
      <Group title={t("hooksProjectGroup")} description={t("hooksProjectDescription")}>
        <Block>
          <p className="text-[13px] leading-5 text-text-tertiary">{t("hooksNoProjects")}</p>
        </Block>
      </Group>
    );
  }

  const trust = () => {
    if (!loaded?.digest) return;
    onUpdate({ hookTrust: { ...settings.hookTrust, [projectId]: loaded.digest } });
    setLoadedFor({ id: projectId, result: { ...loaded, trusted: true } });
  };

  return (
    <Group title={t("hooksProjectGroup")} description={t("hooksProjectDescription")}>
      <Row label={t("hooksProject")}>
        <Select
          label={t("hooksProject")}
          value={projectId}
          options={projects.map((p) => ({ id: p.id, label: workspaceLabel(p, t) }))}
          onChange={setProjectId}
        />
      </Row>
      <Block>
        {!loaded ? (
          <p className="text-[13px] text-text-tertiary">{t("hooksLoading")}</p>
        ) : !loaded.digest ? (
          <p className="text-[13px] text-text-tertiary">{t("hooksNoFile")}</p>
        ) : (
          <div className="space-y-3">
            <p className={`text-[13px] leading-5 ${loaded.trusted ? "text-text-secondary" : "text-warning"}`}>
              {loaded.trusted
                ? t("hooksTrusted")
                : trustedDigest
                  ? t("hooksChanged")
                  : t("hooksUntrusted")}
            </p>
            {loaded.errors.length > 0 && <p className="text-[12px] text-danger">{t("hooksSkipped")}</p>}
            <div className="max-h-56 space-y-1 overflow-auto">
              {loaded.entries.map((hook, index) => (
                <p key={index} className="whitespace-pre-wrap break-all font-mono text-[12px] text-text-secondary">
                  {hookTitle(hook)}
                </p>
              ))}
            </div>
            {!loaded.trusted && loaded.entries.length > 0 && (
              <Button tone="primary" onClick={trust}>
                {t("hooksTrust")}
              </Button>
            )}
          </div>
        )}
      </Block>
    </Group>
  );
}

function hookTitle(hook: HookEntry): string {
  const scope = TOOL_EVENTS.includes(hook.event) && hook.matcher ? ` ${hook.matcher}` : "";
  return `${hook.event}${scope}: ${hook.command}${hook.enabled ? "" : " (off)"}`;
}

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}
