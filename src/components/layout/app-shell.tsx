"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FolderKanban,
  FlaskConical,
  Inbox,
  Mail,
  Network,
  Settings,
  Sparkles,
  TestTubeDiagonal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchBrandDirectory, readCachedBrandDirectory } from "@/lib/brand-directory-client";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/telemetry-client";
import OperatorPanel from "@/components/operator/operator-panel";
import BrandSwitcher, { getActiveBrandIdFromPath } from "./brand-switcher";
import BrandWordmark from "./brand-wordmark";
import GlobalCommandPalette from "./global-command-palette";

const ACTIVE_BRAND_KEY = "factory.activeBrandId";
const BUILD_ID_KEY = "lastb2b.buildId";
const BUILD_RELOAD_GUARD_KEY = "lastb2b.buildReloaded";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

type MainNavItem = NavItem & {
  id: "experiments" | "campaigns" | "network" | "leads" | "inbox";
};

const CHROMELESS_ROUTES = new Set(["/autoads", "/google-ads-review"]);

function prettySegment(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function breadcrumb(pathname: string, activeBrandName?: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return "last b2b";
  if (parts[0] !== "brands") return `last b2b / ${parts.map(prettySegment).join(" / ")}`;
  if (parts[1] === "new") return "last b2b / New brand";
  const normalized = ["last b2b", activeBrandName || "Brand"];
  if (parts[2] === "experiments") {
    normalized.push("Experiments");
    if (parts[3] === "suggestions") {
      normalized.push("Suggestions");
      return normalized.join(" / ");
    }
    if (parts[3]) normalized.push("Experiment");
    if (parts[4]) {
      normalized.push(prettySegment(parts[4]));
    }
    return normalized.join(" / ");
  }
  if (parts[2] === "campaigns") {
    normalized.push("Campaigns");
    if (parts[3]) normalized.push("Campaign");
    return normalized.join(" / ");
  }
  if (parts[2] === "network") {
    normalized.push("Senders");
    return normalized.join(" / ");
  }
  if (parts[2]) {
    normalized.push(prettySegment(parts[2]));
  }
  return normalized.join(" / ");
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const chromeless = CHROMELESS_ROUTES.has(pathname);
  const pathBrandId = getActiveBrandIdFromPath(pathname);
  const storedBrandId =
    typeof window !== "undefined" ? localStorage.getItem(ACTIVE_BRAND_KEY) || "" : "";
  const activeBrandId = pathBrandId || storedBrandId;
  const [resolvedActiveBrand, setResolvedActiveBrand] = useState(() => ({
    brandId: activeBrandId,
    name: readCachedBrandDirectory().find((row) => row.id === activeBrandId)?.name || "",
  }));
  const [operatorOpen, setOperatorOpen] = useState(false);

  useEffect(() => {
    if (chromeless) return;
    if (pathBrandId) {
      localStorage.setItem(ACTIVE_BRAND_KEY, pathBrandId);
    }
  }, [chromeless, pathBrandId]);

  useEffect(() => {
    let mounted = true;
    if (chromeless) {
      return () => {
        mounted = false;
      };
    }
    if (!activeBrandId) {
      return () => {
        mounted = false;
      };
    }

    const cachedRows = readCachedBrandDirectory();
    const load = async () => {
      try {
        const rows = await fetchBrandDirectory({ force: cachedRows.length === 0 });
        if (!mounted) return;
        const activeBrand = rows.find((row) => row.id === activeBrandId);
        setResolvedActiveBrand({
          brandId: activeBrandId,
          name: activeBrand?.name || "Brand",
        });
      } catch {
        if (mounted) {
          setResolvedActiveBrand({
            brandId: activeBrandId,
            name: "Brand",
          });
        }
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [activeBrandId, chromeless]);

  const activeBrandName = useMemo(() => {
    if (resolvedActiveBrand.brandId === activeBrandId && resolvedActiveBrand.name) {
      return resolvedActiveBrand.name;
    }
    return readCachedBrandDirectory().find((row) => row.id === activeBrandId)?.name || "";
  }, [activeBrandId, resolvedActiveBrand]);

  useEffect(() => {
    if (chromeless) return;
    const previous = sessionStorage.getItem("factory.previousPath");
    const beforePrevious = sessionStorage.getItem("factory.beforePreviousPath");
    if (beforePrevious && pathname === beforePrevious && previous && previous !== pathname) {
      trackEvent("nav_backtrack", { from: previous, to: pathname });
    }
    sessionStorage.setItem("factory.beforePreviousPath", previous || "");
    sessionStorage.setItem("factory.previousPath", pathname);
  }, [chromeless, pathname]);

  useEffect(() => {
    let cancelled = false;
    if (chromeless) {
      return () => {
        cancelled = true;
      };
    }

    const checkBuild = async () => {
      try {
        const response = await fetch("/api/build-id", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled) return;
        const nextId = String(payload?.buildId || "");
        if (!nextId) return;
        const stored = sessionStorage.getItem(BUILD_ID_KEY);
        if (stored && stored !== nextId) {
          sessionStorage.setItem(BUILD_ID_KEY, nextId);
          if (sessionStorage.getItem(BUILD_RELOAD_GUARD_KEY) !== "1") {
            sessionStorage.setItem(BUILD_RELOAD_GUARD_KEY, "1");
            window.location.reload();
          }
          return;
        }
        sessionStorage.removeItem(BUILD_RELOAD_GUARD_KEY);
        sessionStorage.setItem(BUILD_ID_KEY, nextId);
      } catch {
        // Ignore build-id fetch failures.
      }
    };

    void checkBuild();

    return () => {
      cancelled = true;
    };
  }, [chromeless]);

  const hasActiveBrand = Boolean(activeBrandId);
  const brandRoot = hasActiveBrand ? `/brands/${activeBrandId}` : "/brands";

  const mainItems = useMemo<MainNavItem[]>(
    () => [
      {
        id: "experiments",
        label: "Experiments",
        href: hasActiveBrand ? `${brandRoot}/experiments` : "/brands",
        icon: TestTubeDiagonal,
      },
      { id: "campaigns", label: "Campaigns", href: hasActiveBrand ? `${brandRoot}/campaigns` : "/brands", icon: FolderKanban },
      { id: "network", label: "Senders", href: hasActiveBrand ? `${brandRoot}/network` : "/brands", icon: Network },
      { id: "leads", label: "Leads", href: hasActiveBrand ? `${brandRoot}/leads` : "/brands", icon: Mail },
      { id: "inbox", label: "Inbox", href: hasActiveBrand ? `${brandRoot}/inbox` : "/brands", icon: Inbox },
    ],
    [brandRoot, hasActiveBrand]
  );

  const activeMainItem = useMemo(() => {
    if (hasActiveBrand) {
      if (pathname === `${brandRoot}/experiments` || pathname.startsWith(`${brandRoot}/experiments/`)) return "experiments";
      if (pathname === `${brandRoot}/campaigns` || pathname.startsWith(`${brandRoot}/campaigns/`)) return "campaigns";
      if (pathname === `${brandRoot}/network` || pathname.startsWith(`${brandRoot}/network/`)) return "network";
      if (pathname === `${brandRoot}/leads` || pathname.startsWith(`${brandRoot}/leads/`)) return "leads";
      if (pathname === `${brandRoot}/inbox` || pathname.startsWith(`${brandRoot}/inbox/`)) return "inbox";
    }
    return "";
  }, [pathname, brandRoot, hasActiveBrand]);

  const toolItems: NavItem[] = [
    { label: "Settings", href: "/settings/outreach", icon: Settings },
    { label: "Logic", href: "/logic", icon: Activity },
    { label: "Doctor", href: "/doctor", icon: FlaskConical },
  ];

  if (chromeless) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[260px_1fr]">
        <aside className="min-w-0 border-b border-[color:var(--border)] bg-[color:var(--sidebar)] px-4 py-5 md:border-b-0 md:border-r md:px-5">
          <div className="flex h-full min-w-0 flex-col">
            <Link href="/" className="group block border-b border-[color:var(--border)] pb-4">
              <BrandWordmark
                animated
                lastClassName="text-[2rem]"
                b2bClassName="mb-[0.26em] text-[0.72rem] tracking-[0.1em] transition-colors group-hover:text-[color:var(--foreground)]"
              />
            </Link>

            <div className="mt-5 min-w-0">
              <BrandSwitcher />
            </div>

            <div className="mt-6">
              <div className="mb-2 text-[12px] text-[color:var(--muted-foreground)]">Work</div>
              <nav className="grid gap-1.5">
                {mainItems.map((item) => {
                  const active = item.id === activeMainItem;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={cn(
                        "inline-flex items-center gap-3 rounded-[8px] border px-3 py-2.5 text-sm transition-colors duration-150",
                        active
                          ? "border-[color:var(--border-strong)] bg-[color:var(--surface)] text-[color:var(--foreground)]"
                          : "border-transparent text-[color:var(--muted-foreground)] hover:border-[color:var(--border)] hover:bg-[color:var(--surface)] hover:text-[color:var(--foreground)]"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="mt-6 border-t border-[color:var(--border)] pt-5">
              <div className="mb-2 text-[12px] text-[color:var(--muted-foreground)]">System</div>
              <nav className="grid gap-1.5">
                {toolItems.map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "inline-flex items-center gap-3 rounded-[8px] border px-3 py-2.5 text-sm transition-colors duration-150",
                        active
                          ? "border-[color:var(--border-strong)] bg-[color:var(--surface)] text-[color:var(--foreground)]"
                          : "border-transparent text-[color:var(--muted-foreground)] hover:border-[color:var(--border)] hover:bg-[color:var(--surface)] hover:text-[color:var(--foreground)]"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

          </div>
        </aside>

        <main className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-[color:var(--border)] bg-[color:var(--background)]/96 px-4 py-3 backdrop-blur-sm md:px-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 text-sm text-[color:var(--muted-foreground)]">
                {breadcrumb(pathname, activeBrandId ? activeBrandName : "")}
              </div>
              <div className="flex items-center gap-2">
                <GlobalCommandPalette activeBrandId={activeBrandId} />
                <button
                  type="button"
                  onClick={() => setOperatorOpen(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-medium text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-hover)]"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Operator
                </button>
              </div>
            </div>
          </header>
          <div className="p-4 md:px-8 md:py-7">{children}</div>
        </main>
      </div>
      <OperatorPanel
        open={operatorOpen}
        onOpenChange={setOperatorOpen}
        activeBrandId={activeBrandId}
        activeBrandName={activeBrandName}
      />
    </div>
  );
}
