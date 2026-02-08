export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[color:var(--foreground)]">Strategy Input</h1>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <p className="text-sm text-[color:var(--muted)]">Define objective, constraints, and scoring weights.</p>
      </div>
    </div>
  );
}
