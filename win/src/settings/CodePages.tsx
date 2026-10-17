import { useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { Block, Button, ConfirmDialog, Group, Page, Row, Segmented, Select } from "./Controls";
import InstructionsEditor from "./InstructionsEditor";
import PermissionChoice from "./PermissionChoice";
import { selectableModels } from "../modelKinds";
import { useProviderGroups, withProviderModels } from "../providers/modelOptions";
import { effortOptions, webOptions } from "./pages";
import { workspaceLabel } from "../workspaces";
import type { ModelManager } from "./useModelManager";
import type { AppSettings, PermissionMode, Workspace, WorkspaceGrant } from "../types";

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
            value={settings.codeModel}
            options={[
              { id: "", label: t("sameAsChat"), hint: chatModel },
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
            value={settings.codeEffort}
            options={effortOptions(t)}
            onChange={(codeEffort) => onUpdate({ codeEffort })}
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
            <GrantRow
              key={`${grant.tool}:${grant.target ?? ""}`}
              grant={grant}
              onRevoke={() => onRevokeGrant(project.id, grant)}
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

/** One saved "Always allow": a command, or a tool on a path. */
function GrantRow({ grant, onRevoke, t }: { grant: WorkspaceGrant; onRevoke: () => void; t: Translate }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Icon
        name={grant.tool === "run_command" ? "terminal" : "file-text"}
        size={16}
        className="flex-shrink-0 text-text-tertiary"
      />
      <p className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
        {grant.tool === "run_command" ? (
          <code className="font-mono text-[12px]">{grant.target}</code>
        ) : (
          <>
            <span className="font-medium">{grant.tool}</span>
            {grant.target && <span className="text-text-secondary"> · {grant.target}</span>}
          </>
        )}
      </p>
      <button
        type="button"
        onClick={onRevoke}
        aria-label={`${t("remove")} ${grant.target ?? grant.tool}`}
        title={t("remove")}
        className="rounded-sm p-1.5 text-text-tertiary outline-none transition-colors hover:bg-surface-raised hover:text-danger focus-visible:ring-2 focus-visible:ring-focus"
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

/** Every saved "Always allow" across projects, so they can be reviewed and taken back in one place. */
export function PermissionsPage({
  projects,
  onRevokeGrant,
  t,
}: {
  projects: Workspace[];
  onRevokeGrant: (id: string, grant: WorkspaceGrant) => void;
  t: Translate;
}) {
  const withGrants = projects.filter((project) => project.grants.length > 0);
  return (
    <Page title={t("permissions")} description={t("permissionsPageHint")}>
      {withGrants.length === 0 ? (
        <Group>
          <Row label={t("nothingAllowedYet")} />
        </Group>
      ) : (
        withGrants.map((project) => (
          <Group key={project.id} title={workspaceLabel(project, t)}>
            {project.grants.map((grant) => (
              <GrantRow
                key={`${grant.tool}:${grant.target ?? ""}`}
                grant={grant}
                onRevoke={() => onRevokeGrant(project.id, grant)}
                t={t}
              />
            ))}
          </Group>
        ))
      )}
    </Page>
  );
}
