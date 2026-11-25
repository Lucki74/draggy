import type { ReactNode } from "react";
import { Menu, type MenuEntry } from "../ui/Menu";
import { IconButton } from "../ui/IconButton";
import { StatusDot, type StatusKind } from "../ui/StatusDot";

/** The card a list of extensions sits in, one row per server or skill. */
export function ExtensionList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-rule rounded-md bg-surface-base shadow-[0_0_0_1px_var(--rule-strong)]">
      {children}
    </div>
  );
}

/** One server or skill: what it is, whether it is running, its switch, and the rest behind a menu.
 * Servers, remote servers and skills all use this row so the three tabs read alike. */
export function ExtensionRow({
  leading,
  name,
  tag,
  status,
  meta,
  description,
  note,
  control,
  menu,
  menuLabel,
  children,
}: {
  leading: ReactNode;
  name: string;
  /** A word beside the name, such as which side a skill belongs to. */
  tag?: string;
  status?: { kind: StatusKind; text: string };
  /** Shown after the status, in mono: the package or the address. */
  meta?: string;
  description?: string;
  /** A caution or an error, under the description. */
  note?: ReactNode;
  control?: ReactNode;
  menu?: MenuEntry[];
  menuLabel: string;
  /** What opens under the row: settings, or a skill's instructions. */
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-start gap-3 px-3 py-3">
        <span className="mt-0.5 flex w-7 flex-shrink-0 justify-center">{leading}</span>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium leading-5 text-text-primary">{name}</span>
            {tag && (
              <span className="flex-shrink-0 rounded-xs px-1.5 text-[11px] leading-4 text-text-secondary shadow-[inset_0_0_0_1px_var(--rule-control)]">
                {tag}
              </span>
            )}
          </p>

          {(status || meta) && (
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-text-secondary">
              {status && (
                <>
                  <StatusDot status={status.kind} />
                  <span className="flex-shrink-0 tabular-nums">{status.text}</span>
                </>
              )}
              {status && meta && <span aria-hidden="true">·</span>}
              {meta && <span className="truncate font-mono text-[11px] text-text-tertiary">{meta}</span>}
            </p>
          )}

          {description && <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-text-secondary">{description}</p>}
          {note}
        </div>

        <div className="flex flex-shrink-0 items-center gap-1">
          {control}
          {menu && menu.length > 0 && (
            <Menu
              label={menuLabel}
              align="end"
              items={menu}
              trigger={(props) => <IconButton {...props} name="dots-three" label={menuLabel} size="dense" />}
            />
          )}
        </div>
      </div>

      {children && <div className="pb-3 pe-3 ps-[52px]">{children}</div>}
    </div>
  );
}
