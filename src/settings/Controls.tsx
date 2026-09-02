/**
 * The small pieces every settings panel is built from, in their own file so a
 * panel can move out of SettingsPage without dragging copies with it.
 */

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)]">
        {title}
      </h2>
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </label>
      {children}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className="w-14 h-8 rounded-full p-1 border-[3px] border-[var(--border-light)] transition-colors"
      style={{
        backgroundColor: checked ? "var(--bg-inverted)" : "var(--hover-bg)",
      }}
    >
      <span
        className={`block w-4 h-4 rounded-full transition-transform ${
          checked ? "translate-x-6" : ""
        }`}
        style={{ backgroundColor: checked ? "var(--text-inverted)" : "var(--text-muted)" }}
      />
    </button>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}
