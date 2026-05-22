import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import BrandWordmark from "@/components/layout/brand-wordmark";
import { Button } from "@/components/ui/button";
import { resolveEnrichAnythingAppUrl } from "@/lib/enrichanything-app-url";

export const metadata: Metadata = {
  title: "Lead Finder",
  description: "Run the EnrichAnything sales-nav finder against the configured live data source.",
};

function buildLeadFinderUrl(baseUrl: string) {
  if (!baseUrl) return "";

  try {
    const url = new URL(baseUrl);
    const pathname = url.pathname.replace(/\/+$/, "");
    url.pathname = `${pathname || ""}/tables/new`;
    url.searchParams.set("layout", "sales-nav");
    return url.toString();
  } catch {
    return "";
  }
}

export default function LeadFinderPage() {
  const appUrl = resolveEnrichAnythingAppUrl();
  const iframeUrl = buildLeadFinderUrl(appUrl);

  return (
    <main className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="border-b border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 px-4 py-3 md:px-6">
          <Link href="/workspace" className="group inline-flex" aria-label="Open last b2b workspace">
            <BrandWordmark
              showTrail={false}
              lastClassName="text-[1.85rem]"
              b2bClassName="mb-[0.26em] text-[0.72rem] tracking-[0.08em] transition-colors group-hover:text-[color:var(--foreground)]"
            />
          </Link>

          <div className="flex items-center gap-2">
            {iframeUrl ? (
              <Button asChild variant="outline" size="sm">
                <a href={iframeUrl} target="_blank" rel="noreferrer">
                  Open standalone
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto flex min-h-[calc(100vh-61px)] w-full max-w-[1600px] flex-col px-4 py-4 md:px-6 md:py-5">
        {iframeUrl ? (
          <div className="flex min-h-[720px] flex-1 overflow-hidden rounded-[12px] border border-[color:var(--border)] bg-white">
            <iframe
              title="Lead finder"
              src={iframeUrl}
              className="min-h-[calc(100vh-110px)] w-full border-0 bg-white"
            />
          </div>
        ) : (
          <div className="flex min-h-[420px] items-center justify-center rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
            <div className="max-w-lg text-sm leading-6 text-[color:var(--muted-foreground)]">
              Set <code className="rounded bg-[color:var(--surface-muted)] px-1.5 py-0.5 text-[color:var(--foreground)]">ENRICHANYTHING_APP_URL</code>{" "}
              on this deployment so `/lead-finder` can load the live finder.
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
