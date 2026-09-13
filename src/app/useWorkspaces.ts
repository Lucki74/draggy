import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_WORKSPACE_ID,
  createProject,
  fallbackWorkspace,
} from "../workspaces";
import { addGrant as withGrant } from "../agent/permissions";
import type { Grant } from "../agent/permissions";
import { writeLocalStorage } from "../utils";
import type { PermissionMode, Workspace } from "../types";

export const ACTIVE_WORKSPACE_KEY = "draggy_workspace";

export interface WorkspaceStore {
  workspaces: Workspace[];
  active: Workspace;
  select: (id: string) => void;
  /** Asks for a folder, makes a project of it at the given permission mode, and switches to it. */
  addProject: (permissionMode?: PermissionMode) => Promise<Workspace | null>;
  /** Removes a project and the sessions in it. The folder is left alone. */
  remove: (id: string) => Promise<{ removed: boolean }>;
  rename: (id: string, name: string) => Promise<void>;
  /** Changes a workspace's permission mode, and saves it. */
  setPermissionMode: (id: string, mode: PermissionMode) => void;
  /** Takes back something the user had always allowed in a workspace. */
  revokeGrant: (id: string, grant: Grant) => void;
  /** Keeps a permission the user granted for good, on the open workspace. */
  addGrant: (grant: Grant) => void;
}

/** The known workspaces and the one in front. The list is in the database; the last open one is a
 * local preference, read synchronously to reopen there. */
export function useWorkspaces(): WorkspaceStore {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([fallbackWorkspace()]);
  const [activeId, setActiveId] = useState<string>(
    () => localStorage.getItem(ACTIVE_WORKSPACE_KEY) || DEFAULT_WORKSPACE_ID,
  );

  useEffect(() => {
    const api = window.electronAPI?.workspaces;
    if (!api) return;

    let cancelled = false;

    api
      .list()
      .then((result) => {
        if (cancelled || !result?.success || !result.workspaces?.length) return;
        setWorkspaces(result.workspaces);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const select = useCallback((id: string) => {
    setActiveId(id);
    writeLocalStorage(ACTIVE_WORKSPACE_KEY, id);
  }, []);

  const addProject = useCallback(async (permissionMode?: PermissionMode) => {
    const api = window.electronAPI?.workspaces;
    if (!api) return null;

    const picked = await api.pickFolder();
    if (!picked?.success || !picked.path) return null;

    const project = createProject("", picked.path);
    if (permissionMode) project.permissionMode = permissionMode;

    const saved = await api.save(project);
    if (!saved?.success || !saved.workspace) return null;

    const workspace = saved.workspace;
    setWorkspaces((prev) => [...prev, workspace]);
    select(workspace.id);

    return workspace;
  }, [select]);

  const remove = useCallback(
    async (id: string) => {
      const api = window.electronAPI?.workspaces;
      if (!api || id === DEFAULT_WORKSPACE_ID) return { removed: false };

      const result = await api.remove(id);
      if (!result?.success) return { removed: false };

      setWorkspaces((prev) => prev.filter((one) => one.id !== id));
      setActiveId((current) => {
        if (current !== id) return current;
        writeLocalStorage(ACTIVE_WORKSPACE_KEY, DEFAULT_WORKSPACE_ID);
        return DEFAULT_WORKSPACE_ID;
      });

      return { removed: true };
    },
    [],
  );

  // Built from the list on screen, not inside a state updater: React may run an updater later, and
  // the save would then send nothing.
  const change = useCallback(
    async (id: string, patch: Partial<Workspace>) => {
      const current = workspaces.find((one) => one.id === id);
      if (!current) return;

      const updated: Workspace = { ...current, ...patch, updatedAt: Date.now() };
      setWorkspaces((prev) => prev.map((one) => (one.id === id ? updated : one)));

      await window.electronAPI?.workspaces?.save(updated).catch(() => undefined);
    },
    [workspaces],
  );

  const rename = useCallback(
    async (id: string, name: string) => change(id, { name: name.trim() }),
    [change],
  );

  const setPermissionMode = useCallback(
    (id: string, mode: PermissionMode) => void change(id, { permissionMode: mode }),
    [change],
  );

  const revokeGrant = useCallback(
    (id: string, grant: Grant) => {
      const current = workspaces.find((one) => one.id === id);
      if (!current) return;

      const grants = current.grants.filter(
        (one) => !(one.tool === grant.tool && (one.target ?? "") === (grant.target ?? "")),
      );
      void change(id, { grants });
    },
    [workspaces, change],
  );

  const active =
    workspaces.find((one) => one.id === activeId) ??
    workspaces[0] ??
    fallbackWorkspace();

  const addGrant = useCallback(
    (grant: Grant) => {
      const next: Workspace = {
        ...active,
        grants: withGrant(active.grants, grant),
      };

      setWorkspaces((prev) =>
        prev.map((one) => (one.id === next.id ? next : one)),
      );

      void window.electronAPI?.workspaces?.save(next).catch(() => undefined);
    },
    [active],
  );

  return {
    workspaces,
    active,
    select,
    addProject,
    remove,
    rename,
    setPermissionMode,
    revokeGrant,
    addGrant,
  };
}
