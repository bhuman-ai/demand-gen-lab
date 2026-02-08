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

export default async function Page() {
  const projects = await loadProjects();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[color:var(--foreground)]">Universal Inbox</h1>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <p className="text-sm text-[color:var(--muted)]">Replies, sentiment, and battlecards.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {projects.map((project: any) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}/inbox`}
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-4 py-3 text-xs text-[color:var(--foreground)]"
            >
              {project.brandName}
            </Link>
          ))}
          {!projects.length ? (
            <div className="rounded-md border border-dashed border-[color:var(--border)] px-4 py-3 text-xs text-[color:var(--muted)]">
              No projects yet.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
