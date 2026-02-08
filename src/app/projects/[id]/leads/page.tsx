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
        <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{project.brandName} — Leads</h1>
        <Link className="text-xs text-[color:var(--accent)]" href={`/projects/${project.id}`}>
          Back to Project
        </Link>
      </div>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Lead list</div>
        <div className="mt-4 overflow-hidden rounded-md border border-[color:var(--border)]">
          <div className="grid grid-cols-4 bg-[color:var(--background)]/60 text-[11px] text-[color:var(--muted)]">
            {['Lead', 'Channel', 'Status', 'Last Touch'].map((label) => (
              <div key={label} className="px-3 py-2">
                {label}
              </div>
            ))}
          </div>
          {(project.leads || []).map((row: any, index: number) => (
            <div key={`${row.name}-${index}`} className="grid grid-cols-4 text-[11px] text-[color:var(--foreground)]">
              <div className="px-3 py-2">{row.name}</div>
              <div className="px-3 py-2">{row.channel}</div>
              <div className="px-3 py-2">{row.status}</div>
              <div className="px-3 py-2">{row.lastTouch}</div>
            </div>
          ))}
          {!(project.leads || []).length ? (
            <div className="px-3 py-3 text-[11px] text-[color:var(--muted)]">No leads yet.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
