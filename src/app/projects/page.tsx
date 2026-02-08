export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[color:var(--foreground)]">Projects Hub</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { name: "Nova Studios", status: "Idle", metric: "0 active sequences" },
          { name: "Orion Labs", status: "Paused", metric: "2 experiments archived" },
          { name: "Helios Games", status: "Draft", metric: "Awaiting intake" },
          { name: "Vanta Creative", status: "Draft", metric: "No domains yet" },
        ].map((project) => (
          <div
            key={project.name}
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5"
          >
            <div className="flex items-center justify-between text-sm font-semibold text-[color:var(--foreground)]">
              {project.name}
              <span className="text-xs text-[color:var(--muted)]">{project.status}</span>
            </div>
            <p className="mt-2 text-xs text-[color:var(--muted)]">{project.metric}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
