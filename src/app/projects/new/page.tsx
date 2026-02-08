export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[color:var(--foreground)]">New Project</h1>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">Step 1</div>
        <div className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">Paste website URL</div>
        <div className="mt-2 h-10 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60" />
        <p className="mt-3 text-xs text-[color:var(--muted)]">
          We will scrape the site and prefill brand voice, product lines, and positioning.
        </p>
      </div>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">Step 2</div>
        <div className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">Confirm context</div>
        <p className="mt-2 text-xs text-[color:var(--muted)]">
          Edit the generated summary (target buyers, tone, offers, proof points).
        </p>
      </div>
    </div>
  );
}
