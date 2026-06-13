"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FolderKanban,
  FlaskConical,
  Inbox,
  Mail,
  MessageSquareText,
  Network,
  PanelLeft,
  Radar,
  Send,
  Settings,
  Sparkles,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { fetchOperatorAttention } from "@/lib/client-api";
import { fetchBrandDirectory, readCachedBrandDirectory } from "@/lib/brand-directory-client";
import { redirectToCanonicalLastB2bHost } from "@/lib/client-api-url";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/telemetry-client";
import OperatorPanel from "@/components/operator/operator-panel";
import BrandSwitcher, { getActiveBrandIdFromPath } from "./brand-switcher";
import GlobalCommandPalette from "./global-command-palette";

const ACTIVE_BRAND_KEY = "factory.activeBrandId";
const BUILD_ID_KEY = "lastb2b.buildId";
const BUILD_RELOAD_GUARD_KEY = "lastb2b.buildReloaded";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

type OperatorOpenRequest = {
  id: number;
  message: string;
  autoSend: boolean;
};

type MainNavItem = NavItem & {
  id: "agent" | "send" | "missions" | "campaigns" | "experiments" | "network" | "leads" | "inbox" | "social-discovery";
};

const CHROMELESS_ROUTES = new Set(["/autoads", "/google-ads-review"]);

function AttentionCount({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="ml-auto inline-flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--foreground)] px-1.5 text-[11px] font-medium leading-none text-[color:var(--background)]">
      {count > 9 ? "9+" : count}
    </span>
  );
}

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
  if (parts[2] === "missions") {
    normalized.push("Goals");
    if (parts[3]) normalized.push("Goal");
    return normalized.join(" / ");
  }
  if (parts[2] === "experiments") {
    normalized.push("Tests");
    if (parts[3] === "suggestions") {
      normalized.push("Suggestions");
      return normalized.join(" / ");
    }
    if (parts[3]) normalized.push("Test");
    if (parts[4]) {
      normalized.push(prettySegment(parts[4]));
    }
    return normalized.join(" / ");
  }
  if (parts[2] === "campaigns") {
    normalized.push("Outbound");
    if (parts[3]) normalized.push("Campaign");
    return normalized.join(" / ");
  }
  if (parts[2] === "network") {
    normalized.push("Delivery");
    return normalized.join(" / ");
  }
  if (parts[2] === "leads") {
    normalized.push("Audience");
    return normalized.join(" / ");
  }
  if (parts[2] === "social-discovery") {
    normalized.push("Social");
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
  const [operatorRequest, setOperatorRequest] = useState<OperatorOpenRequest | null>(null);
  const [operatorAttentionCount, setOperatorAttentionCount] = useState(0);

  useLayoutEffect(() => {
    redirectToCanonicalLastB2bHost();
  }, []);

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
    const handleOpenOperator = (event: Event) => {
      const detail = (event as CustomEvent<Partial<Pick<OperatorOpenRequest, "message" | "autoSend">>>).detail ?? {};
      setOperatorRequest({
        id: Date.now(),
        message: typeof detail.message === "string" ? detail.message : "",
        autoSend: Boolean(detail.autoSend),
      });
      setOperatorOpen(true);
    };
    window.addEventListener("lastb2b:open-operator", handleOpenOperator);
    return () => window.removeEventListener("lastb2b:open-operator", handleOpenOperator);
  }, [chromeless]);

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
    if (chromeless || !activeBrandId) {
      return () => {
        cancelled = true;
      };
    }

    const loadAttention = async () => {
      try {
        const attention = await fetchOperatorAttention({
          brandId: activeBrandId,
          status: "open",
          limit: 20,
        });
        if (!cancelled) setOperatorAttentionCount(attention.count);
      } catch {
        if (!cancelled) setOperatorAttentionCount(0);
      }
    };
    const handleOperatorUpdated = () => {
      void loadAttention();
    };

    void loadAttention();
    window.addEventListener("lastb2b:operator-updated", handleOperatorUpdated);
    const interval = window.setInterval(loadAttention, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("lastb2b:operator-updated", handleOperatorUpdated);
      window.clearInterval(interval);
    };
  }, [activeBrandId, chromeless]);

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
  const visibleOperatorAttentionCount = activeBrandId ? operatorAttentionCount : 0;

  const mainItems = useMemo<MainNavItem[]>(
    () => [
      {
        id: "agent",
        label: "Brand GPT",
        href: brandRoot,
        icon: MessageSquareText,
      },
      { id: "send", label: "Send", href: hasActiveBrand ? `${brandRoot}/send` : "/brands", icon: Send },
      { id: "inbox", label: "Inbox", href: hasActiveBrand ? `${brandRoot}/inbox` : "/brands", icon: Inbox },
      {
        id: "leads",
        label: "Audience",
        href: hasActiveBrand ? `${brandRoot}/leads` : "/brands",
        icon: Mail,
      },
      { id: "network", label: "Delivery", href: hasActiveBrand ? `${brandRoot}/network` : "/brands", icon: Network },
    ],
    [brandRoot, hasActiveBrand]
  );

  const moreItems = useMemo<MainNavItem[]>(
    () => [
      {
        id: "missions",
        label: "Goals",
        href: hasActiveBrand ? `${brandRoot}/missions` : "/brands",
        icon: Sparkles,
      },
      { id: "campaigns", label: "Outbound", href: hasActiveBrand ? `${brandRoot}/campaigns` : "/brands", icon: FolderKanban },
      { id: "experiments", label: "Tests", href: hasActiveBrand ? `${brandRoot}/experiments` : "/brands", icon: Activity },
      {
        id: "social-discovery",
        label: "Social",
        href: hasActiveBrand ? `${brandRoot}/social-discovery` : "/brands",
        icon: Radar,
      },
    ],
    [brandRoot, hasActiveBrand]
  );

  const activeMainItem = useMemo(() => {
    if (hasActiveBrand) {
      if (pathname === brandRoot) return "agent";
      if (pathname === `${brandRoot}/send` || pathname.startsWith(`${brandRoot}/send/`)) return "send";
      if (pathname === `${brandRoot}/missions` || pathname.startsWith(`${brandRoot}/missions/`)) return "missions";
      if (pathname === `${brandRoot}/campaigns` || pathname.startsWith(`${brandRoot}/campaigns/`)) return "campaigns";
      if (pathname === `${brandRoot}/experiments` || pathname.startsWith(`${brandRoot}/experiments/`)) return "experiments";
      if (pathname === `${brandRoot}/network` || pathname.startsWith(`${brandRoot}/network/`)) return "network";
      if (pathname === `${brandRoot}/leads` || pathname.startsWith(`${brandRoot}/leads/`)) return "leads";
      if (pathname === `${brandRoot}/inbox` || pathname.startsWith(`${brandRoot}/inbox/`)) return "inbox";
      if (pathname === `${brandRoot}/social-discovery` || pathname.startsWith(`${brandRoot}/social-discovery/`)) return "social-discovery";
    }
    return "";
  }, [pathname, brandRoot, hasActiveBrand]);

  const moreActive = moreItems.some((item) => item.id === activeMainItem);
  const agentHomeActive = activeMainItem === "agent";

  const toolItems: NavItem[] = [
    { label: "Settings", href: "/settings/outreach", icon: Settings },
    { label: "Diagnostics", href: "/doctor", icon: FlaskConical },
    { label: "Logic", href: "/logic", icon: Activity },
  ];
  const toolActive = toolItems.some((item) => pathname === item.href);

  if (chromeless) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[320px_1fr]">
        <aside
          className={cn(
            "min-w-0 border-b border-[color:var(--border)] bg-[color:var(--sidebar)] px-3 py-3 md:border-b-0 md:border-r",
            agentHomeActive ? "hidden md:block" : ""
          )}
        >
          <div className="flex h-full min-w-0 flex-col">
            <Link
              href="/"
              className="flex h-10 items-center justify-between rounded-[10px] px-2.5 text-[1.3rem] font-semibold text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
            >
              LastB2B
              <PanelLeft className="h-4 w-4 text-[color:var(--muted-foreground)]" />
            </Link>

            <div className="mt-4 min-w-0">
              <div className="mb-1 px-2.5 text-xs font-medium text-[color:var(--muted-foreground)]">Brand</div>
              <BrandSwitcher variant="chat" />
            </div>

            <div className="mt-5">
              <div className="mb-2 px-2.5 text-[12px] font-medium text-[color:var(--muted-foreground)]">Work</div>
              <nav className="grid gap-1">
                {mainItems.map((item) => {
                  const active = item.id === activeMainItem;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={cn(
                        "inline-flex w-full items-center justify-between gap-3 rounded-[10px] px-2.5 py-2.5 text-sm transition-colors duration-150",
                        active
                          ? "bg-[color:var(--surface-hover)] text-[color:var(--foreground)]"
                          : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
                      )}
                    >
                      <span className="inline-flex min-w-0 items-center gap-3">
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.id === "agent" ? <AttentionCount count={visibleOperatorAttentionCount} /> : null}
                    </Link>
                  );
                })}
              </nav>
              <details className="mt-2" open={moreActive || undefined}>
                <summary
                  className="cursor-pointer rounded-[10px] px-2.5 py-2 text-sm text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"
                >
                  More
                </summary>
                <nav className="mt-1 grid gap-1">
                  {moreItems.map((item) => {
                    const active = item.id === activeMainItem;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        className={cn(
                          "inline-flex items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-sm transition-colors duration-150",
                          active
                            ? "bg-[color:var(--surface-hover)] text-[color:var(--foreground)]"
                            : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </details>
            </div>

            <div className="mt-6 border-t border-[color:var(--border)] pt-5">
              <details open={toolActive || undefined}>
                <summary
                  className="cursor-pointer rounded-[10px] px-2.5 py-2 text-sm text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"
                >
                  System
                </summary>
                <nav className="mt-1 grid gap-1">
                  {toolItems.map((item) => {
                    const active = pathname === item.href;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "inline-flex items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-sm transition-colors duration-150",
                          active
                            ? "bg-[color:var(--surface-hover)] text-[color:var(--foreground)]"
                            : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </details>
            </div>

            <div className="mt-auto border-t border-[color:var(--border)] pt-3">
              <div className="flex items-center gap-3 rounded-[12px] px-2.5 py-2 text-sm text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent)] text-xs font-medium text-[color:var(--accent-foreground)]">
                  LB
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">LastB2B</div>
                  <div className="truncate text-xs text-[color:var(--muted-foreground)]">Growth workspace</div>
                </div>
              </div>
            </div>

          </div>
        </aside>

        <main className={cn("min-w-0", agentHomeActive ? "min-h-screen" : "")}>
          {!agentHomeActive ? (
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
                    Brand GPT
                    <AttentionCount count={visibleOperatorAttentionCount} />
                  </button>
                </div>
              </div>
            </header>
          ) : null}
          <div className={agentHomeActive ? "min-h-screen" : "p-4 md:px-8 md:py-7"}>{children}</div>
        </main>
      </div>
      <OperatorPanel
        open={operatorOpen}
        onOpenChange={setOperatorOpen}
        activeBrandId={activeBrandId}
        activeBrandName={activeBrandName}
        initialRequest={operatorRequest}
      />
    </div>
  );
}
