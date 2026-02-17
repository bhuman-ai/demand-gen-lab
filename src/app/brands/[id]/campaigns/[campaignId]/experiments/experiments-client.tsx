"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Pause, Play, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  completeStepState,
  fetchBrand,
  fetchCampaign,
  fetchCampaignRuns,
  suggestExperimentsApi,
  launchExperimentRun,
  pauseRun,
  resumeRun,
  updateCampaignApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type {
  BrandRecord,
  CampaignRecord,
  Experiment,
  OutreachRun,
  RunAnomaly,
} from "@/lib/factory-types";

const makeId = () => `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const defaultRunPolicy = {
  cadence: "3_step_7_day" as const,
  dailyCap: 30,
  hourlyCap: 6,
  timezone: "America/Los_Angeles",
  minSpacingMinutes: 8,
};

const RUN_PAUSABLE_STATUSES: OutreachRun["status"][] = [
  "queued",
  "sourcing",
  "scheduled",
  "sending",
  "monitoring",
];

function runStatusVariant(status: OutreachRun["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "paused" || status === "failed" || status === "preflight_failed" || status === "canceled") {
    return "danger" as const;
  }
  return "muted" as const;
}

function friendlyRunLaunchError(error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to launch run";
  if (message.includes("Lead sourcing is not enabled for this workspace")) {
    return "Run did not start: platform lead sourcing is not configured in this deployment yet.";
  }
  if (message.includes("Lead sourcing credentials are missing")) {
    return "Run did not start: platform lead sourcing credentials are missing in this deployment.";
  }
  return message;
}

export default function ExperimentsClient({ brandId, campaignId }: { brandId: string; campaignId: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [suggestions, setSuggestions] = useState<Array<Omit<Experiment, "id">>>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsLoadedOnce, setSuggestionsLoadedOnce] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState("");
  const [runs, setRuns] = useState<OutreachRun[]>([]);
  const [anomalies, setAnomalies] = useState<RunAnomaly[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refreshRuns = async () => {
    const runRows = await fetchCampaignRuns(brandId, campaignId);
    setRuns(runRows.runs);
    setAnomalies(runRows.anomalies);
  };

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      fetchBrand(brandId),
      fetchCampaign(brandId, campaignId),
      fetchCampaignRuns(brandId, campaignId),
    ])
      .then(([brandRow, campaignRow, runRows]) => {
        if (!mounted) return;
        setBrand(brandRow);
        setCampaign(campaignRow);
        setExperiments(campaignRow.experiments);
        setRuns(runRows.runs);
        setAnomalies(runRows.anomalies);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load experiments");
      });
    return () => {
      mounted = false;
    };
  }, [brandId, campaignId]);

  useEffect(() => {
    trackEvent("campaign_step_viewed", { brandId, campaignId, step: "experiments" });
  }, [brandId, campaignId]);

  const hypotheses = useMemo(() => campaign?.hypotheses ?? [], [campaign]);

  const loadSuggestions = async () => {
    if (!campaign || !campaign.hypotheses.length) {
      setSuggestionsError("Add hypotheses before generating experiments.");
      return;
    }
    setSuggestionsLoading(true);
    setSuggestionsError("");
    try {
      const rows = await suggestExperimentsApi(brandId, campaignId);
      setSuggestions(rows);
    } catch (err) {
      trackEvent("generation_error", { brandId, campaignId, step: "experiments" });
      setSuggestionsError(err instanceof Error ? err.message : "Failed to load suggestions");
    } finally {
      setSuggestionsLoading(false);
      setSuggestionsLoadedOnce(true);
    }
  };

  useEffect(() => {
    if (!campaign) return;
    if (!campaign.hypotheses.length) return;
    if (suggestionsLoadedOnce) return;
    void loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, suggestionsLoadedOnce, brandId, campaignId]);

  if (!campaign) {
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading experiments...</div>;
  }

  const save = async (completeStep: boolean) => {
    setSaving(true);
    setError("");
    try {
      const next = await updateCampaignApi(brandId, campaignId, {
        experiments,
        stepState: completeStep ? completeStepState("experiments", campaign.stepState) : campaign.stepState,
      });
      setCampaign(next);
      setExperiments(next.experiments);
      trackEvent("campaign_saved", { brandId, campaignId, step: "experiments" });
      if (completeStep) {
        trackEvent("campaign_step_completed", { brandId, campaignId, step: "experiments" });
        router.push(`/brands/${brandId}/campaigns/${campaignId}/evolution`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addFromSuggestion = (suggestion: Omit<Experiment, "id">) => {
    setExperiments((prev) => [
      {
        id: makeId(),
        hypothesisId: suggestion.hypothesisId,
        name: suggestion.name,
        notes: suggestion.notes,
        status: suggestion.status,
        runPolicy: suggestion.runPolicy ?? defaultRunPolicy,
        executionStatus: suggestion.executionStatus ?? "idle",
      },
      ...prev,
    ]);
  };

  const applyAllSuggestions = () => {
    setExperiments(
      suggestions.map((suggestion) => ({
        id: makeId(),
        hypothesisId: suggestion.hypothesisId,
        name: suggestion.name,
        notes: suggestion.notes,
        status: suggestion.status,
        runPolicy: suggestion.runPolicy ?? defaultRunPolicy,
        executionStatus: suggestion.executionStatus ?? "idle",
      }))
    );
  };

  const createBaselines = () => {
    if (!hypotheses.length) {
      setError("Add hypotheses before creating experiments.");
      return;
    }
    const normalized = hypotheses.map((hypothesis) => ({
      id: makeId(),
      hypothesisId: hypothesis.id,
      name: `Baseline: ${hypothesis.title}`.slice(0, 80),
      status: "draft" as const,
      notes: "",
      runPolicy: defaultRunPolicy,
      executionStatus: "idle" as const,
    }));
    setExperiments(normalized);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>
            {brand?.name} · {campaign.name}
          </CardTitle>
          <CardDescription>Step 3 of 4: build experiment variants and set run status.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={loadSuggestions} disabled={suggestionsLoading || !hypotheses.length}>
            <Sparkles className="h-4 w-4" />
            {suggestionsLoading ? "Generating..." : "Generate Variants"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setExperiments((prev) => [
                {
                  id: makeId(),
                  hypothesisId: hypotheses[0]?.id ?? "",
                  name: "Manual experiment",
                  status: "draft",
                  notes: "",
                  runPolicy: defaultRunPolicy,
                  executionStatus: "idle",
                },
                ...prev,
              ])
            }
          >
            <Plus className="h-4 w-4" /> Add Manual
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Suggestions</CardTitle>
          <CardDescription>
            Click a card to add it as a draft experiment. Variants are tailored to your hypotheses.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!hypotheses.length ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-sm">
              Add hypotheses first to generate experiment variants.
              <div className="mt-2">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/brands/${brandId}/campaigns/${campaignId}/hypotheses`}>Go to Hypotheses</Link>
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={loadSuggestions}
              disabled={suggestionsLoading || !hypotheses.length}
            >
              <Sparkles className="h-4 w-4" />
              {suggestionsLoading ? "Generating..." : suggestions.length ? "Refresh Suggestions" : "Generate Suggestions"}
            </Button>
            {suggestions.length ? (
              <Button type="button" size="sm" variant="outline" onClick={applyAllSuggestions} disabled={suggestionsLoading}>
                Use All (Replace List)
              </Button>
            ) : null}
          </div>

          {suggestionsError ? <div className="text-xs text-[color:var(--danger)]">{suggestionsError}</div> : null}
          {suggestionsLoading && !suggestions.length ? (
            <div className="text-xs text-[color:var(--muted-foreground)]">Generating experiment cards...</div>
          ) : null}

          {suggestions.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {suggestions.map((suggestion) => (
                <button
                  key={`${suggestion.hypothesisId}:${suggestion.name}`}
                  type="button"
                  className="group rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-left transition hover:bg-[color:var(--surface)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                  onClick={() => addFromSuggestion(suggestion)}
                >
                  <div className="text-sm font-semibold">{suggestion.name}</div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{suggestion.notes || "Draft notes"}</div>
                  <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                    Daily cap {suggestion.runPolicy?.dailyCap ?? 30} · Hourly cap {suggestion.runPolicy?.hourlyCap ?? 6} · Timezone {suggestion.runPolicy?.timezone ?? "America/Los_Angeles"}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <div className="grid gap-4">
        {experiments.map((experiment, index) => {
          const experimentRuns = runs.filter((run) => run.experimentId === experiment.id);
          return (
            <Card key={experiment.id}>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">Experiment {index + 1}</CardTitle>
                  <Badge variant={experiment.status === "scaling" ? "success" : "muted"}>{experiment.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor={`experiment-name-${index}`}>Name</Label>
                  <Input
                    id={`experiment-name-${index}`}
                    value={experiment.name}
                    onChange={(event) => {
                      const next = [...experiments];
                      next[index] = { ...next[index], name: event.target.value };
                      setExperiments(next);
                    }}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor={`experiment-hypothesis-${index}`}>Hypothesis</Label>
                    <Select
                      id={`experiment-hypothesis-${index}`}
                      value={experiment.hypothesisId}
                      onChange={(event) => {
                        const next = [...experiments];
                        next[index] = { ...next[index], hypothesisId: event.target.value };
                        setExperiments(next);
                      }}
                    >
                      <option value="">Unlinked</option>
                      {hypotheses.map((hypothesis) => (
                        <option key={hypothesis.id} value={hypothesis.id}>
                          {hypothesis.title}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`experiment-status-${index}`}>Status</Label>
                    <Select
                      id={`experiment-status-${index}`}
                      value={experiment.status}
                      onChange={(event) => {
                        const value = event.target.value as Experiment["status"];
                        const next = [...experiments];
                        next[index] = { ...next[index], status: value };
                        setExperiments(next);
                      }}
                    >
                      <option value="draft">Draft</option>
                      <option value="testing">Testing</option>
                      <option value="scaling">Scaling</option>
                      <option value="paused">Paused</option>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="grid gap-2">
                    <Label htmlFor={`experiment-daily-cap-${index}`}>Daily Cap</Label>
                    <Input
                      id={`experiment-daily-cap-${index}`}
                      type="number"
                      min={1}
                      value={experiment.runPolicy?.dailyCap ?? 30}
                      onChange={(event) => {
                        const next = [...experiments];
                        next[index] = {
                          ...next[index],
                          runPolicy: {
                            ...(next[index].runPolicy ?? defaultRunPolicy),
                            cadence: "3_step_7_day",
                            dailyCap: Number(event.target.value || 30),
                          },
                        };
                        setExperiments(next);
                      }}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`experiment-hourly-cap-${index}`}>Hourly Cap</Label>
                    <Input
                      id={`experiment-hourly-cap-${index}`}
                      type="number"
                      min={1}
                      value={experiment.runPolicy?.hourlyCap ?? 6}
                      onChange={(event) => {
                        const next = [...experiments];
                        next[index] = {
                          ...next[index],
                          runPolicy: {
                            ...(next[index].runPolicy ?? defaultRunPolicy),
                            cadence: "3_step_7_day",
                            hourlyCap: Number(event.target.value || 6),
                          },
                        };
                        setExperiments(next);
                      }}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`experiment-timezone-${index}`}>Timezone</Label>
                    <Input
                      id={`experiment-timezone-${index}`}
                      value={experiment.runPolicy?.timezone ?? "America/Los_Angeles"}
                      onChange={(event) => {
                        const next = [...experiments];
                        next[index] = {
                          ...next[index],
                          runPolicy: {
                            ...(next[index].runPolicy ?? defaultRunPolicy),
                            cadence: "3_step_7_day",
                            timezone: event.target.value || "America/Los_Angeles",
                          },
                        };
                        setExperiments(next);
                      }}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`experiment-spacing-${index}`}>Min Spacing (min)</Label>
                    <Input
                      id={`experiment-spacing-${index}`}
                      type="number"
                      min={1}
                      value={experiment.runPolicy?.minSpacingMinutes ?? 8}
                      onChange={(event) => {
                        const next = [...experiments];
                        next[index] = {
                          ...next[index],
                          runPolicy: {
                            ...(next[index].runPolicy ?? defaultRunPolicy),
                            cadence: "3_step_7_day",
                            minSpacingMinutes: Number(event.target.value || 8),
                          },
                        };
                        setExperiments(next);
                      }}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`experiment-notes-${index}`}>Notes</Label>
                  <Textarea
                    id={`experiment-notes-${index}`}
                    value={experiment.notes}
                    onChange={(event) => {
                      const next = [...experiments];
                      next[index] = { ...next[index], notes: event.target.value };
                      setExperiments(next);
                    }}
                  />
                </div>

                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-sm">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="font-medium">Autopilot Status</div>
                    <Badge variant={experiment.executionStatus === "paused" ? "danger" : "muted"}>
                      {experiment.executionStatus || "idle"}
                    </Badge>
                  </div>

                  {experimentRuns.map((run) => {
                    const runAnomalies = anomalies.filter(
                      (row) => row.runId === run.id && row.status === "active"
                    );
                    return (
                      <div
                        key={run.id}
                        className="mb-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-2 text-xs last:mb-0"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>Run {run.id.slice(-6)}</div>
                          <Badge
                            variant={runStatusVariant(run.status)}
                          >
                            {run.status}
                          </Badge>
                        </div>
                        <div className="mt-1 text-[color:var(--muted-foreground)]">
                          Leads {run.metrics.sourcedLeads} · Sent {run.metrics.sentMessages} · Replies {run.metrics.replies}
                        </div>
                        {run.lastError ? (
                          <div className="mt-1 text-[color:var(--danger)]">Reason: {run.lastError}</div>
                        ) : null}
                        {run.status === "preflight_failed" &&
                        run.lastError.includes("Lead sourcing is not enabled for this workspace") ? (
                          <div className="mt-1 rounded-md border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-2 py-1 text-[color:var(--danger)]">
                            Setup required: platform lead sourcing is not configured in this deployment yet.
                          </div>
                        ) : null}
                        {run.pauseReason ? (
                          <div className="mt-1 text-[color:var(--danger)]">Pause: {run.pauseReason}</div>
                        ) : null}
                        {runAnomalies.length ? (
                          <div className="mt-1 text-[color:var(--danger)]">
                            Active anomalies: {runAnomalies.map((item) => item.type).join(", ")}
                          </div>
                        ) : null}

                        <div className="mt-2 flex gap-2">
                          {run.status === "paused" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                await resumeRun(brandId, campaignId, run.id);
                                await refreshRuns();
                              }}
                            >
                              <Play className="h-3.5 w-3.5" />
                              Resume
                            </Button>
                          ) : RUN_PAUSABLE_STATUSES.includes(run.status) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                await pauseRun(brandId, campaignId, run.id, "Paused from experiments page");
                                await refreshRuns();
                              }}
                            >
                              <Pause className="h-3.5 w-3.5" />
                              Pause
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  <Button
                    type="button"
                    size="sm"
                    onClick={async () => {
                      setError("");
                      try {
                        await save(false);
                        await launchExperimentRun(brandId, campaignId, experiment.id);
                        trackEvent("run_started", { brandId, campaignId, experimentId: experiment.id });
                      } catch (err) {
                        setError(friendlyRunLaunchError(err));
                      } finally {
                        const refreshedCampaign = await fetchCampaign(brandId, campaignId);
                        setCampaign(refreshedCampaign);
                        setExperiments(refreshedCampaign.experiments);
                        await refreshRuns();
                      }
                    }}
                  >
                    Launch Autopilot Run
                  </Button>
                </div>

                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setExperiments((prev) => prev.filter((item) => item.id !== experiment.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {!experiments.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Start Here</CardTitle>
              <CardDescription>
                Experiments turn hypotheses into runnable variants. Launch runs only after you have delivery and reply accounts configured.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {!hypotheses.length ? (
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-sm">
                  No hypotheses yet. Add or generate hypotheses first.
                  <div className="mt-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/brands/${brandId}/campaigns/${campaignId}/hypotheses`}>Go to Hypotheses</Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" type="button" onClick={loadSuggestions} disabled={suggestionsLoading}>
                    <Sparkles className="h-4 w-4" />
                    {suggestionsLoading ? "Generating..." : "Generate Variants"}
                  </Button>
                  <Button size="sm" variant="outline" type="button" onClick={createBaselines}>
                    Create Baselines
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/brands/${brandId}`}>Check Brand Setup</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/settings/outreach">Outreach Settings</Link>
                  </Button>
                </div>
              )}
              <div className="text-xs text-[color:var(--muted-foreground)]">
                Tip: start with one hypothesis, two variants, and conservative caps. Scale only after you see positive replies.
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Button type="button" onClick={() => void save(false)} disabled={saving}>
            {saving ? "Saving..." : "Save Experiments"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void save(true)} disabled={saving || !experiments.length}>
            Save & Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button asChild variant="ghost">
            <Link href={`/brands/${brandId}/campaigns/${campaignId}/evolution`}>Skip to Evolution</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
