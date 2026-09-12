import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_WORKSPACE_ID,
  createProject,
  fallbackWorkspace,
} from "../workspaces";
import { writeLocalStorage } from "../utils";
import type { Workspace } from "../types";

export const ACTIVE_WORKSPACE_KEY = "draggy_workspace";

export interface WorkspaceStore {
  workspaces: Workspace[];
  active: Workspace;
  select: (id: string) => void;
  /** Asks for a folder, makes a project of it, and switches to it. */
  addProject: () => Promise<Workspace | null>;
  /** Removes a project. Its conversations move back to the default workspace. */
  remove: (id: string) => Promise<{ moved: number }>;
  rename: (id: string, name: string) => Promise<void>;
}

/**
 * The workspaces the app knows about and which one is in front. The list lives
 * in the database; which one was last open is a local preference, so it is
 * read synchronously and the window opens where it was left.
 */
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

  const addProject = useCallback(async () => {
    const api = window.electronAPI?.workspaces;
    if (!api) return null;

    const picked = await api.pickFolder();
    if (!picked?.success || !picked.path) return null;

    const saved = await api.save(createProject("", picked.path));
    if (!saved?.success || !saved.workspace) return null;

    const workspace = saved.workspace;
    setWorkspaces((prev) => [...prev, workspace]);
    select(workspace.id);

    return workspace;
  }, [select]);

  const remove = useCallback(
    async (id: string) => {
      const api = window.electronAPI?.workspaces;
      if (!api || id === DEFAULT_WORKSPACE_ID) return { moved: 0 };

      const result = await api.remove(id);
      if (!result?.success) return { moved: 0 };

      setWorkspaces((prev) => prev.filter((one) => one.id !== id));
      setActiveId((current) => {
        if (current !== id) return current;
        writeLocalStorage(ACTIVE_WORKSPACE_KEY, DEFAULT_WORKSPACE_ID);
        return DEFAULT_WORKSPACE_ID;
      });

      return { moved: result.moved ?? 0 };
    },
    [],
  );

  const rename = useCallback(async (id: string, name: string) => {
    const api = window.electronAPI?.workspaces;
    if (!api) return;

    let updated: Workspace | null = null;

    setWorkspaces((prev) =>
      prev.map((one) => {
        if (one.id !== id) return one;
        updated = { ...one, name };
        return updated;
      }),
    );

    if (updated) await api.save(updated).catch(() => undefined);
  }, []);

  const active =
    workspaces.find((one) => one.id === activeId) ??
    workspaces[0] ??
    fallbackWorkspace();

  return { workspaces, active, select, addProject, remove, rename };
}
