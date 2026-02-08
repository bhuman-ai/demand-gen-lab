import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";

const DATA_PATH = `${process.cwd()}/data/projects.json`;

type Project = {
  id: string;
  website: string;
  brandName: string;
  tone: string;
  targetBuyers: string;
  offers: string;
  proof: string;
  createdAt: string;
};

async function readProjects() {
  try {
    const raw = await readFile(DATA_PATH, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [] as Project[];
  }
}

async function writeProjects(projects: Project[]) {
  await mkdir(`${process.cwd()}/data`, { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(projects, null, 2));
}

export async function GET() {
  const projects = await readProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const body = await request.json();
  const website = String(body?.website ?? "").trim();
  const brandName = String(body?.brandName ?? "").trim();

  if (!website || !brandName) {
    return NextResponse.json({ error: "website and brandName are required" }, { status: 400 });
  }

  const projects = await readProjects();
  const project: Project = {
    id: `proj_${Date.now().toString(36)}`,
    website,
    brandName,
    tone: String(body?.tone ?? ""),
    targetBuyers: String(body?.targetBuyers ?? ""),
    offers: String(body?.offers ?? ""),
    proof: String(body?.proof ?? ""),
    createdAt: new Date().toISOString(),
  };
  projects.unshift(project);
  await writeProjects(projects);

  return NextResponse.json({ project });
}
