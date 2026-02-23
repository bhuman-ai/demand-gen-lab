"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Pause, Play, Rocket, Save } from "lucide-react";
import {
  controlScaleCampaignRunApi,
  fetchBrand,
  fetchScaleCampaign,
  fetchScaleCampaignRunView,
  launchScaleCampaignApi,
  updateScaleCampaignApi,
} from "@/lib/client-api";
import type { BrandRecord, OutreachRun, RunViewModel, ScaleCampaignRecord } from "@/lib/factory-types";
import { trackEvent } from "@/lib/telemetry-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

export default function CampaignClient({
  brandId,
  campaignId,
}: {
  brandId: string;
  campaignId: string;
}) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaign, setCampaign] = useState<ScaleCampaignRecord | null>(null);
  const [runView, setRunView] = useState<RunViewModel | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");

  const refresh = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const [brandRow, campaignRow, runRow] = await Promise.all([
        fetchBrand(brandId),
        fetchScaleCampaign(brandId, campaignId),
        fetchScaleCampaignRunView(brandId, campaignId),
      ]);
      setBrand(brandRow);
      setCampaign(campaignRow);
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
        setError(err instanceof Error ? err.message : "Failed to load campaign");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    trackEvent("campaign_viewed", { brandId, campaignId });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, campaignId]);

  const latestRun = useMemo(() => runView?.runs?.[0] ?? null, [runView]);
  const latestEvents = useMemo(
    () => (latestRun ? runView?.eventsByRun?.[latestRun.id] ?? [] : []),
    [latestRun, runView]
  );

  if (loading || !campaign || !runView) {
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading campaign...</div>;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{brand?.name || "Brand"} · {campaign.name}</CardTitle>
          <CardDescription>
            Scale-only campaign promoted from experiment {campaign.sourceExperimentId.slice(-6)}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="muted">Status: {campaign.status}</Badge>
          <Badge variant="muted">Sent: {campaign.metricsSummary.sent}</Badge>
          <Badge variant="muted">Replies: {campaign.metricsSummary.replies}</Badge>
          <Badge variant="muted">Positive: {campaign.metricsSummary.positiveReplies}</Badge>
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Source snapshot (locked)</CardTitle>
          <CardDescription>
            Strategy, offer, audience, and flow revision are immutable after promotion.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="rounded-lg border border-[color:var(--border)] p-3 text-sm">
            <div><strong>Offer:</strong> {campaign.snapshot.offer || "Not set"}</div>
            <div className="mt-1"><strong>Audience:</strong> {campaign.snapshot.audience || "Not set"}</div>
            <div className="mt-1">
              <strong>Flow revision:</strong> {campaign.snapshot.publishedRevision > 0 ? `#${campaign.snapshot.publishedRevision}` : "Not published"}
            </div>
          </div>
          <Button asChild variant="outline" className="w-fit">
            <Link href={`/brands/${brandId}/experiments/${campaign.sourceExperimentId}`}>
              View source experiment
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scale controls (editable)</CardTitle>
          <CardDescription>Only delivery scale policy can be changed here.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-2">
            <Label>Daily cap</Label>
            <Input
              type="number"
              min={1}
              value={campaign.scalePolicy.dailyCap}
              onChange={(event) =>
                setCampaign((prev) =>
                  prev
                    ? {
                        ...prev,
                        scalePolicy: {
                          ...prev.scalePolicy,
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
              value={campaign.scalePolicy.hourlyCap}
              onChange={(event) =>
                setCampaign((prev) =>
                  prev
                    ? {
                        ...prev,
                        scalePolicy: {
                          ...prev.scalePolicy,
                          hourlyCap: Math.max(1, Number(event.target.value || 1)),
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
              value={campaign.scalePolicy.timezone}
              onChange={(event) =>
                setCampaign((prev) =>
                  prev
                    ? {
                        ...prev,
                        scalePolicy: {
                          ...prev.scalePolicy,
                          timezone: event.target.value,
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
              value={campaign.scalePolicy.minSpacingMinutes}
              onChange={(event) =>
                setCampaign((prev) =>
                  prev
                    ? {
                        ...prev,
                        scalePolicy: {
                          ...prev.scalePolicy,
                          minSpacingMinutes: Math.max(1, Number(event.target.value || 1)),
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Delivery account id</Label>
            <Input
              value={campaign.scalePolicy.accountId}
              onChange={(event) =>
                setCampaign((prev) =>
                  prev
                    ? {
                        ...prev,
                        scalePolicy: {
                          ...prev.scalePolicy,
                          accountId: event.target.value,
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Reply mailbox account id</Label>
            <Input
              value={campaign.scalePolicy.mailboxAccountId}
              onChange={(event) =>
                setCampaign((prev) =>
                  prev
                    ? {
                        ...prev,
                        scalePolicy: {
                          ...prev.scalePolicy,
                          mailboxAccountId: event.target.value,
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
          <CardTitle className="text-base">Execution</CardTitle>
          <CardDescription>Launch and manage scale runs for this campaign.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                const saved = await updateScaleCampaignApi(brandId, campaign.id, {
                  scalePolicy: campaign.scalePolicy,
                });
                setCampaign(saved);
                trackEvent("campaign_scale_updated", { brandId, campaignId: campaign.id });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to save campaign");
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Scale Controls"}
          </Button>
          <Button
            type="button"
            disabled={launching}
            onClick={async () => {
              setLaunching(true);
              setError("");
              try {
                await updateScaleCampaignApi(brandId, campaign.id, {
                  scalePolicy: campaign.scalePolicy,
                });
                const result = await launchScaleCampaignApi(brandId, campaign.id);
                trackEvent("campaign_launched", { brandId, campaignId: campaign.id, runId: result.runId });
                await refresh(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to launch campaign");
              } finally {
                setLaunching(false);
              }
            }}
          >
            <Rocket className="h-4 w-4" />
            {launching ? "Launching..." : "Launch Campaign"}
          </Button>
          {latestRun && canPause(latestRun.status) ? (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await controlScaleCampaignRunApi(brandId, campaign.id, latestRun.id, "pause");
                await refresh(false);
              }}
            >
              <Pause className="h-4 w-4" /> Pause
            </Button>
          ) : null}
          {latestRun && canResume(latestRun.status) ? (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await controlScaleCampaignRunApi(brandId, campaign.id, latestRun.id, "resume");
                await refresh(false);
              }}
            >
              <Play className="h-4 w-4" /> Resume
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run visibility</CardTitle>
          <CardDescription>Latest attempt, worker events, sent emails, and replies.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {latestRun ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Run {latestRun.id.slice(-6)}</div>
                <Badge variant={runStatusVariant(latestRun.status)}>{latestRun.status}</Badge>
              </div>
              <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                Leads {latestRun.metrics.sourcedLeads} · Sent {latestRun.metrics.sentMessages} · Replies {latestRun.metrics.replies}
              </div>
              {latestRun.lastError ? (
                <div className="mt-2 text-sm text-[color:var(--danger)]">Reason: {latestRun.lastError}</div>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-[color:var(--muted-foreground)]">No runs yet.</div>
          )}

          <div>
            <div className="text-sm font-medium">Sent messages</div>
            {runView.messages.length ? (
              <div className="mt-2 space-y-2">
                {runView.messages.slice(0, 20).map((message) => (
                  <div key={message.id} className="rounded-lg border border-[color:var(--border)] p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
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
              <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">No messages yet.</div>
            )}
          </div>

          <div>
            <div className="text-sm font-medium">Reply threads</div>
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
            <div className="text-sm font-medium">Timeline events</div>
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
