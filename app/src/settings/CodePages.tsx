import { useState } from "react";
import { Icon, type IconName } from "../ui/icons/Icon";
import { Block, Button, ConfirmDialog, Group, Page, Row, Segmented, Select } from "./Controls";
import InstructionsEditor from "./InstructionsEditor";
import PermissionChoice from "./PermissionChoice";
import { selectableModels } from "../modelKinds";
import { useProviderGroups, withProviderModels } from "../providers/modelOptions";
import { effortOptions, webOptions } from "./pages";
import { workspaceLabel } from "../workspaces";
import type { ModelManager } from "./useModelManager";
import type { AppSettings, PermissionMode, PermissionRule, PermissionRuleKind, Workspace, WorkspaceGrant } from "../types";
import { RULE_KINDS, sameRule } from "../agent/permissionRules";

type Translate = (key: string) => string;

/** The Code pages. Code keeps its own model, instructions and defaults, and each project its own
 * permissions, so nothing here reaches Chat. */

interface CodePreferencesProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  manager: ModelManager;
  chatModel: string;
  t: Translate;
}

export function CodePreferencesPage({ settings, onUpdate, manager, chatModel, t }: CodePreferencesProps) {
  const providerGroups = useProviderGroups();
  return (
    <Page title={t("preferences")}>
      <Group>
        <Row label={t("model")}>
          <Select
            label={t("model")}
            value={settings.codeModel || chatModel}
            options={[
              ...withProviderModels(
                selectableModels(manager.installed).map((entry) => ({
                  id: entry.name,
                  label: entry.name,
                  hint: entry.parameterSize,
                })),
                providerGroups,
                t("draggyEngine"),
              ),
            ]}
            onChange={(codeModel) => onUpdate({ codeModel })}
          />
        </Row>
        <Row label={t("thinking")}>
          <Segmented
            label={t("thinking")}
            value={settings.codeDefaultEffort}
            options={effortOptions(t)}
            onChange={(codeDefaultEffort) => onUpdate({ codeDefaultEffort, codeEffort: codeDefaultEffort })}
          />
        </Row>
        <Row label={t("webAccess")}>
          <Segmented
            label={t("webAccess")}
            value={settings.codeWebMode}
            options={webOptions(t)}
            onChange={(codeWebMode) => onUpdate({ codeWebMode })}
          />
        </Row>
      </Group>

      <Group title={t("defaultPermission")}>
        <Block>
          <PermissionChoice
            label={t("defaultPermission")}
            value={settings.codePermissionMode}
            onChange={(codePermissionMode) => onUpdate({ codePermissionMode })}
            t={t}
          />
        </Block>
      </Group>

      <Group title={t("customInstructions")}>
        <Block>
          <InstructionsEditor
            instructions={settings.codeInstructions}
            onChange={(codeInstructions) => onUpdate({ codeInstructions })}
            t={t}
          />
        </Block>
      </Group>
    </Page>
  );
}

interface ProjectsPageProps {
  projects: Workspace[];
  /** The project to show first: the one open in Code, when there is one. */
  initialProjectId: string | null;
  onAddProject: () => Promise<Workspace | null>;
  onRename: (id: string, name: string) => void;
  onSetPermissionMode: (id: string, mode: PermissionMode) => void;
  onRevokeGrant: (id: string, grant: WorkspaceGrant) => void;
  onRemove: (id: string) => void;
  onEditMemory: (id: string) => void;
  t: Translate;
}

export function ProjectsPage({
  projects,
  initialProjectId,
  onAddProject,
  onRename,
  onSetPermissionMode,
  onRevokeGrant,
  onRemove,
  onEditMemory,
  t,
}: ProjectsPageProps) {
  const [chosenId, setChosenId] = useState<string | null>(initialProjectId);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const project =
    projects.find((one) => one.id === chosenId) ??
    projects.find((one) => one.id === initialProjectId) ??
    projects[0] ??
    null;

  const addProject = async () => {
    const created = await onAddProject();
    if (created) setChosenId(created.id);
  };

  if (!project) {
    return (
      <Page title={t("projects")}>
        <Group>
          <Row label={t("noProjectsYet")} description={t("codeHomeBody")}>
            <Button tone="primary" onClick={() => void addProject()}>
              <Icon name="folder-simple-plus" size={16} />
              {t("codeHomeOpen")}
            </Button>
          </Row>
        </Group>
      </Page>
    );
  }

  return (
    <Page title={t("projects")}>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label={t("projects")}
          value={project.id}
          options={projects.map((one) => ({
            id: one.id,
            label: workspaceLabel(one, t),
          }))}
          onChange={setChosenId}
        />
        <Button onClick={() => void addProject()}>
          <Icon name="folder-simple-plus" size={16} />
          {t("newProject")}
        </Button>
      </div>

      <Group title={workspaceLabel(project, t)}>
        <Row label={t("projectName")}>
          <NameField
            key={project.id + project.name}
            name={project.name}
            label={t("projectName")}
            onCommit={(name) => onRename(project.id, name)}
          />
        </Row>
        <Row label={t("projectFolder")} description={project.rootPath ?? ""} />
        <Row label={t("projectMemory")} description={t("projectMemoryHint")}>
          <Button onClick={() => onEditMemory(project.id)}>
            <Icon name="file-text" size={16} />
            {t("edit")}
          </Button>
        </Row>
      </Group>

      <Group title={t("permissionMode")}>
        <Block>
          <PermissionChoice
            label={t("permissionMode")}
            value={project.permissionMode}
            onChange={(mode) => onSetPermissionMode(project.id, mode)}
            t={t}
          />
        </Block>
      </Group>

      <Group title={t("alwaysAllowed")}>
        {project.grants.length === 0 ? (
          <Row label={t("nothingAllowedYet")} />
        ) : (
          project.grants.map((grant) => (
            <RuleRow
              key={`${grant.tool}:${grant.target ?? ""}`}
              icon={grant.tool === "run_command" ? "terminal" : "file-text"}
              value={grant.tool === "run_command" ? (grant.target ?? grant.tool) : grant.tool}
              detail={grant.tool === "run_command" ? undefined : grant.target}
              onRemove={() => onRevokeGrant(project.id, grant)}
              t={t}
            />
          ))
        )}
      </Group>

      <Group danger>
        <Row label={t("removeProject")}>
          <Button tone="danger" onClick={() => setConfirmingRemove(true)}>
            <Icon name="trash" size={16} />
            {t("removeProject")}
          </Button>
        </Row>
      </Group>

      {confirmingRemove && (
        <ConfirmDialog
          title={t("removeProject")}
          body={t("confirmRemoveProject").replace("{name}", workspaceLabel(project, t))}
          confirmLabel={t("removeProject")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={() => {
            setConfirmingRemove(false);
            setChosenId(null);
            onRemove(project.id);
          }}
        />
      )}
    </Page>
  );
}

function NameField({
  name,
  label,
  onCommit,
}: {
  name: string;
  label: string;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onCommit(trimmed);
    else setDraft(name);
  };

  return (
    <input
      type="text"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      aria-label={label}
      className="h-8 w-full sm:w-64 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
      spellCheck={false}
    />
  );
}

const KIND_ICON: Record<PermissionRuleKind, IconName> = {
  command: "terminal",
  path: "folder-simple",
  tool: "puzzle-piece",
  site: "globe-simple",
};

const KIND_LABEL: Record<PermissionRuleKind, string> = {
  command: "ruleCommand",
  path: "rulePath",
  tool: "ruleTool",
  site: "ruleSite",
};

const KIND_PLACEHOLDER: Record<PermissionRuleKind, string> = {
  command: "ruleCommandPlaceholder",
  path: "rulePathPlaceholder",
  tool: "ruleToolPlaceholder",
  site: "ruleSitePlaceholder",
};

/** The kind, value and scope of a new rule, on one line at the top of its list. */
function AddRule({
  effect,
  projects,
  onAdd,
  t,
}: {
  effect: PermissionRule["effect"];
  projects: Workspace[];
  onAdd: (rule: PermissionRule) => void;
  t: Translate;
}) {
  const [kind, setKind] = useState<PermissionRuleKind>("command");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState("");
  const trimmed = value.trim();

  const add = () => {
    if (!trimmed) return;
    onAdd({ effect, kind, value: trimmed, ...(scope ? { workspaceId: scope } : {}) });
    setValue("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-3">
      <Select
        className="w-32 flex-shrink-0"
        label={t("ruleKind")}
        value={kind}
        options={RULE_KINDS.map((id) => ({ id, label: t(KIND_LABEL[id]) }))}
        onChange={(id) => setKind(id as PermissionRuleKind)}
      />
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") add();
        }}
        placeholder={t(KIND_PLACEHOLDER[kind])}
        aria-label={t("ruleValue")}
        spellCheck={false}
        className="h-8 min-w-[10rem] flex-1 rounded-sm bg-surface-base px-3 font-mono text-[12px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:font-sans placeholder:text-[13px] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
      <Select
        className="w-40 flex-shrink-0"
        label={t("ruleScope")}
        value={scope}
        options={[
          { id: "", label: t("everyProject") },
          ...projects.map((project) => ({ id: project.id, label: workspaceLabel(project, t) })),
        ]}
        onChange={setScope}
      />
      <Button tone={effect === "allow" ? "primary" : "plain"} onClick={add} disabled={!trimmed}>
        {t("addRule")}
      </Button>
    </div>
  );
}

/** One entry in a list: what it covers, where it holds, and a way to take it back. */
function RuleRow({
  icon,
  value,
  detail,
  scope,
  onRemove,
  t,
}: {
  icon: IconName;
  value: string;
  detail?: string;
  scope?: string;
  onRemove: () => void;
  t: Translate;
}) {
  return (
    <div className="group flex items-center gap-3 py-2 pe-2 ps-4">
      <Icon name={icon} size={16} className="flex-shrink-0 text-text-tertiary" />
      <p className="flex min-w-0 flex-1 items-baseline gap-2 truncate" title={value}>
        <code className="truncate font-mono text-[12px] text-text-primary">{value}</code>
        {detail && <span className="truncate text-[12px] text-text-secondary">{detail}</span>}
      </p>
      {scope && <span className="max-w-[40%] flex-shrink-0 truncate text-[12px] text-text-tertiary">{scope}</span>}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${t("remove")} ${value}`}
        title={t("remove")}
        className="rounded-sm p-1.5 text-text-tertiary opacity-60 outline-none transition hover:bg-surface-raised hover:text-danger hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-focus group-hover:opacity-100"
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-4 py-3 text-[13px] text-text-tertiary">{text}</p>;
}

/** The rules that hold in every mode: what runs without asking and what never runs. A saved
 * "Always" from a request shows in the allow list under its project. */
export function PermissionsPage({
  settings,
  onUpdate,
  projects,
  onRevokeGrant,
  t,
}: {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  projects: Workspace[];
  onRevokeGrant: (id: string, grant: WorkspaceGrant) => void;
  t: Translate;
}) {
  const rules = Array.isArray(settings.permissionRules) ? settings.permissionRules : [];
  const scopeLabel = (workspaceId?: string) => {
    const project = workspaceId ? projects.find((one) => one.id === workspaceId) : null;
    return project ? workspaceLabel(project, t) : t("everyProject");
  };

  const addRule = (rule: PermissionRule) => {
    if (rules.some((one) => sameRule(one, rule))) return;
    onUpdate({ permissionRules: [...rules, rule] });
  };
  const removeRule = (rule: PermissionRule) => onUpdate({ permissionRules: rules.filter((one) => one !== rule) });

  const list = (effect: PermissionRule["effect"]) =>
    rules
      .filter((rule) => rule.effect === effect)
      .map((rule) => (
        <RuleRow
          key={`${rule.kind}:${rule.value}:${rule.workspaceId ?? ""}`}
          icon={KIND_ICON[rule.kind] ?? "puzzle-piece"}
          value={rule.value}
          scope={scopeLabel(rule.workspaceId)}
          onRemove={() => removeRule(rule)}
          t={t}
        />
      ));

  const grants = projects.flatMap((project) =>
    project.grants.map((grant) => (
      <RuleRow
        key={`${project.id}:${grant.tool}:${grant.target ?? ""}`}
        icon={grant.tool === "run_command" ? "terminal" : "file-text"}
        value={grant.tool === "run_command" ? (grant.target ?? grant.tool) : grant.tool}
        detail={grant.tool === "run_command" ? undefined : grant.target}
        scope={workspaceLabel(project, t)}
        onRemove={() => onRevokeGrant(project.id, grant)}
        t={t}
      />
    )),
  );

  const allowed = [...list("allow"), ...grants];
  const denied = list("deny");

  return (
    <Page title={t("permissions")} description={t("permissionsPageHint")}>
      <Group title={t("alwaysAllow")}>
        <AddRule effect="allow" projects={projects} onAdd={addRule} t={t} />
        {allowed.length > 0 ? allowed : <EmptyRow text={t("nothingAllowedYet")} />}
      </Group>
      <Group title={t("neverAllow")}>
        <AddRule effect="deny" projects={projects} onAdd={addRule} t={t} />
        {denied.length > 0 ? denied : <EmptyRow text={t("nothingBlockedYet")} />}
      </Group>
    </Page>
  );
}
