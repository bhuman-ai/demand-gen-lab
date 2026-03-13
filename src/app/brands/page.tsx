"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { fetchBrands, deleteBrandApi } from "@/lib/client-api";
import type { BrandRecord } from "@/lib/factory-types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState, PageIntro, SectionPanel, StatLedger } from "@/components/ui/page-layout";

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

export default function BrandsPage() {
  const [brands, setBrands] = useState<BrandRecord[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const rows = await fetchBrands();
      setBrands(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load brands");
    }
  };

  useEffect(() => {
    let mounted = true;
    void fetchBrands()
      .then((rows) => {
        if (mounted) setBrands(rows);
      })
      .catch((err: unknown) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load brands");
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return brands;
    return brands.filter((brand) => [brand.name, brand.website, brand.tone].join(" ").toLowerCase().includes(needle));
  }, [brands, query]);

  const withTone = brands.filter((brand) => brand.tone?.trim()).length;
  const withNotes = brands.filter((brand) => brand.notes?.trim()).length;

  return (
    <div className="space-y-8">
      <PageIntro
        eyebrow="Brand directory"
        title="Every brand, sequence, and operating note in one cabinet."
        description="Choose a brand to open campaigns, network, leads, inbox, and experiments without losing the thread between them."
        actions={
          <>
            <Button asChild>
              <Link href="/brands/new">
                <Plus className="h-4 w-4" />
                New brand
              </Link>
            </Button>
            <div className="relative min-w-[18rem] max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[color:var(--muted-foreground)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search brands"
                className="pl-9"
              />
            </div>
          </>
        }
        aside={
          <StatLedger
            items={[
              {
                label: "Brands",
                value: formatCount(brands.length),
                detail: brands.length ? `${brands[0]?.name ?? "Brand"}${brands.length > 1 ? ` +${brands.length - 1} more` : ""}` : "No brands yet",
              },
              {
                label: "With tone",
                value: formatCount(withTone),
                detail: withTone ? "Brand voice has been captured." : "Tone is still undefined across the directory.",
              },
              {
                label: "With notes",
                value: formatCount(withNotes),
                detail: withNotes ? "Brand context and proof are recorded." : "Proof and operating notes still need to be written.",
              },
            ]}
          />
        }
      />

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <SectionPanel
        title="Brands"
        description="Open the working brand, jump directly to campaigns, or remove a workspace that should not live here anymore."
      >
        <div className="grid gap-3">
          {filtered.map((brand) => (
            <div
              key={brand.id}
              className="grid gap-4 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_auto]"
            >
              <div className="min-w-0">
                <div className="text-lg font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">{brand.name}</div>
                <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">{brand.website || "No website yet"}</div>
              </div>
              <div className="grid gap-1 text-sm">
                <div className="text-[color:var(--muted-foreground)]">Tone</div>
                <div className="text-[color:var(--foreground)]">{brand.tone || "Not set"}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <Button size="sm" asChild>
                  <Link href={`/brands/${brand.id}`}>Open</Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/brands/${brand.id}/campaigns`}>Campaigns</Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!window.confirm("Delete this brand and all campaigns?")) return;
                    await deleteBrandApi(brand.id);
                    await refresh();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SectionPanel>

      {!filtered.length ? (
        <EmptyState
          title="No brands found."
          description="Create a brand to start the outbound workflow, or adjust the search if this directory should already contain one."
          actions={
            <Link href="/brands/new">
              <Button>
                <Plus className="h-4 w-4" />
                Create brand
              </Button>
            </Link>
          }
        />
      ) : null}
    </div>
  );
}
