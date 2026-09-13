import { CodeXml, Folder, FolderPlus } from "lucide-react";
import type { Workspace } from "../types";

interface CodeHomeProps {
  projects: Workspace[];
  onOpenFolder: () => void;
  onSelectProject: (id: string) => void;
  t: (key: string) => string;
}

// Code mode with no project open: the one thing to do here is pick a folder to work in.
export default function CodeHome({ projects, onOpenFolder, onSelectProject, t }: CodeHomeProps) {
  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--bg-base)] p-8">
      <div className="w-full max-w-md text-center space-y-6">
        <CodeXml className="mx-auto w-12 h-12 text-[var(--text-muted)]" />

        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-wider uppercase">{t("codeHomeTitle")}</h1>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed">{t("codeHomeBody")}</p>
        </div>

        <button
          onClick={onOpenFolder}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--bg-inverted)] px-5 py-3 text-xs font-bold uppercase tracking-wider text-[var(--text-inverted)] hover:opacity-90"
        >
          <FolderPlus className="w-4 h-4" />
          {t("codeHomeOpen")}
        </button>

        {projects.length > 0 && (
          <ul className="space-y-2 text-left">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  onClick={() => onSelectProject(project.id)}
                  title={project.rootPath || undefined}
                  className="w-full flex items-center gap-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] px-4 py-3 hover:bg-[var(--hover-bg)]"
                >
                  <Folder className="w-5 h-5 flex-shrink-0 text-[var(--text-muted)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{project.name}</span>
                    <span className="block truncate text-xs text-[var(--text-muted)]">
                      {project.rootPath}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
