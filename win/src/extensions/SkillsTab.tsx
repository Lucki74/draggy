import { useEffect, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { IconButton } from "../ui/IconButton";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Toggle } from "../settings/Controls";
import { localDescription } from "./descriptions";
import { ExtensionList, ExtensionRow } from "./ExtensionRow";
import type { InstalledSkill, LoadedSkill } from "../types";
import { swallowed } from "../logger";

interface SkillsTabProps {
  /** A project whose own skills folder is listed too. Left out, the library and the user's show. */
  workspaceId?: string;
  t: (key: string) => string;
}

type Shown = "all" | "on" | "off";

/** The library's shelves, in the order they are shown, after the skills the user wrote. */
const SKILL_CATEGORIES = [
  "writing-editing",
  "human-voice",
  "email-comms",
  "creative-writing",
  "documents-files",
  "spreadsheets",
  "data-analysis",
  "research",
  "learning",
  "languages",
  "productivity-planning",
  "business-strategy",
  "marketing-seo",
  "sales-crm",
  "finance-business",
  "personal-finance",
  "career-hiring",
  "life-admin-travel",
  "design-visual",
  "media-audio-video",
  "software-planning",
  "debugging-testing",
  "code-review-quality",
  "refactor-migration",
  "frontend-ui",
  "backend-apis-db",
  "devops-cloud",
  "security",
  "git-workflow",
  "browser-web-automation",
  "meta-agent",
  "ai-prompting",
];

/** Which heading a skill goes under: the project's and the user's own first, then the library's. */
function groupOf(skill: InstalledSkill): string {
  if (skill.source === "project") return "project";
  if (skill.source === "user") return "user";
  return skill.category && SKILL_CATEGORIES.includes(skill.category) ? skill.category : "meta-agent";
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
  const [adding, setAdding] = useState(false);

  const api = window.electronAPI?.skills;

  useEffect(() => {
    if (!api) return;

    let cancelled = false;

    api
      .list(workspaceId)
      .then((result) => {
        if (!cancelled) setSkills(result?.skills ?? []);
      })
      .catch(swallowed("extensions", "the main process already logged this call"));

    return () => {
      cancelled = true;
    };
  }, [api, workspaceId, revision]);

  if (!api) {
    return <p className="text-[13px] text-text-secondary">{t("mcpUnavailable")}</p>;
  }

  const toggle = async (skill: InstalledSkill, on: boolean) => {
    setSkills((previous) =>
      previous.map((one) => (one.id === skill.id ? { ...one, enabled: on } : one)),
    );
    await api.setEnabled(skill.id, on).catch(swallowed("extensions", "the main process already logged this call"));
  };

  const expand = async (skill: InstalledSkill) => {
    if (expanded === skill.id) {
      setExpanded(null);
      return;
    }

    setExpanded(skill.id);
    setLoaded(null);

    const result = await api.read(workspaceId || "default", skill.id).catch(swallowed("extensions", "the main process already logged this call"));
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
        : t(`skillCategory_${group.replace(/-/g, "_")}`);

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-5 text-text-secondary">{t("skillsHint")}</p>

      <div className="flex flex-wrap items-center gap-2">
        {skills.length > 0 && (
          <>
            <label className="flex h-8 min-w-[180px] flex-1 items-center gap-2 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] outline-none focus-within:ring-2 focus-within:ring-focus">
              <Icon name="magnifying-glass" size={14} className="flex-shrink-0 text-text-tertiary" />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t("skillsSearch")}
                aria-label={t("skillsSearch")}
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-tertiary"
              />
            </label>
            <SegmentedControl
              size="dense"
              ariaLabel={t("extensionFilter")}
              value={shown}
              onChange={setShown}
              options={[
                { value: "all", label: t("mcpAll") },
                { value: "on", label: t("mcpEnabled") },
                { value: "off", label: t("mcpDisabled") },
              ]}
            />
          </>
        )}
        <IconButton name="arrow-clockwise" label={t("refresh")} size="dense" onClick={() => setRevision((count) => count + 1)} />
        <Button variant="secondary" size="dense" icon={<Icon name="plus" size={14} />} onClick={() => setAdding(true)}>
          {t("addSkill")}
        </Button>
      </div>

      {skills.length === 0 ? (
        <p className="px-1 text-[13px] text-text-secondary">{t("noSkillsYet")}</p>
      ) : (
        <>
          <p className="px-1 text-[12px] tabular-nums text-text-tertiary">
            {t("skillsCount")
              .replace("{on}", String(skills.filter(isOn).length))
              .replace("{count}", String(skills.length))}
          </p>

          {groups.length === 0 && <p className="px-1 text-[13px] text-text-secondary">{t("mcpNoMatches")}</p>}

          {groups.map(({ group, members }) => (
            <section key={group} className="space-y-2 pt-2">
              <h3 className="px-1 text-[12px] font-medium text-text-secondary">{headingFor(group)}</h3>

              <ExtensionList>
                {members.map((skill) => {
                  const open = expanded === skill.id;
                  const tag = skill.locked ? t("skillLocked") : undefined;

                  return (
                    <ExtensionRow
                      key={skill.id}
                      leading={<Icon name="book-open" size={18} className="text-text-tertiary" />}
                      name={skill.name}
                      tag={tag}
                      description={skill.source === "library" ? localDescription(t, "skill", skill.id, skill.description) : skill.description}
                      control={
                        <>
                          <button
                            type="button"
                            onClick={() => void expand(skill)}
                            aria-label={`${t("skillInstructions")}: ${skill.name}`}
                            aria-expanded={open}
                            className="rounded-sm p-1.5 text-text-secondary outline-none transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
                          >
                            <Icon name="caret-right" size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
                          </button>
                          <Toggle checked={isOn(skill)} disabled={skill.locked} label={skill.name} onChange={(value) => void toggle(skill, value)} />
                        </>
                      }
                      menuLabel={skill.name}
                    >
                      {open && (
                        <div className="space-y-2">
                          {loaded?.id === skill.id ? (
                            <>
                              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-raised/60 px-3 py-2 font-mono text-[12px] leading-[18px] text-text-primary">
                                {loaded.body}
                              </pre>
                              {loaded.files.length > 0 && (
                                <div>
                                  <p className="text-[12px] font-medium text-text-secondary">{t("skillFiles")}</p>
                                  <ul className="mt-1 space-y-0.5">
                                    {loaded.files.map((name) => (
                                      <li key={name} className="font-mono text-[12px] text-text-secondary">
                                        {name}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-[12px] text-text-secondary">{t("loading")}</p>
                          )}
                        </div>
                      )}
                    </ExtensionRow>
                  );
                })}
              </ExtensionList>
            </section>
          ))}
        </>
      )}

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={t("addSkill")}
        description={t("addSkillHint")}
        closeLabel={t("closeDialog")}
        actions={
          <>
            <Button variant="secondary" icon={<Icon name="folder-open" size={16} />} onClick={() => void api.openFolder()}>
              {t("openFolder")}
            </Button>
            <Button
              onClick={() => {
                setAdding(false);
                setRevision((count) => count + 1);
              }}
            >
              {t("done")}
            </Button>
          </>
        }
      />
    </div>
  );
}
