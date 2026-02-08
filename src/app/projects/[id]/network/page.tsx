import { readFile } from "fs/promises";
import Link from "next/link";
import NetworkClient from "./network-client";

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
      <NetworkClient project={project} />
    </div>
  );
}
