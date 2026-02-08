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
        <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{project.brandName}</h1>
        <Link className="text-xs text-[color:var(--accent)]" href="/projects">
          Back to Projects
        </Link>
      </div>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Website</div>
        <div className="mt-1 text-sm text-[color:var(--foreground)]">{project.website}</div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { label: "Tone", value: project.tone },
          { label: "Target buyers", value: project.targetBuyers },
          { label: "Offers", value: project.offers },
          { label: "Proof", value: project.proof },
        ].map((field) => (
          <div
            key={field.label}
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5"
          >
            <div className="text-xs text-[color:var(--muted)]">{field.label}</div>
            <div className="mt-2 text-sm text-[color:var(--foreground)]">
              {field.value || "—"}
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Created</div>
        <div className="mt-1 text-sm text-[color:var(--foreground)]">{project.createdAt}</div>
      </div>
    </div>
  );
}
