"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CircleUserRound,
  FolderKanban,
  FlaskConical,
  Inbox,
  Mail,
  Network,
  Settings,
  Target,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/telemetry-client";
import BrandSwitcher, { getActiveBrandIdFromPath } from "./brand-switcher";
import GlobalCommandPalette from "./global-command-palette";

const ACTIVE_BRAND_KEY = "factory.activeBrandId";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

type MainNavItem = NavItem & {
  id: "experiments" | "campaigns" | "network" | "leads" | "inbox";
};

function pageTitle(pathname: string) {
  if (pathname === "/") return "Desk";
  if (pathname === "/brands") return "Brands";
  if (pathname === "/brands/new") return "New Brand";
  if (pathname.endsWith("/experiments/suggestions")) return "Experiment Suggestions";
  if (pathname.endsWith("/experiments")) return "Experiments";
  if (pathname.includes("/experiments/") && pathname.endsWith("/setup")) return "Experiment Setup";
  if (pathname.includes("/experiments/") && pathname.endsWith("/prospects")) return "Prospects";
  if (pathname.includes("/experiments/") && pathname.endsWith("/messaging")) return "Messaging";
  if (pathname.includes("/experiments/") && pathname.endsWith("/launch")) return "Launch";
  if (pathname.includes("/experiments/") && pathname.endsWith("/run")) return "Run Dashboard";
  if (pathname.includes("/experiments/") && pathname.endsWith("/flow")) return "Messaging";
  if (pathname.includes("/experiments/")) return "Experiment";
  if (pathname.endsWith("/campaigns")) return "Campaigns";
  if (pathname.includes("/campaigns/")) return "Campaign";
  if (pathname.endsWith("/network")) return "Network";
  if (pathname.endsWith("/leads")) return "Leads";
  if (pathname.endsWith("/inbox")) return "Inbox";
  if (pathname === "/logic") return "Logic";
  if (pathname === "/doctor") return "Doctor";
  if (pathname === "/settings/outreach") return "Outreach Settings";
  return "lastb2b.com";
}

function breadcrumb(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return "lastb2b.com";
  if (parts[0] !== "brands") return `lastb2b.com / ${parts[0]}`;
  const normalized = ["lastb2b.com", "Brand"];
  if (parts[2] === "experiments") {
    normalized.push("Experiments");
    if (parts[3] === "suggestions") {
      normalized.push("Suggestions");
      return normalized.join(" > ");
    }
    if (parts[3]) normalized.push("Experiment");
    if (parts[4]) {
      normalized.push(parts[4][0].toUpperCase() + parts[4].slice(1));
    }
    return normalized.join(" > ");
  }
  if (parts[2] === "campaigns") {
    normalized.push("Campaigns");
    if (parts[3]) normalized.push("Campaign");
    return normalized.join(" > ");
  }
  if (parts[2]) {
    normalized.push(parts[2][0].toUpperCase() + parts[2].slice(1));
  }
  return normalized.join(" > ");
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const pathBrandId = getActiveBrandIdFromPath(pathname);
  const storedBrandId =
    typeof window !== "undefined" ? localStorage.getItem(ACTIVE_BRAND_KEY) || "" : "";
  const activeBrandId = pathBrandId || storedBrandId;

  useEffect(() => {
    if (pathBrandId) {
      localStorage.setItem(ACTIVE_BRAND_KEY, pathBrandId);
    }
  }, [pathBrandId]);

  useEffect(() => {
    const previous = sessionStorage.getItem("factory.previousPath");
    const beforePrevious = sessionStorage.getItem("factory.beforePreviousPath");
    if (beforePrevious && pathname === beforePrevious && previous && previous !== pathname) {
      trackEvent("nav_backtrack", { from: previous, to: pathname });
    }
    sessionStorage.setItem("factory.beforePreviousPath", previous || "");
    sessionStorage.setItem("factory.previousPath", pathname);
  }, [pathname]);

  const hasActiveBrand = Boolean(activeBrandId);
  const brandRoot = hasActiveBrand ? `/brands/${activeBrandId}` : "/brands";

  const mainItems = useMemo<MainNavItem[]>(
    () => [
      { id: "experiments", label: "Experiments", href: hasActiveBrand ? `${brandRoot}/experiments` : "/brands", icon: Target },
      { id: "campaigns", label: "Campaigns", href: hasActiveBrand ? `${brandRoot}/campaigns` : "/brands", icon: FolderKanban },
      { id: "network", label: "Network", href: hasActiveBrand ? `${brandRoot}/network` : "/brands", icon: Network },
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

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[248px_1fr]">
        <aside className="border-b border-[color:var(--border)] bg-[color:var(--sidebar)] px-4 py-5 md:border-b-0 md:border-r md:px-5">
          <div className="flex h-full flex-col">
            <Link href="/" className="block border-b border-[color:var(--border)] pb-5">
              <div className="font-[family:var(--font-brand)] text-[1.65rem] leading-none tracking-[-0.07em] text-[color:var(--foreground)]">
                lastb2b.com
              </div>
              <p className="mt-2 max-w-[15rem] text-[13px] leading-5 text-[color:var(--muted-foreground)]">
                The last B2B outreach product you&apos;ll ever buy.
              </p>
            </Link>

            <div className="mt-5">
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
                        "inline-flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-sm transition-colors",
                        active
                          ? "border-[color:var(--border-strong)] bg-[color:var(--surface)] text-[color:var(--foreground)]"
                          : "border-transparent text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface)] hover:text-[color:var(--foreground)]"
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
                        "inline-flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-sm transition-colors",
                        active
                          ? "border-[color:var(--border-strong)] bg-[color:var(--surface)] text-[color:var(--foreground)]"
                          : "border-transparent text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface)] hover:text-[color:var(--foreground)]"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="mt-auto hidden border-t border-[color:var(--border)] pt-5 text-[13px] leading-5 text-[color:var(--muted-foreground)] md:block">
              Proof before scale. Keep the sender, message, and reply trail in one place.
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-[color:var(--border)] bg-[color:var(--background)]/96 px-4 py-4 backdrop-blur-sm md:px-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-[260px]">
                <div className="text-[12px] text-[color:var(--muted-foreground)]">{breadcrumb(pathname)}</div>
                <h1 className="mt-2 text-[clamp(1.55rem,2.2vw,2.25rem)] leading-none tracking-[-0.05em] text-[color:var(--foreground)]">
                  {pageTitle(pathname)}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <GlobalCommandPalette activeBrandId={activeBrandId} />
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[color:var(--border)] px-3 text-sm text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--surface)] hover:text-[color:var(--foreground)]"
                >
                  <CircleUserRound className="h-3.5 w-3.5" />
                  Operator
                </button>
              </div>
            </div>
          </header>
          <div className="p-4 md:px-8 md:py-7">{children}</div>
        </main>
      </div>
    </div>
  );
}
