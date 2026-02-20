"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FlaskConical,
  Inbox,
  LayoutGrid,
  Mail,
  Network,
  Settings,
  Target,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/telemetry-client";
import BrandSwitcher, { getActiveBrandIdFromPath } from "./brand-switcher";
import { CampaignStepper } from "./campaign-stepper";
import ThemeToggle from "./theme-toggle";

const ACTIVE_BRAND_KEY = "factory.activeBrandId";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

function pageTitle(pathname: string) {
  if (pathname === "/") return "Launcher";
  if (pathname === "/brands") return "Brands";
  if (pathname === "/brands/new") return "New Brand";
  if (pathname.endsWith("/campaigns")) return "Campaigns";
  if (pathname.includes("/campaigns/") && pathname.endsWith("/build")) return "Campaign Build";
  if (pathname.includes("/campaigns/") && pathname.endsWith("/run")) return "Campaign Run";
  if (pathname.includes("/campaigns/") && pathname.endsWith("/run/overview")) return "Run Overview";
  if (pathname.includes("/campaigns/") && pathname.endsWith("/run/variants")) return "Run Variants";
  if (pathname.includes("/campaigns/") && pathname.endsWith("/run/leads")) return "Run Leads";
  if (pathname.includes("/campaigns/") && pathname.endsWith("/run/inbox")) return "Run Inbox";
  if (pathname.includes("/campaigns/") && pathname.endsWith("/run/insights")) return "Run Insights";
  if (pathname.endsWith("/network")) return "Network";
  if (pathname.endsWith("/leads")) return "Leads";
  if (pathname.endsWith("/inbox")) return "Inbox";
  if (pathname === "/logic") return "Logic";
  if (pathname === "/doctor") return "Doctor";
  if (pathname === "/settings/outreach") return "Outreach Settings";
  return "Factory";
}

function breadcrumb(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return "Factory";
  if (parts[0] !== "brands") return `Factory > ${parts[0]}`;
  const normalized = ["Factory", "Brand"];
  if (parts[2] === "campaigns") {
    normalized.push("Campaigns");
    if (parts[3]) normalized.push("Campaign");
    if (parts[4]) normalized.push(parts[4][0].toUpperCase() + parts[4].slice(1));
    if (parts[4] === "run" && parts[5]) {
      normalized.push(parts[5][0].toUpperCase() + parts[5].slice(1));
    }
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

  const mainItems = useMemo<NavItem[]>(
    () => [
      { label: "Brand", href: brandRoot, icon: LayoutGrid },
      { label: "Campaigns", href: hasActiveBrand ? `${brandRoot}/campaigns` : "/brands", icon: Target },
      { label: "Network", href: hasActiveBrand ? `${brandRoot}/network` : "/brands", icon: Network },
      { label: "Leads", href: hasActiveBrand ? `${brandRoot}/leads` : "/brands", icon: Mail },
      { label: "Inbox", href: hasActiveBrand ? `${brandRoot}/inbox` : "/brands", icon: Inbox },
    ],
    [brandRoot, hasActiveBrand]
  );

  const toolItems: NavItem[] = [
    { label: "Settings", href: "/settings/outreach", icon: Settings },
    { label: "Logic", href: "/logic", icon: Activity },
    { label: "Doctor", href: "/doctor", icon: FlaskConical },
  ];

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[260px_1fr]">
        <aside className="border-b border-[color:var(--border)] bg-[color:var(--sidebar)] p-4 md:border-b-0 md:border-r md:p-5">
          <Link href="/" className="block">
            <div className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--muted-foreground)]">Factory</div>
            <div className="mt-1 text-lg font-semibold">Brand Command</div>
          </Link>

          <nav className="mt-6 grid gap-1">
            {mainItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
                    active
                      ? "bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
                      : "text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-6 border-t border-[color:var(--border)] pt-5">
            <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">Tools</div>
            <nav className="grid gap-1">
              {toolItems.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
                      active
                        ? "bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
                        : "text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-[color:var(--border)] bg-[color:var(--surface)]/95 px-4 py-3 backdrop-blur md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-[color:var(--muted-foreground)]">{breadcrumb(pathname)}</div>
                <h1 className="text-lg font-semibold text-[color:var(--foreground)]">{pageTitle(pathname)}</h1>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/settings/outreach"
                  className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--border)] px-2 py-1 text-xs text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </Link>
                <BrandSwitcher />
                <ThemeToggle />
              </div>
            </div>
            <div className="mt-3">
              <CampaignStepper />
            </div>
          </header>
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
