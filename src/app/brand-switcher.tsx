"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Brand = {
  id: string;
  brandName: string;
};

const teams = [
  { id: "team_all", name: "bhumanai's brands", color: "from-emerald-400 to-lime-400" },
  { id: "team_bhuman", name: "Bhuman", color: "from-sky-400 to-violet-500" },
];

const ACTIVE_BRAND_KEY = "factory.activeBrandId";
const ACTIVE_TEAM_KEY = "factory.activeTeamId";

export default function BrandSwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [teamQuery, setTeamQuery] = useState("");
  const [brandQuery, setBrandQuery] = useState("");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeTeam, setActiveTeam] = useState(teams[1]);
  const [activeBrandId, setActiveBrandId] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    const savedBrandId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_BRAND_KEY) : "";
    if (savedBrandId) {
      setActiveBrandId(savedBrandId);
    }
    const savedTeamId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_TEAM_KEY) : "";
    if (savedTeamId) {
      const savedTeam = teams.find((team) => team.id === savedTeamId);
      if (savedTeam) {
        setActiveTeam(savedTeam);
      }
    }
    const loadBrands = async () => {
      try {
        const response = await fetch("/api/brands");
        const data = await response.json();
        if (!mounted) return;
        const list = Array.isArray(data?.brands) ? (data.brands as Brand[]) : [];
        setBrands(list);
        setActiveBrandId((prev) => {
          if (prev && list.some((item) => item.id === prev)) return prev;
          const fallback = list[0]?.id || "";
          if (fallback && typeof window !== "undefined") {
            localStorage.setItem(ACTIVE_BRAND_KEY, fallback);
          }
          return fallback;
        });
      } catch {
        if (mounted) {
          setBrands([]);
        }
      }
    };
    loadBrands();
    return () => {
      mounted = false;
    };
  }, []);

  const activeBrand = brands.find((brand) => brand.id === activeBrandId);

  const filteredTeams = useMemo(() => {
    if (!teamQuery.trim()) return teams;
    const query = teamQuery.toLowerCase();
    return teams.filter((team) => team.name.toLowerCase().includes(query));
  }, [teamQuery]);

  const filteredBrands = useMemo(() => {
    if (!brandQuery.trim()) return brands;
    const query = brandQuery.toLowerCase();
    return brands.filter((brand) => brand.brandName.toLowerCase().includes(query));
  }, [brandQuery, brands]);

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
            {activeBrand?.brandName ?? "Select brand"}
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
                    onClick={() => {
                      setActiveTeam(team);
                      if (typeof window !== "undefined") {
                        localStorage.setItem(ACTIVE_TEAM_KEY, team.id);
                      }
                    }}
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
                  value={brandQuery}
                  onChange={(event) => setBrandQuery(event.target.value)}
                  placeholder="Find Brand..."
                  className="w-full bg-transparent text-xs text-[color:var(--foreground)] placeholder:text-[color:var(--muted)] focus:outline-none"
                />
              </div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted)]">Brands</div>
              <div className="space-y-2">
                {filteredBrands.map((brand) => (
                  <button
                    key={brand.id}
                    type="button"
                    onClick={() => {
                      setActiveBrandId(brand.id);
                      setOpen(false);
                      if (typeof window !== "undefined") {
                        localStorage.setItem(ACTIVE_BRAND_KEY, brand.id);
                      }
                      router.push(`/brands/${brand.id}`);
                    }}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs ${
                      activeBrandId === brand.id
                        ? "bg-[color:var(--background)]/60 text-[color:var(--foreground)]"
                        : "text-[color:var(--muted)] hover:bg-[color:var(--background)]/40"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 rounded bg-[color:var(--background)]/80 text-center text-[10px] uppercase text-[color:var(--accent)]">
                        {brand.brandName?.[0] ?? "B"}
                      </span>
                      {brand.brandName}
                    </span>
                    {activeBrandId === brand.id ? (
                      <span className="text-[10px] text-[color:var(--accent)]">✓</span>
                    ) : null}
                  </button>
                ))}
                {!filteredBrands.length ? (
                  <div className="rounded-md border border-dashed border-[color:var(--border)] px-2 py-3 text-xs text-[color:var(--muted)]">
                    No brands yet.
                  </div>
                ) : null}
              </div>
              <Link
                href="/brands/new"
                onClick={() => setOpen(false)}
                className="mt-2 flex items-center justify-center rounded-md border border-dashed border-[color:var(--border)] px-2 py-2 text-xs text-[color:var(--muted)]"
              >
                + New Brand
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
