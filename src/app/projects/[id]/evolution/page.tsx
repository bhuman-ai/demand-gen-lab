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
        <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{project.brandName} — Evolution</h1>
        <Link className="text-xs text-[color:var(--accent)]" href={`/projects/${project.id}`}>
          Back to Project
        </Link>
      </div>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Active sequences</div>
        <div className="mt-3 grid gap-2">
          {(project.sequences || []).slice(0, 12).map((sequence: any) => (
            <div key={sequence.name} className="rounded-md border border-[color:var(--border)] px-3 py-2">
              <div className="text-xs text-[color:var(--muted)]">{sequence.status}</div>
              <div className="text-sm text-[color:var(--foreground)]">{sequence.name}</div>
            </div>
          ))}
          {!(project.sequences || []).length ? (
            <div className="text-xs text-[color:var(--muted)]">No sequences yet.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
