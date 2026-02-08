export default function Home() {
  return (
    <div className="space-y-10">
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--glass)]/80 p-7 shadow-[0_24px_80px_-50px_var(--shadow)]">
          <div className="text-[11px] uppercase tracking-[0.35em] text-[color:var(--muted)]">
            Protocol Genesis
          </div>
          <h1 className="mt-3 text-3xl font-semibold text-[color:var(--foreground)]">
            Autonomous Outreach Engine
          </h1>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            Customer.io-first delivery. Genetic sequencing. Conversion-aware global win.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background-elevated)] px-4 py-3 text-left text-sm text-[color:var(--foreground)]">
              + New Brand
              <div className="text-xs text-[color:var(--muted)]">Scrape site and inject context</div>
            </button>
            <button className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background-elevated)] px-4 py-3 text-left text-sm text-[color:var(--foreground)]">
              + New Strategy
              <div className="text-xs text-[color:var(--muted)]">Spin up hypotheses + sequences</div>
            </button>
          </div>
        </div>
        <div className="space-y-4">
          {[
            { label: "Active Brands", value: "0", tone: "text-[color:var(--foreground)]" },
            { label: "Queued Experiments", value: "0", tone: "text-[color:var(--accent)]" },
            { label: "System Health", value: "Stable", tone: "text-[color:var(--success)]" },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5"
            >
              <div className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                {card.label}
              </div>
              <div className={`mt-3 text-2xl font-semibold ${card.tone}`}>{card.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "Hypothesis Queue",
            body: "Generate 50–200 ideas and approve/deny with hotkeys.",
          },
          {
            title: "Evolution Grid",
            body: "Track survivors, cull losers, auto-scale winners.",
          },
          {
            title: "Network Hub",
            body: "Domains, reputation, and burn/replace controls.",
          },
        ].map((card) => (
          <div
            key={card.title}
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5"
          >
            <div className="text-sm font-semibold text-[color:var(--foreground)]">{card.title}</div>
            <p className="mt-2 text-xs text-[color:var(--muted)]">{card.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
