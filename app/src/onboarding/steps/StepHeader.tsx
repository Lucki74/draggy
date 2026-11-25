export default function StepHeader({ title, body }: { title: string; body?: string }) {
  return (
    <header className="space-y-1.5">
      <h1 className="text-[22px] font-semibold leading-8 tracking-[-0.01em] text-text-primary">{title}</h1>
      {body && <p className="text-[14px] leading-6 text-text-secondary">{body}</p>}
    </header>
  );
}
