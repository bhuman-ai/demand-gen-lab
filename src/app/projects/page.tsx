import { readFile } from "fs/promises";
import ProjectList from "./project-list";

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
      <h1 className="text-xl font-semibold text-[color:var(--foreground)]">Brands Hub</h1>
      <ProjectList projects={projects} />
    </div>
  );
}
