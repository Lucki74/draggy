import { useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { fill } from "../onboarding/text";
import { formatBytes } from "../formatBytes";
import { Badge, ConfirmDialog } from "./Controls";
import type { ImageModelEntry } from "../types";
import { displayModelName, quantizationOf } from "../llama";

/** An installed image model. The engine that draws with it installs itself; see `useImageEngine`. */

const formatSize = (bytes: number) => formatBytes(bytes);

/** One image model in the installed list, in the same row shape as a chat model. */
export function ImageModelRow({
  entry,
  active,
  onRemove,
  t,
}: {
  entry: ImageModelEntry;
  /** It is the model that draws, as Chat and Code are for theirs. */
  active: boolean;
  onRemove: () => void;
  t: (key: string) => string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(false);
  // Cased and trimmed like a chat model, with the quantization beside it rather than inside it.
  const title = displayModelName(entry.name).replace(/^[a-z]/, (letter) => letter.toUpperCase());
  const quantization = entry.variant || quantizationOf(entry.name);
  const name = `${title}${quantization ? ` ${quantization}` : ""}`;

  const detailsId = `image-model-details-${entry.id.replace(/[^\w-]/g, "-")}`;
  const files = entry.files.filter((file) => file.present).map((file) => file.filename);

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={fill(t("showModelDetails"), { model: name })}
          className="-mx-1 min-w-0 flex-1 rounded-sm px-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span className="flex items-center gap-2 text-[14px] leading-5 text-text-primary">
            <span className="truncate">{title}</span>
            {quantization && <span className="flex-shrink-0 font-mono text-[12px] text-text-tertiary">{quantization}</span>}
            <Icon name="caret-down" size={12} className={`flex-shrink-0 text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 text-text-secondary">
            <span className="tabular-nums">{formatSize(entry.size)}</span>
            <Badge strong={active}>{t("capabilityImageGeneration")}</Badge>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`${t("remove")} ${name}`}
          title={t("remove")}
          className="rounded-sm p-2 text-text-tertiary outline-none transition-colors hover:bg-surface-raised hover:text-danger focus-visible:ring-2 focus-visible:ring-focus"
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title={fill(t("removeModelTitle"), { name })}
          body={t("removeModelBody")}
          confirmLabel={t("remove")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onRemove();
          }}
        />
      )}
      {open && (
        <dl id={detailsId} className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-sm bg-surface-raised px-3 py-2.5 text-[12px] leading-4">
          <dt className="text-text-secondary">{t("modelFile")}</dt>
          <dd className="min-w-0 break-all font-mono text-text-primary">{files.join(", ") || entry.id}</dd>
          <dt className="text-text-secondary">{t("modelAbilities")}</dt>
          <dd className="text-text-primary">{t("capabilityImageGeneration")}</dd>
        </dl>
      )}
    </div>
  );
}
