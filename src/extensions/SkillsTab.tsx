import { useEffect, useState } from "react";
import { BookOpen, FolderOpen, RefreshCw } from "lucide-react";
import type { InstalledSkill } from "../types";

interface SkillsTabProps {
  workspaceId: string;
  t: (key: string) => string;
}

/**
 * The other half of extending Draggy. An MCP server connects it to something;
 * a skill tells it how the user wants a job done. Both are folders on disk that
 * the user owns, which is why they share one screen.
 */
export default function SkillsTab({ workspaceId, t }: SkillsTabProps) {
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [revision, setRevision] = useState(0);

  const api = window.electronAPI?.skills;

  useEffect(() => {
    if (!api) return;

    let cancelled = false;

    api
      .list(workspaceId)
      .then((result) => {
        if (!cancelled) setSkills(result?.skills ?? []);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [api, workspaceId, revision]);

  if (!api) {
    return <p className="text-sm text-[var(--text-muted)]">{t("mcpUnavailable")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm text-[var(--text-muted)]">{t("skillsHint")}</p>

        <button
          onClick={() => setRevision((count) => count + 1)}
          aria-label={t("refresh")}
          title={t("refresh")}
          className="p-2 rounded-xl border-[3px] border-[var(--border-light)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        <button
          onClick={() => void api.openFolder()}
          className="flex items-center gap-2 rounded-xl border-[3px] border-[var(--border-light)] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          <FolderOpen className="w-4 h-4" />
          {t("openFolder")}
        </button>
      </div>

      {skills.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--text-muted)]">
          {t("noSkillsYet")}
        </p>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="flex items-start gap-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] p-3"
            >
              <BookOpen className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />

              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold tracking-tight">{skill.name}</p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {skill.description}
                </p>
              </div>

              <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {skill.source === "project" ? t("thisProject") : t("everywhere")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
