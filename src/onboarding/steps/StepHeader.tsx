export default function StepHeader({ title, body }: { title: string; body?: string }) {
  return (
    <header className="space-y-2 text-center">
      <h1 className="text-2xl font-bold tracking-wide">{title}</h1>
      {body && <p className="text-sm font-medium leading-relaxed text-[var(--text-muted)]">{body}</p>}
    </header>
  );
}
