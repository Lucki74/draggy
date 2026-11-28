import { useEffect, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { IconButton } from "../ui/IconButton";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Toggle } from "../settings/Controls";
import { localDescription } from "./descriptions";
import { ExtensionList } from "./ExtensionRow";
import type { InstalledSkill, LoadedSkill } from "../types";
import { swallowed } from "../logger";
import { SkillEditor } from "./SkillEditor";
import type { SkillDraft } from "../agent/skillDraft";

interface SkillsTabProps {
  /** A project whose own skills folder is listed too. Left out, the library and the user's show. */
  workspaceId?: string;
  /** Opens the import screen. Left out, the link is not shown. */
  onImport?: () => void;
  t: (key: string) => string;
}

type Shown = "all" | "on" | "off";

/** The letter a skill sits under in the A to Z list; anything not a letter goes under #. */
function letterOf(name: string): string {
  const first = name.trim().charAt(0).toUpperCase();
  return /\p{L}/u.test(first) ? first : "#";
}

/** Skills tell Draggy how the user wants a job done, as servers connect it to things. Both are
 * switched on here, for the whole app, hence one screen. */
export default function SkillsTab({ workspaceId, onImport, t }: SkillsTabProps) {
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState<Shown>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedSkill | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: SkillDraft } | null>(null);

  const api = window.draggy?.skills;

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

  const edit = async (skill: InstalledSkill) => {
    const result = await api.read(workspaceId || "default", skill.id).catch(swallowed("extensions", "the main process already logged this call"));
    if (result?.success && result.skill) {
      setEditing({ id: skill.id, draft: { name: skill.id, description: result.skill.description, body: result.skill.body } });
    }
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

  const sorted = [...visible].sort((one, other) =>
    one.name.localeCompare(other.name, undefined, { sensitivity: "base", numeric: true }),
  );

  const tagFor = (skill: InstalledSkill) =>
    skill.locked
      ? t("skillLocked")
      : skill.source === "project"
        ? t("thisProject")
        : skill.source === "user"
          ? t("skillsYours")
          : undefined;

  return (
    <div className="space-y-3">
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

          {sorted.length === 0 ? (
            <p className="px-1 text-[13px] text-text-secondary">{t("mcpNoMatches")}</p>
          ) : (
            <ExtensionList>
              {sorted.map((skill, index) => {
                const open = expanded === skill.id;
                const tag = tagFor(skill);
                const letter = letterOf(skill.name);
                const description =
                  skill.source === "library" ? localDescription(t, "skill", skill.id, skill.description) : skill.description;

                return (
                  <div key={skill.id}>
                    {letter !== (index > 0 ? letterOf(sorted[index - 1].name) : "") && (
                      <p className="px-3 pb-1 pt-2.5 text-[11px] font-medium text-text-tertiary">{letter}</p>
                    )}
                    <div
                      className={`flex h-9 items-center gap-2.5 px-3 transition-colors hover:bg-surface-raised/60 ${open ? "bg-surface-raised/60" : ""}`}
                    >
                      <Icon name="book-open" size={15} className="flex-shrink-0 text-text-tertiary" />
                      <button
                        type="button"
                        onClick={() => void expand(skill)}
                        aria-label={`${t("skillInstructions")}: ${skill.name}`}
                        aria-expanded={open}
                        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xs text-start outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        <span className="flex-shrink-0 text-[13px] font-medium text-text-primary">{skill.name}</span>
                        {tag && (
                          <span className="flex-shrink-0 rounded-xs px-1.5 text-[11px] leading-4 text-text-secondary shadow-[inset_0_0_0_1px_var(--rule-control)]">
                            {tag}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">{description}</span>
                        <Icon name="caret-right" size={12} className={`flex-shrink-0 text-text-tertiary transition-transform ${open ? "rotate-90" : ""}`} />
                      </button>
                      {skill.source === "user" && (
                        <IconButton name="pencil-simple" label={`${t("skillEditAction")}: ${skill.name}`} size="dense" onClick={() => void edit(skill)} />
                      )}
                      <Toggle checked={isOn(skill)} disabled={skill.locked} label={skill.name} onChange={(value) => void toggle(skill, value)} />
                    </div>

                    {open && (
                      <div className="space-y-2 px-3 pb-3 ps-[37px]">
                        <p className="text-[12px] leading-[18px] text-text-secondary">{description}</p>
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
                  </div>
                );
              })}
            </ExtensionList>
          )}
        </>
      )}

      {onImport && (
        <button
          type="button"
          onClick={onImport}
          className="px-1 text-[12px] text-text-secondary underline underline-offset-2 outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t("importFromTools")}
        </button>
      )}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t("skillEditTitle")}
        width={560}
        closeLabel={t("closeDialog")}
      >
        {editing && (
          <SkillEditor
            key={editing.id}
            initial={editing.draft}
            existing
            t={t}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setExpanded(null);
              setRevision((count) => count + 1);
            }}
          />
        )}
      </Dialog>

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
