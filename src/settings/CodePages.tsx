import { useState } from "react";
import { FileText, FolderPlus, SquareTerminal, Trash2, X } from "lucide-react";
import { Block, Button, ConfirmDialog, Group, Page, Row, Segmented, Select } from "./Controls";
import InstructionsEditor from "./InstructionsEditor";
import PermissionChoice from "./PermissionChoice";
import { selectableModels } from "../modelKinds";
import { thinkingOptions, webOptions } from "./pages";
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
  return (
    <Page title={t("preferences")}>
      <Group>
        <Row label={t("model")}>
          <Select
            label={t("model")}
            value={settings.codeModel}
            options={[
              { id: "", label: t("sameAsChat"), hint: chatModel },
              ...selectableModels(manager.installed).map((entry) => ({
                id: entry.name,
                label: entry.name,
                hint: entry.parameterSize,
              })),
            ]}
            onChange={(codeModel) => onUpdate({ codeModel })}
          />
        </Row>
        <Row label={t("thinking")}>
          <Segmented
            label={t("thinking")}
            value={settings.codeThinkingMode}
            options={thinkingOptions(t)}
            onChange={(codeThinkingMode) => onUpdate({ codeThinkingMode })}
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
              <FolderPlus className="w-4 h-4" />
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
          <FolderPlus className="w-4 h-4" />
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
            <FileText className="w-4 h-4" />
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
            <div
              key={`${grant.tool}:${grant.target ?? ""}`}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              {grant.tool === "run_command" ? (
                <SquareTerminal className="w-4 h-4 flex-shrink-0 opacity-60" />
              ) : (
                <FileText className="w-4 h-4 flex-shrink-0 opacity-60" />
              )}
              <p className="min-w-0 flex-1 truncate text-sm">
                {grant.tool === "run_command" ? (
                  <code className="font-mono text-xs font-bold">{grant.target}</code>
                ) : (
                  <>
                    <span className="font-bold">{grant.tool}</span>
                    {grant.target && (
                      <span className="text-[var(--text-muted)]"> · {grant.target}</span>
                    )}
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => onRevokeGrant(project.id, grant)}
                aria-label={`${t("remove")} ${grant.target ?? grant.tool}`}
                title={t("remove")}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-red-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </Group>

      <Group danger>
        <Row label={t("removeProject")}>
          <Button tone="danger" onClick={() => setConfirmingRemove(true)}>
            <Trash2 className="w-4 h-4" />
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
      className="w-full sm:w-64 px-3 py-2 ui-input text-sm font-bold"
      spellCheck={false}
    />
  );
}
