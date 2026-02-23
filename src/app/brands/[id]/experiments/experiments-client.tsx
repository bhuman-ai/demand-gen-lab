"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Plus, Trash2 } from "lucide-react";
import {
  createExperimentApi,
  deleteExperimentApi,
  fetchBrand,
  fetchExperiments,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, ExperimentRecord } from "@/lib/factory-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function statusVariant(status: ExperimentRecord["status"]) {
  if (status === "running") return "accent" as const;
  if (status === "completed" || status === "promoted") return "success" as const;
  if (status === "paused") return "danger" as const;
  return "muted" as const;
}

export default function ExperimentsClient({ brandId }: { brandId: string }) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    const [brandRow, experimentRows] = await Promise.all([
      fetchBrand(brandId),
      fetchExperiments(brandId),
    ]);
    setBrand(brandRow);
    setExperiments(experimentRows);
    localStorage.setItem("factory.activeBrandId", brandId);
  };

  useEffect(() => {
    let mounted = true;
    setError("");
    void refresh().catch((err: unknown) => {
      if (!mounted) return;
      setError(err instanceof Error ? err.message : "Failed to load experiments");
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  const promotedCount = useMemo(
    () => experiments.filter((row) => row.status === "promoted").length,
    [experiments]
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{brand?.name || "Brand"} Experiments</CardTitle>
          <CardDescription>
            One experiment = one audience + one offer + one flow + one test envelope.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Input
            placeholder="Experiment name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                const created = await createExperimentApi(brandId, {
                  name: name.trim() || `Experiment ${experiments.length + 1}`,
                });
                trackEvent("experiment_created", { brandId, experimentId: created.id });
                setName("");
                await refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to create experiment");
              } finally {
                setSaving(false);
              }
            }}
          >
            <Plus className="h-4 w-4" />
            {saving ? "Creating..." : "Create Experiment"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total Experiments</CardDescription>
            <CardTitle>{experiments.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Running</CardDescription>
            <CardTitle>{experiments.filter((row) => row.status === "running").length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Promoted</CardDescription>
            <CardTitle>{promotedCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      {experiments.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {experiments.map((experiment) => (
            <Card key={experiment.id}>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{experiment.name}</CardTitle>
                  <Badge variant={statusVariant(experiment.status)}>{experiment.status}</Badge>
                </div>
                <CardDescription>
                  {experiment.offer || "No offer yet"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  Audience: {experiment.audience || "Not set"}
                </div>
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  Sent {experiment.metricsSummary.sent} · Replies {experiment.metricsSummary.replies} · Positive {experiment.metricsSummary.positiveReplies}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" asChild>
                    <Link href={`/brands/${brandId}/experiments/${experiment.id}`}>Open Experiment</Link>
                  </Button>
                  {experiment.promotedCampaignId ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/brands/${brandId}/campaigns/${experiment.promotedCampaignId}`}>Open Campaign</Link>
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!window.confirm("Delete this experiment?")) return;
                      await deleteExperimentApi(brandId, experiment.id);
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
      ) : (
        <Card>
          <CardContent className="py-10 text-sm text-[color:var(--muted-foreground)]">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4" />
              No experiments yet. Create one to start testing.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
