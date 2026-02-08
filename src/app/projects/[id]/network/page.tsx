import { readFile } from "fs/promises";
import Link from "next/link";

async function loadProjects() {
  try {
    const raw = await readFile(`${process.cwd()}/data/projects.json`, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projects = await loadProjects();
  const project = projects.find((item: any) => item.id === id);

  if (!project) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-[color:var(--foreground)]">Project Not Found</h1>
        <Link className="text-xs text-[color:var(--accent)]" href="/projects">
          Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{project.brandName} — Network</h1>
        <Link className="text-xs text-[color:var(--accent)]" href={`/projects/${project.id}`}>
          Back to Project
        </Link>
      </div>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Domains & reputation</div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            { label: "Active domains", value: 0 },
            { label: "Warming up", value: 0 },
            { label: "Reputation risk", value: "Low" },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-4 py-3"
            >
              <div className="text-[11px] text-[color:var(--muted)]">{item.label}</div>
              <div className="mt-1 text-sm text-[color:var(--foreground)]">{item.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-md border border-dashed border-[color:var(--border)] px-3 py-5 text-center text-xs text-[color:var(--muted)]">
          Domains are managed globally. This view will surface project-specific assignments.
        </div>
      </div>
    </div>
  );
}
