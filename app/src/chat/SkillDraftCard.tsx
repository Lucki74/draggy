import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { Button } from "../ui/Button";
import { SkillEditor } from "../extensions/SkillEditor";
import { SKILL_DRAFT_DONE_EVENT, requestSkillDraft, type SkillDraft } from "../agent/skillDraft";
import type { Message } from "../types";

type Phase = "offer" | "drafting" | "failed" | "editing" | "saved";

/** The card after a long Code task: offers a skill, writes a draft on request, and saves only when the user clicks Save. */
export function SkillDraftCard({ msg, t }: { msg: Message; t: (key: string) => string }) {
  const source = msg.skillDraft;
  const [phase, setPhase] = useState<Phase>("offer");
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [savedId, setSavedId] = useState("");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  if (!source) return null;

  const finish = () => {
    window.dispatchEvent(new CustomEvent(SKILL_DRAFT_DONE_EVENT, { detail: { chatId: source.chatId, messageId: msg.id } }));
  };

  const write = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPhase("drafting");
    try {
      const result = await requestSkillDraft(source.model, source, controller.signal);
      if (controller.signal.aborted) return;
      if (result) {
        setDraft(result);
        setPhase("editing");
      } else {
        setPhase("failed");
      }
    } catch {
      if (!controller.signal.aborted) setPhase("failed");
    }
  };

  return (
    <div data-testid="skill-draft" className="w-full space-y-2 rounded-md bg-surface-raised/60 px-3 py-2 text-[13px] text-text-secondary">
      <div className="flex items-center gap-2">
        <Icon name="lightbulb" size={14} className="flex-shrink-0 text-text-tertiary" />
        <span className="min-w-0 flex-1">
          {phase === "drafting"
            ? t("skillDrafting")
            : phase === "failed"
              ? t("skillDraftFailed")
              : phase === "saved"
                ? `${t("skillSaved")} ${savedId}`
                : phase === "editing"
                  ? t("skillDraftReview")
                  : t("skillOfferText")}
        </span>
        {(phase === "offer" || phase === "failed") && (
          <>
            <Button size="dense" onClick={() => void write()}>
              {phase === "failed" ? t("retry") : t("skillOfferDraft")}
            </Button>
            <Button size="dense" variant="ghost" onClick={finish}>
              {t("dismiss")}
            </Button>
          </>
        )}
        {phase === "drafting" && (
          <Button
            size="dense"
            variant="ghost"
            onClick={() => {
              abort.current?.abort();
              setPhase("offer");
            }}
          >
            {t("cancel")}
          </Button>
        )}
        {phase === "saved" && (
          <Button size="dense" variant="ghost" onClick={finish}>
            {t("dismiss")}
          </Button>
        )}
      </div>
      {phase === "editing" && draft && (
        <SkillEditor
          initial={draft}
          t={t}
          cancelLabel={t("skillDiscard")}
          onCancel={finish}
          onSaved={(id) => {
            setSavedId(id);
            setPhase("saved");
          }}
        />
      )}
    </div>
  );
}

export default SkillDraftCard;
