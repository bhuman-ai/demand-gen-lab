"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageIntro, SectionPanel, StatLedger } from "@/components/ui/page-layout";
import { fetchMissionDetail } from "@/lib/client-api";
import type { MissionDetail } from "@/lib/mission-types";

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

function stageLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatDate(value: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString();
}

export default function MissionDetailClient({
  brandId,
  missionId,
}: {
  brandId: string;
  missionId: string;
}) {
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchMissionDetail(brandId, missionId);
      setDetail(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mission");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, missionId]);

  const mission = detail?.mission ?? null;
  const latestDecision = detail?.decisions?.[0] ?? null;
  const latestLearning = detail?.learnings?.[0] ?? null;
  const currentMove = useMemo(() => {
    if (!mission) return "";
    if (mission.status === "deliverability_blocked") return "Preparing inboxes and deliverability before launch.";
    if (mission.status === "running") return "Running the approved first batch.";
    if (mission.status === "monitoring") return "Watching replies, bounces, and sender health.";
    if (mission.status === "learning") return "Reviewing results and deciding the next move.";
    if (mission.status === "plan_ready") return "Waiting for the plan to be approved.";
    return statusLabel(mission.status);
  }, [mission]);

  return (
    <div className="space-y-7">
      <PageIntro
        title="Mission control"
        description="One place to see what the AI operator is doing, why, and what might block it."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/brands/${brandId}/missions`}>
                <ArrowLeft className="h-4 w-4" />
                Missions
              </Link>
            </Button>
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      />

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
      {loading && !mission ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading mission...</div> : null}

      {mission ? (
        <>
          <SectionPanel title="Current move" description={currentMove}>
            <div className="grid gap-4">
              <StatLedger
                items={[
                  {
                    label: "Status",
                    value: statusLabel(mission.status),
                    detail: mission.lastError || "Mission state is current.",
                  },
                  {
                    label: "Deliverability",
                    value: stageLabel(mission.deliverabilityState.stage),
                    detail: mission.deliverabilityState.summary,
                  },
                  {
                    label: "Sent",
                    value: mission.metricsSummary.sent,
                    detail: `${mission.metricsSummary.scheduled} scheduled`,
                  },
                  {
                    label: "Replies",
                    value: mission.metricsSummary.replies,
                    detail: `${mission.metricsSummary.positiveReplies} positive`,
                  },
                ]}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-sm font-medium text-[color:var(--foreground)]">Primary risk</div>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                    {mission.approvedPlan.primaryRisk || mission.generatedPlan.primaryRisk || mission.deliverabilityState.primaryBlocker || "No primary risk recorded yet."}
                  </p>
                </div>
                <div>
                  <div className="text-sm font-medium text-[color:var(--foreground)]">Rationale</div>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                    {mission.approvedPlan.outreachAngle || mission.generatedPlan.outreachAngle || "No rationale recorded yet."}
                  </p>
                </div>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel title="Plan" description="This is the approved strategy the operator is running.">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-sm font-medium text-[color:var(--foreground)]">Offer</div>
                <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  {mission.approvedPlan.offerSummary || mission.generatedPlan.offerSummary}
                </p>
              </div>
              <div>
                <div className="text-sm font-medium text-[color:var(--foreground)]">Success</div>
                <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  {mission.approvedPlan.successCriteria || mission.generatedPlan.successCriteria}
                </p>
              </div>
            </div>
          </SectionPanel>

          <details className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)]">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[color:var(--foreground)]">
              Receipts
            </summary>
            <div className="grid gap-4 border-t border-[color:var(--border)] px-4 py-4">
              {latestDecision ? (
                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2.5 text-sm">
                  <div className="font-medium">{latestDecision.agent}: {latestDecision.action}</div>
                  <div className="mt-1 text-[color:var(--muted-foreground)]">{latestDecision.rationale}</div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{formatDate(latestDecision.createdAt)}</div>
                </div>
              ) : null}
              {latestLearning ? (
                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2.5 text-sm">
                  <div className="font-medium">Learning: {latestLearning.learningType}</div>
                  <div className="mt-1 text-[color:var(--muted-foreground)]">{latestLearning.summary}</div>
                </div>
              ) : null}
              {detail?.events?.length ? (
                <div className="grid gap-2">
                  {detail.events.slice(0, 6).map((event) => (
                    <div key={event.id} className="text-sm text-[color:var(--muted-foreground)]">
                      {event.summary} <span className="text-xs">{formatDate(event.createdAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-[color:var(--muted-foreground)]">No receipts yet.</div>
              )}
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
