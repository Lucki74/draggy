import { Icon } from "../ui";

interface StepLineProps {
  verb: React.ReactNode;
  target?: string;
  mono?: boolean;
  /** One quiet note on how it went, shown once the step is done. */
  meta?: string;
  failed?: boolean;
  active: boolean;
  open: boolean;
  /** Absent for a step with nothing more to show. */
  onToggle?: () => void;
  time?: React.ReactNode;
  /** Quiet links after the line, such as Open or Undo. */
  actions?: React.ReactNode;
  details?: React.ReactNode;
  t: (key: string) => string;
}

/** One step as one line: the verb, what it acted on, how it went, and a caret that opens the rest. */
export function StepLine({ verb, target, mono, meta, failed, active, open, onToggle, time, actions, details, t }: StepLineProps) {
  return (
    <div className={`step-rise${open ? " step-open" : ""}`}>
      <div className="rail-row flex min-h-6 items-center gap-[7px] text-[13px] text-text-secondary">
        <button
          type="button"
          data-testid={onToggle ? "step-details-toggle" : undefined}
          aria-expanded={onToggle ? open : undefined}
          title={onToggle ? (open ? t("hideStepDetails") : t("showStepDetails")) : undefined}
          disabled={!onToggle}
          onClick={onToggle}
          className={`step-line flex min-h-6 min-w-0 flex-1 gap-[7px] text-start ${open ? "items-start [&>*]:pt-[3px]" : "items-center"} ${onToggle ? "cursor-pointer hover:text-text-primary" : "cursor-default"}`}
        >
          <span className={`flex-none${active ? " live-sweep" : ""}`}>{verb}</span>
          {target && (
            <span className={`min-w-0 text-text-tertiary ${open ? "whitespace-pre-wrap wrap-anywhere" : "truncate"}${mono ? " font-mono text-[12px]" : ""}`}>
              {target}
            </span>
          )}
          {meta && !active && <span className={`flex-none text-[12px] ${failed ? "text-danger" : "text-text-tertiary"}`}>{meta}</span>}
          {onToggle && (
            // One line tall and centred in it, so the caret sits on the text whether the row is open or wrapped.
            <span className="step-caret box-content flex h-[1lh] flex-none items-center text-text-tertiary">
              <Icon name="caret-right" size={11} mirrored className={`transition-transform duration-[250ms] ${open ? "rotate-90" : ""}`} />
            </span>
          )}
          {time}
        </button>
        {actions && <span className="flex flex-none items-center gap-3 ps-1">{actions}</span>}
      </div>
      {details && (
        <div className={`step-more grid transition-[grid-template-rows] duration-[350ms] ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="min-h-0 overflow-hidden" inert={!open}>
            <div className="pt-1.5 pb-1">{details}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export const linkClass = "text-[12px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline";
