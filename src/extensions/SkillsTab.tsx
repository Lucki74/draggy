import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, FolderOpen, RefreshCw, Search } from "lucide-react";
import { Toggle } from "../settings/Controls";
import type { InstalledSkill, LoadedSkill } from "../types";

interface SkillsTabProps {
  /** A project whose own skills folder is listed too. Left out, the library and the user's show. */
  workspaceId?: string;
  t: (key: string) => string;
}

type Shown = "all" | "on" | "off";

/** The library's shelves, in the order they are shown, after the skills the user wrote. */
const SKILL_CATEGORIES = [
  "writing",
  "documents",
  "research",
  "learning",
  "planning",
  "data",
  "code",
  "authoring",
];

/** Which heading a skill goes under: the project's and the user's own first, then the library's. */
function groupOf(skill: InstalledSkill): string {
  if (skill.source === "project") return "project";
  if (skill.source === "user") return "user";
  return skill.category && SKILL_CATEGORIES.includes(skill.category) ? skill.category : "authoring";
}

const GROUP_ORDER = ["project", "user", ...SKILL_CATEGORIES];

/** Skills tell Draggy how the user wants a job done, as servers connect it to things. Both are
 * switched on here, for the whole app, hence one screen. */
export default function SkillsTab({ workspaceId, t }: SkillsTabProps) {
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState<Shown>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedSkill | null>(null);

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

  const toggle = async (skill: InstalledSkill, on: boolean) => {
    setSkills((previous) =>
      previous.map((one) => (one.id === skill.id ? { ...one, enabled: on } : one)),
    );
    await api.setEnabled(skill.id, on).catch(() => undefined);
  };

  const expand = async (skill: InstalledSkill) => {
    if (expanded === skill.id) {
      setExpanded(null);
      return;
    }

    setExpanded(skill.id);
    setLoaded(null);

    const result = await api.read(workspaceId || "default", skill.id).catch(() => undefined);
    if (result?.success && result.skill) setLoaded(result.skill);
  };

  const wanted = filter.trim().toLowerCase();
  const isOn = (skill: InstalledSkill) => skill.enabled !== false;

  const visible = skills.filter((skill) => {
    if (shown !== "all" && isOn(skill) !== (shown === "on")) return false;
    if (!wanted) return true;
    return [skill.id, skill.name, skill.description].some((field) =>
      field.toLowerCase().includes(wanted),
    );
  });

  const groups = GROUP_ORDER.map((group) => ({
    group,
    members: visible.filter((skill) => groupOf(skill) === group),
  })).filter((entry) => entry.members.length > 0);

  const headingFor = (group: string) =>
    group === "project"
      ? t("thisProject")
      : group === "user"
        ? t("skillsYours")
        : t(`skillCategory_${group}`);

  const TABS: { id: Shown; label: string }[] = [
    { id: "all", label: t("mcpAll") },
    { id: "on", label: t("mcpEnabled") },
    { id: "off", label: t("mcpDisabled") },
  ];

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
        <p className="py-6 text-center text-sm text-[var(--text-muted)]">{t("noSkillsYet")}</p>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t("skillsSearch")}
                aria-label={t("skillsSearch")}
                className="w-full pl-9 pr-3 py-2 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] text-sm font-medium outline-none focus:border-[var(--text-muted)]"
              />
            </div>

            <div className="flex rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] overflow-hidden flex-shrink-0">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setShown(tab.id)}
                  aria-pressed={shown === tab.id}
                  className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                    shown === tab.id
                      ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs font-bold text-[var(--text-muted)]">
            {t("skillsCount")
              .replace("{on}", String(skills.filter(isOn).length))
              .replace("{count}", String(skills.length))}
          </p>

          {groups.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">{t("mcpNoMatches")}</p>
          )}

          {groups.map(({ group, members }) => (
            <section key={group} className="space-y-2">
              <h3 className="pt-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {headingFor(group)}
              </h3>

              {members.map((skill) => {
                const open = expanded === skill.id;
                const side =
                  skill.surface === "chat" ? t("chatMode") : skill.surface === "code" ? t("codeMode") : null;

                return (
                  <div
                    key={skill.id}
                    className="rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] overflow-hidden"
                  >
                    <div className="flex items-start gap-3 p-3">
                      <BookOpen className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold tracking-tight">{skill.name}</p>
                          {side && (
                            <span className="rounded border border-[var(--border-light)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                              {side}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--text-muted)]">{skill.description}</p>
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-2">
                        <button
                          onClick={() => void expand(skill)}
                          className="p-2 rounded-lg hover:bg-[var(--hover-bg)]"
                          aria-label={`${t("skillInstructions")}: ${skill.name}`}
                          aria-expanded={open}
                        >
                          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
                        </button>
                        <Toggle
                          checked={isOn(skill)}
                          label={skill.name}
                          onChange={(value) => void toggle(skill, value)}
                        />
                      </div>
                    </div>

                    {open && (
                      <div className="space-y-3 border-t-[3px] border-[var(--border-light)] px-4 pb-4 pt-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          {t("skillInstructions")}
                        </p>
                        {loaded?.id === skill.id ? (
                          <>
                            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border-2 border-[var(--border-light)] bg-[var(--bg-base)] px-3 py-2 font-mono text-xs text-[var(--text-main)]">
                              {loaded.body}
                            </pre>
                            {loaded.files.length > 0 && (
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                                  {t("skillFiles")}
                                </p>
                                <ul className="mt-1 space-y-0.5">
                                  {loaded.files.map((name) => (
                                    <li key={name} className="font-mono text-xs text-[var(--text-muted)]">
                                      {name}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-[var(--text-muted)]">{t("loading")}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
