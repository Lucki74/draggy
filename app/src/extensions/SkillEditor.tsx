import { useState } from "react";
import { Button } from "../ui/Button";
import { slugify, SKILL_NAME_MAX, type SkillDraft } from "../agent/skillDraft";
import { logRendererError } from "../logger";

interface SkillEditorProps {
  initial: SkillDraft;
  /** Editing a skill that exists: the name is its folder, so it is fixed, and saving replaces it. */
  existing?: boolean;
  t: (key: string) => string;
  onSaved: (id: string) => void;
  onCancel: () => void;
  cancelLabel?: string;
}

const FIELD =
  "w-full rounded-sm bg-surface-base px-3 py-1.5 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] outline-none placeholder:text-text-tertiary focus-visible:ring-2 focus-visible:ring-focus";

/** One skill's name, description and instructions, as the SKILL.md it will become. Nothing is written until Save. */
export function SkillEditor({ initial, existing = false, t, onSaved, onCancel, cancelLabel }: SkillEditorProps) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [body, setBody] = useState(initial.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = existing ? name : slugify(name);
  const ready = slug.length > 0 && description.trim().length > 0 && body.trim().length > 0 && !busy;

  const save = async () => {
    const api = window.draggy?.skills;
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.save({ name: slug, description, body, overwrite: existing });
      if (result?.success) onSaved(result.id ?? slug);
      else setError(result?.error || t("skillSaveFailed"));
    } catch (failure) {
      logRendererError("extensions", "skill save failed", failure, { overwrite: existing });
      setError(t("skillSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="skill-editor">
      <label className="block space-y-1">
        <span className="text-[12px] font-medium text-text-secondary">{t("skillFieldName")}</span>
        <input
          value={name}
          readOnly={existing}
          maxLength={SKILL_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
          className={`${FIELD} font-mono ${existing ? "opacity-70" : ""}`}
        />
        {!existing && name && slug !== name && (
          <span className="text-[12px] text-text-tertiary">{`${t("skillSavedAs")} ${slug}`}</span>
        )}
      </label>
      <label className="block space-y-1">
        <span className="text-[12px] font-medium text-text-secondary">{t("skillFieldDescription")}</span>
        <input value={description} onChange={(event) => setDescription(event.target.value)} className={FIELD} />
      </label>
      <label className="block space-y-1">
        <span className="text-[12px] font-medium text-text-secondary">{t("skillFieldBody")}</span>
        <textarea
          value={body}
          rows={10}
          onChange={(event) => setBody(event.target.value)}
          className={`${FIELD} resize-y font-mono text-[12px] leading-[18px]`}
        />
      </label>
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="dense" onClick={onCancel} disabled={busy}>
          {cancelLabel ?? t("cancel")}
        </Button>
        <Button size="dense" onClick={() => void save()} disabled={!ready}>
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
