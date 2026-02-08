"use client";

import { useEffect, useMemo, useState } from "react";

type Project = {
  id: string;
  brandName: string;
};

const teams = [
  { id: "team_all", name: "bhumanai's projects", color: "from-emerald-400 to-lime-400" },
  { id: "team_bhuman", name: "Bhuman", color: "from-sky-400 to-violet-500" },
];

export default function BrandSwitcher() {
  const [open, setOpen] = useState(false);
  const [teamQuery, setTeamQuery] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeTeam, setActiveTeam] = useState(teams[1]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    const loadProjects = async () => {
      try {
        const response = await fetch("/api/projects");
        const data = await response.json();
        if (!mounted) return;
        const list = Array.isArray(data?.projects) ? (data.projects as Project[]) : [];
        setProjects(list);
        setActiveProjectId((prev) => (prev || list[0]?.id || ""));
      } catch {
        if (mounted) {
          setProjects([]);
        }
      }
    };
    loadProjects();
    return () => {
      mounted = false;
    };
  }, []);

  const activeProject = projects.find((project) => project.id === activeProjectId);

  const filteredTeams = useMemo(() => {
    if (!teamQuery.trim()) return teams;
    const query = teamQuery.toLowerCase();
    return teams.filter((team) => team.name.toLowerCase().includes(query));
  }, [teamQuery]);

  const filteredProjects = useMemo(() => {
    if (!projectQuery.trim()) return projects;
    const query = projectQuery.toLowerCase();
    return projects.filter((project) => project.brandName.toLowerCase().includes(query));
  }, [projectQuery, projects]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--background-elevated)]/60 px-3 py-2 text-xs text-[color:var(--foreground)]"
      >
        <span className={`h-6 w-6 rounded-full bg-gradient-to-br ${activeTeam.color}`} />
        <span className="flex items-center gap-2">
          <span className="text-sm">{activeTeam.name}</span>
          <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[10px] text-[color:var(--muted)]">
            Pro
          </span>
          <span className="text-[10px] text-[color:var(--muted)]">/</span>
          <span className="text-sm text-[color:var(--foreground)]">
            {activeProject?.brandName ?? "Select project"}
          </span>
        </span>
        <span className="text-[10px] text-[color:var(--muted)]">▾</span>
      </button>

      {open ? (
        <div className="absolute left-0 top-12 z-20 w-[520px] rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)]/95 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2">
                <input
                  value={teamQuery}
                  onChange={(event) => setTeamQuery(event.target.value)}
                  placeholder="Find Team..."
                  className="w-full bg-transparent text-xs text-[color:var(--foreground)] placeholder:text-[color:var(--muted)] focus:outline-none"
                />
              </div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted)]">Teams</div>
              <div className="space-y-2">
                {filteredTeams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setActiveTeam(team)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs ${
                      activeTeam.id === team.id
                        ? "bg-[color:var(--background)]/60 text-[color:var(--foreground)]"
                        : "text-[color:var(--muted)] hover:bg-[color:var(--background)]/40"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`h-3 w-3 rounded-full bg-gradient-to-br ${team.color}`} />
                      {team.name}
                    </span>
                    {activeTeam.id === team.id ? (
                      <span className="text-[10px] text-[color:var(--accent)]">✓</span>
                    ) : null}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="flex items-center gap-2 rounded-md border border-dashed border-[color:var(--border)] px-2 py-2 text-xs text-[color:var(--muted)]"
              >
                <span className="text-[10px]">+</span> Create Team
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2">
                <input
                  value={projectQuery}
                  onChange={(event) => setProjectQuery(event.target.value)}
                  placeholder="Find Project..."
                  className="w-full bg-transparent text-xs text-[color:var(--foreground)] placeholder:text-[color:var(--muted)] focus:outline-none"
                />
              </div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted)]">Projects</div>
              <div className="space-y-2">
                {filteredProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      setActiveProjectId(project.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs ${
                      activeProjectId === project.id
                        ? "bg-[color:var(--background)]/60 text-[color:var(--foreground)]"
                        : "text-[color:var(--muted)] hover:bg-[color:var(--background)]/40"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 rounded bg-[color:var(--background)]/80 text-center text-[10px] uppercase text-[color:var(--accent)]">
                        {project.brandName?.[0] ?? "P"}
                      </span>
                      {project.brandName}
                    </span>
                    {activeProjectId === project.id ? (
                      <span className="text-[10px] text-[color:var(--accent)]">✓</span>
                    ) : null}
                  </button>
                ))}
                {!filteredProjects.length ? (
                  <div className="rounded-md border border-dashed border-[color:var(--border)] px-2 py-3 text-xs text-[color:var(--muted)]">
                    No projects yet.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
