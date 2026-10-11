import { Button, Icon } from "../ui";
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
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center bg-surface-canvas px-4 pb-[10vh]">
      <div className="w-full max-w-[520px]">
        <h1 className="display-line text-[32px] leading-10 font-semibold tracking-[-0.01em] text-text-primary">{t("codeHomeTitle")}</h1>
        <p className="mt-2 text-[15px] leading-6 text-text-secondary text-pretty">{t("codeHomeBody")}</p>

        <Button className="mt-6" icon={<Icon name="folder-open" size={16} />} onClick={onOpenFolder}>
          {t("codeHomeOpen")}
        </Button>

        {projects.length > 0 && (
          <ul className="mt-8 border-t border-rule">
            {projects.map((project) => (
              <li key={project.id} className="border-b border-rule">
                <button
                  type="button"
                  onClick={() => onSelectProject(project.id)}
                  title={project.rootPath || undefined}
                  className="group w-full flex items-center gap-3 px-2 py-2.5 text-start hover:bg-surface-raised focus-visible:outline-none focus-visible:bg-surface-raised"
                >
                  <Icon name="folder-simple" size={16} className="flex-shrink-0 text-text-secondary" />
                  <span className="min-w-0 flex-1 flex items-baseline gap-3">
                    <span className="truncate text-[14px] font-medium text-text-primary">{project.name}</span>
                    <span className="truncate font-mono text-[12px] text-text-tertiary">{project.rootPath}</span>
                  </span>
                  <Icon name="arrow-right" size={16} className="flex-shrink-0 text-text-tertiary opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 rtl:-scale-x-100" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
