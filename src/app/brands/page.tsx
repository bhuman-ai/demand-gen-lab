"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { fetchBrands, deleteBrandApi } from "@/lib/client-api";
import type { BrandRecord } from "@/lib/factory-types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Brand Directory</CardTitle>
            <CardDescription>Choose a brand to open campaigns, network, leads, and inbox.</CardDescription>
          </div>
          <Button asChild>
            <Link href="/brands/new">
              <Plus className="h-4 w-4" />
              New Brand
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[color:var(--muted-foreground)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search brands"
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((brand) => (
          <Card key={brand.id}>
            <CardHeader>
              <CardTitle className="text-base">{brand.name}</CardTitle>
              <CardDescription>{brand.website}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-[color:var(--muted-foreground)]">Tone: {brand.tone || "Not set"}</div>
              <div className="flex flex-wrap gap-2">
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
            </CardContent>
          </Card>
        ))}
      </div>

      {!filtered.length ? (
        <Card>
          <CardContent className="py-8 text-sm text-[color:var(--muted-foreground)]">
            No brands found. Create a new brand to start the campaign workflow.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
