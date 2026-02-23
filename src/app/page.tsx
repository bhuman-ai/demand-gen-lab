"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Rocket, Target } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchBrands, fetchExperiments, fetchScaleCampaigns } from "@/lib/client-api";
import type { BrandRecord } from "@/lib/factory-types";

export default function HomePage() {
  const [brands, setBrands] = useState<BrandRecord[]>([]);
  const [experimentCount, setExperimentCount] = useState(0);
  const [campaignCount, setCampaignCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const brandRows = await fetchBrands();
        if (!mounted) return;
        setBrands(brandRows);

        const [experimentCounts, campaignCounts] = await Promise.all([
          Promise.all(brandRows.map((row) => fetchExperiments(row.id))),
          Promise.all(brandRows.map((row) => fetchScaleCampaigns(row.id))),
        ]);
        if (!mounted) return;
        setExperimentCount(experimentCounts.reduce((sum, rows) => sum + rows.length, 0));
        setCampaignCount(campaignCounts.reduce((sum, rows) => sum + rows.length, 0));
      } catch {
        if (mounted) {
          setBrands([]);
          setExperimentCount(0);
          setCampaignCount(0);
        }
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader>
          <Badge variant="accent" className="w-fit">
            Brand-first Flow
          </Badge>
          <CardTitle className="mt-2 text-2xl">Test Experiments, Then Scale Campaigns</CardTitle>
          <CardDescription>
            Run experiment-first outreach tests, then manually promote winners into scale campaigns.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/brands/new">
              <Rocket className="h-4 w-4" />
              Create Brand
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/brands">
              <Target className="h-4 w-4" />
              Open Brand Directory
            </Link>
          </Button>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Brands</CardDescription>
            <CardTitle>{brands.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Experiments</CardDescription>
            <CardTitle>{experimentCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Campaigns</CardDescription>
            <CardTitle>{campaignCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Next Action</CardDescription>
            <CardTitle className="text-base font-medium">
              {brands.length ? "Open active brand and continue an experiment" : "Create your first brand"}
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Primary Journey</CardTitle>
          <CardDescription>Designed for solo operators: test first, scale second.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
          {["Create Brand", "Create Experiment", "Launch Test", "Promote to Campaign", "Scale"].map(
            (step, index) => (
              <div key={step} className="inline-flex items-center gap-2">
                <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-1.5">
                  {step}
                </span>
                {index < 4 ? <ArrowRight className="h-3.5 w-3.5" /> : null}
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
