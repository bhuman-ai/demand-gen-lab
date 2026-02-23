"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Pause, Play, Rocket, Save, SquareArrowOutUpRight } from "lucide-react";
import {
  controlExperimentRunApi,
  fetchBrand,
  fetchExperiment,
  fetchExperimentRunView,
  launchExperimentTestApi,
  promoteExperimentApi,
  updateExperimentApi,
} from "@/lib/client-api";
import type { BrandRecord, ExperimentRecord, OutreachRun, RunViewModel } from "@/lib/factory-types";
import { trackEvent } from "@/lib/telemetry-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function runStatusVariant(status: OutreachRun["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "failed" || status === "preflight_failed" || status === "canceled") return "danger" as const;
  if (status === "paused") return "danger" as const;
  if (status === "sending" || status === "monitoring") return "accent" as const;
  return "muted" as const;
}

function canPause(status: OutreachRun["status"]) {
  return ["queued", "sourcing", "scheduled", "sending", "monitoring"].includes(status);
}

function canResume(status: OutreachRun["status"]) {
  return status === "paused";
}

function formatDate(value: string) {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function ExperimentClient({
  brandId,
  experimentId,
}: {
  brandId: string;
  experimentId: string;
}) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [experiment, setExperiment] = useState<ExperimentRecord | null>(null);
  const [runView, setRunView] = useState<RunViewModel | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState("");

  const refresh = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const [brandRow, experimentRow, runRow] = await Promise.all([
        fetchBrand(brandId),
        fetchExperiment(brandId, experimentId),
        fetchExperimentRunView(brandId, experimentId),
      ]);
      setBrand(brandRow);
      setExperiment(experimentRow);
      setRunView(runRow);
      localStorage.setItem("factory.activeBrandId", brandId);
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    setError("");
    void refresh()
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load experiment");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    trackEvent("experiment_viewed", { brandId, experimentId });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, experimentId]);

  const latestRun = useMemo(() => runView?.runs?.[0] ?? null, [runView]);
  const latestEvents = useMemo(
    () => (latestRun ? runView?.eventsByRun?.[latestRun.id] ?? [] : []),
    [latestRun, runView]
  );

  if (loading || !experiment || !runView) {
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading experiment...</div>;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{brand?.name || "Brand"} · {experiment.name}</CardTitle>
          <CardDescription>
            Experiment-first workflow: define what you are testing, then launch and inspect outcomes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="muted">Status: {experiment.status}</Badge>
          <Badge variant="muted">Sent: {experiment.metricsSummary.sent}</Badge>
          <Badge variant="muted">Replies: {experiment.metricsSummary.replies}</Badge>
          <Badge variant="muted">Positive: {experiment.metricsSummary.positiveReplies}</Badge>
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What we&apos;re testing</CardTitle>
          <CardDescription>One experiment should test one concrete audience and one concrete offer.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="experiment-name">Experiment Name</Label>
            <Input
              id="experiment-name"
              value={experiment.name}
              onChange={(event) =>
                setExperiment((prev) => (prev ? { ...prev, name: event.target.value } : prev))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="experiment-offer">Offer / Angle</Label>
            <Textarea
              id="experiment-offer"
              rows={3}
              value={experiment.offer}
              onChange={(event) =>
                setExperiment((prev) => (prev ? { ...prev, offer: event.target.value } : prev))
              }
              placeholder="What offer are we testing?"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="experiment-audience">Target Audience</Label>
            <Textarea
              id="experiment-audience"
              rows={3}
              value={experiment.audience}
              onChange={(event) =>
                setExperiment((prev) => (prev ? { ...prev, audience: event.target.value } : prev))
              }
              placeholder="Who should receive this outreach?"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Message flow</CardTitle>
          <CardDescription>A published revision is required before launch.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm">
            {experiment.messageFlow.publishedRevision > 0 ? (
              <span>
                Published revision <strong>#{experiment.messageFlow.publishedRevision}</strong>
              </span>
            ) : (
              <span className="text-[color:var(--danger)]">No published flow yet.</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/brands/${brandId}/experiments/${experiment.id}/flow`}>
                Open Flow Editor
                <SquareArrowOutUpRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test envelope</CardTitle>
          <CardDescription>Set sample size, duration, and conservative delivery caps.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-2">
            <Label>Lead sample size</Label>
            <Input
              type="number"
              min={1}
              value={experiment.testEnvelope.sampleSize}
              onChange={(event) =>
                setExperiment((prev) =>
                  prev
                    ? {
                        ...prev,
                        testEnvelope: {
                          ...prev.testEnvelope,
                          sampleSize: Math.max(1, Number(event.target.value || 1)),
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Duration days</Label>
            <Input
              type="number"
              min={1}
              value={experiment.testEnvelope.durationDays}
              onChange={(event) =>
                setExperiment((prev) =>
                  prev
                    ? {
                        ...prev,
                        testEnvelope: {
                          ...prev.testEnvelope,
                          durationDays: Math.max(1, Number(event.target.value || 1)),
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Timezone</Label>
            <Input
              value={experiment.testEnvelope.timezone}
              onChange={(event) =>
                setExperiment((prev) =>
                  prev
                    ? {
                        ...prev,
                        testEnvelope: {
                          ...prev.testEnvelope,
                          timezone: event.target.value,
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Daily cap</Label>
            <Input
              type="number"
              min={1}
              value={experiment.testEnvelope.dailyCap}
              onChange={(event) =>
                setExperiment((prev) =>
                  prev
                    ? {
                        ...prev,
                        testEnvelope: {
                          ...prev.testEnvelope,
                          dailyCap: Math.max(1, Number(event.target.value || 1)),
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Hourly cap</Label>
            <Input
              type="number"
              min={1}
              value={experiment.testEnvelope.hourlyCap}
              onChange={(event) =>
                setExperiment((prev) =>
                  prev
                    ? {
                        ...prev,
                        testEnvelope: {
                          ...prev.testEnvelope,
                          hourlyCap: Math.max(1, Number(event.target.value || 1)),
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Min spacing (minutes)</Label>
            <Input
              type="number"
              min={1}
              value={experiment.testEnvelope.minSpacingMinutes}
              onChange={(event) =>
                setExperiment((prev) =>
                  prev
                    ? {
                        ...prev,
                        testEnvelope: {
                          ...prev.testEnvelope,
                          minSpacingMinutes: Math.max(1, Number(event.target.value || 1)),
                        },
                      }
                    : prev
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions</CardTitle>
          <CardDescription>Save changes, launch a test run, or promote to a scale campaign.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                const saved = await updateExperimentApi(brandId, experiment.id, {
                  name: experiment.name,
                  offer: experiment.offer,
                  audience: experiment.audience,
                  testEnvelope: experiment.testEnvelope,
                  successMetric: experiment.successMetric,
                });
                setExperiment(saved);
                trackEvent("experiment_saved", { brandId, experimentId: experiment.id });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to save experiment");
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Experiment"}
          </Button>
          <Button
            type="button"
            disabled={launching}
            onClick={async () => {
              setLaunching(true);
              setError("");
              try {
                await updateExperimentApi(brandId, experiment.id, {
                  name: experiment.name,
                  offer: experiment.offer,
                  audience: experiment.audience,
                  testEnvelope: experiment.testEnvelope,
                  successMetric: experiment.successMetric,
                });
                const result = await launchExperimentTestApi(brandId, experiment.id);
                trackEvent("experiment_launched", {
                  brandId,
                  experimentId: experiment.id,
                  runId: result.runId,
                });
                await refresh(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to launch test");
              } finally {
                setLaunching(false);
              }
            }}
          >
            <Rocket className="h-4 w-4" />
            {launching ? "Launching..." : "Launch Test"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={promoting || runView.runs.length === 0 || Boolean(experiment.promotedCampaignId)}
            onClick={async () => {
              setPromoting(true);
              setError("");
              try {
                const campaign = await promoteExperimentApi(brandId, experiment.id);
                trackEvent("experiment_promoted_manual", {
                  brandId,
                  experimentId: experiment.id,
                  campaignId: campaign.id,
                });
                await refresh(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to promote experiment");
              } finally {
                setPromoting(false);
              }
            }}
          >
            {promoting ? "Promoting..." : experiment.promotedCampaignId ? "Promoted" : "Promote to Campaign"}
          </Button>
          {experiment.promotedCampaignId ? (
            <Button asChild type="button" variant="outline">
              <Link href={`/brands/${brandId}/campaigns/${experiment.promotedCampaignId}`}>Open Campaign</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live results</CardTitle>
          <CardDescription>Sent, replies, outcomes, and run timeline/debug events.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {latestRun ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">Run {latestRun.id.slice(-6)}</div>
                <Badge variant={runStatusVariant(latestRun.status)}>{latestRun.status}</Badge>
              </div>
              <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                Leads {latestRun.metrics.sourcedLeads} · Sent {latestRun.metrics.sentMessages} · Replies {latestRun.metrics.replies} · Positive {latestRun.metrics.positiveReplies}
              </div>
              {latestRun.lastError ? (
                <div className="mt-2 text-sm text-[color:var(--danger)]">Reason: {latestRun.lastError}</div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {canPause(latestRun.status) ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      await controlExperimentRunApi(brandId, experiment.id, latestRun.id, "pause");
                      await refresh(false);
                    }}
                  >
                    <Pause className="h-4 w-4" /> Pause
                  </Button>
                ) : null}
                {canResume(latestRun.status) ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      await controlExperimentRunApi(brandId, experiment.id, latestRun.id, "resume");
                      await refresh(false);
                    }}
                  >
                    <Play className="h-4 w-4" /> Resume
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    await controlExperimentRunApi(brandId, experiment.id, latestRun.id, "cancel");
                    await refresh(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[color:var(--muted-foreground)]">No run yet. Launch Test to start.</div>
          )}

          <div>
            <div className="text-sm font-medium">Outbound messages</div>
            {runView.messages.length ? (
              <div className="mt-2 space-y-2">
                {runView.messages.slice(0, 20).map((message) => (
                  <div key={message.id} className="rounded-lg border border-[color:var(--border)] p-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{message.subject || "(no subject)"}</span>
                      <Badge variant={message.status === "sent" ? "success" : message.status === "failed" ? "danger" : "muted"}>
                        {message.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[color:var(--muted-foreground)]">
                      {message.body.slice(0, 180)}{message.body.length > 180 ? "..." : ""}
                    </div>
                    <div className="mt-1 text-[color:var(--muted-foreground)]">
                      {formatDate(message.sentAt || message.scheduledAt)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">No outbound messages yet.</div>
            )}
          </div>

          <div>
            <div className="text-sm font-medium">Inbound replies</div>
            {runView.threads.length ? (
              <div className="mt-2 space-y-2">
                {runView.threads.slice(0, 20).map((thread) => (
                  <div key={thread.id} className="rounded-lg border border-[color:var(--border)] p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{thread.subject || "(no subject)"}</span>
                      <Badge variant={thread.sentiment === "positive" ? "success" : thread.sentiment === "negative" ? "danger" : "muted"}>
                        {thread.sentiment}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[color:var(--muted-foreground)]">
                      {thread.intent} · {formatDate(thread.lastMessageAt)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">No replies yet.</div>
            )}
          </div>

          <div>
            <div className="text-sm font-medium">Run timeline</div>
            {latestEvents.length ? (
              <div className="mt-2 space-y-2">
                {latestEvents.slice(0, 25).map((event) => (
                  <div key={event.id} className="rounded-lg border border-[color:var(--border)] p-2 text-xs">
                    <div className="font-medium">{event.eventType}</div>
                    <div className="text-[color:var(--muted-foreground)]">{formatDate(event.createdAt)}</div>
                    {event.payload.reason ? (
                      <div className="mt-1 text-[color:var(--danger)]">{String(event.payload.reason)}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">No timeline events yet.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
