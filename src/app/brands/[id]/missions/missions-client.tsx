"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageIntro, SectionPanel } from "@/components/ui/page-layout";
import {
  createMissionApi,
  fetchBrand,
  fetchMissions,
  startMissionApi,
} from "@/lib/client-api";
import type { BrandRecord } from "@/lib/factory-types";
import type { Mission, MissionPlan } from "@/lib/mission-types";

function linesToText(values: string[]) {
  return values.join("\n");
}

function textToLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function planToForm(plan: MissionPlan) {
  return {
    offerSummary: plan.offerSummary,
    targetCustomers: linesToText(plan.targetCustomers),
    avoidList: linesToText(plan.avoidList),
    outreachAngle: plan.outreachAngle,
    firstBatchSize: String(plan.firstBatchSize || 25),
    primaryRisk: plan.primaryRisk,
    successCriteria: plan.successCriteria,
    sampleMessage: plan.sampleMessage,
    deliverabilitySummary: plan.deliverabilityPlan.summary,
    inboxStrategy: plan.deliverabilityPlan.inboxStrategy,
    domainStrategy: plan.deliverabilityPlan.domainStrategy,
    warmupStrategy: plan.deliverabilityPlan.warmupStrategy,
    inboxPlacementTest: plan.deliverabilityPlan.inboxPlacementTest,
    dailyRamp: plan.deliverabilityPlan.dailyRamp,
    learningSummary: plan.learningPlan.summary,
    signalsToWatch: linesToText(plan.learningPlan.signalsToWatch),
    automaticChanges: linesToText(plan.learningPlan.automaticChanges),
    approvalRequiredFor: linesToText(plan.learningPlan.approvalRequiredFor),
  };
}

function formToPlan(base: MissionPlan, form: ReturnType<typeof planToForm>): MissionPlan {
  const firstBatchSize = Math.max(10, Math.min(50, Math.round(Number(form.firstBatchSize) || 25)));
  return {
    ...base,
    offerSummary: form.offerSummary.trim(),
    targetCustomers: textToLines(form.targetCustomers),
    avoidList: textToLines(form.avoidList),
    outreachAngle: form.outreachAngle.trim(),
    firstBatchSize,
    primaryRisk: form.primaryRisk.trim(),
    successCriteria: form.successCriteria.trim(),
    sampleMessage: form.sampleMessage.trim(),
    deliverabilityPlan: {
      ...base.deliverabilityPlan,
      summary: form.deliverabilitySummary.trim(),
      inboxStrategy: form.inboxStrategy.trim(),
      domainStrategy: form.domainStrategy.trim(),
      warmupStrategy: form.warmupStrategy.trim(),
      inboxPlacementTest: form.inboxPlacementTest.trim(),
      dailyRamp: form.dailyRamp.trim(),
      autoProvisioning: true,
    },
    learningPlan: {
      ...base.learningPlan,
      summary: form.learningSummary.trim(),
      signalsToWatch: textToLines(form.signalsToWatch),
      automaticChanges: textToLines(form.automaticChanges),
      approvalRequiredFor: textToLines(form.approvalRequiredFor),
    },
  };
}

function statusLabel(status: Mission["status"]) {
  return status.replaceAll("_", " ");
}

export default function MissionsClient({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [activeMission, setActiveMission] = useState<Mission | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [targetCustomerText, setTargetCustomerText] = useState("");
  const [planForm, setPlanForm] = useState<ReturnType<typeof planToForm> | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    void Promise.all([fetchBrand(brandId), fetchMissions(brandId)])
      .then(([brandRow, missionRows]) => {
        if (!mounted) return;
        setBrand(brandRow);
        setMissions(missionRows);
        setWebsiteUrl(brandRow.website || "");
        setTargetCustomerText((brandRow.idealCustomerProfiles ?? []).join("\n"));
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load goals");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [brandId]);

  const latestMission = useMemo(() => missions[0] ?? null, [missions]);
  const canStart = Boolean(activeMission && planForm && !starting);

  return (
    <div className="space-y-7">
      <PageIntro
        title="Set a goal for Brand GPT"
        description="Give the AI the site and target customers. Edit only what it gets wrong, then let it run the first safe batch."
      />

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading...</div> : null}

      <SectionPanel
        title="Goal"
        description="Keep this simple. The AI will handle targeting, tests, inbox warmup, and deliverability checks."
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="websiteUrl">Website</Label>
            <Input
              id="websiteUrl"
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="targetCustomers">Target customers</Label>
            <Textarea
              id="targetCustomers"
              value={targetCustomerText}
              onChange={(event) => setTargetCustomerText(event.target.value)}
              placeholder="B2B SaaS founders hiring SDRs"
            />
          </div>
          <div>
            <Button
              type="button"
              disabled={generating || !websiteUrl.trim() || !targetCustomerText.trim()}
              onClick={async () => {
                setGenerating(true);
                setError("");
                try {
                  const mission = await createMissionApi(brandId, {
                    websiteUrl,
                    targetCustomerText,
                  });
                  setActiveMission(mission);
                  setPlanForm(planToForm(mission.generatedPlan));
                  setMissions((current) => [mission, ...current.filter((row) => row.id !== mission.id)]);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to generate goal plan");
                } finally {
                  setGenerating(false);
                }
              }}
            >
              <Sparkles className="h-4 w-4" />
              {generating ? "Generating..." : "Generate plan"}
            </Button>
          </div>
        </div>
      </SectionPanel>

      {activeMission && planForm ? (
        <SectionPanel
          title="Review plan"
          description="Edit anything wrong. Start is the approval for the first small batch."
          actions={
            <Button
              type="button"
              disabled={!canStart}
              onClick={async () => {
                if (!activeMission || !planForm) return;
                setStarting(true);
                setError("");
                try {
                  const approvedPlan = formToPlan(activeMission.generatedPlan, planForm);
                  const mission = await startMissionApi(brandId, activeMission.id, approvedPlan);
                  router.push(`/brands/${brandId}/missions/${mission.id}`);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to start goal");
                } finally {
                  setStarting(false);
                }
              }}
            >
              {starting ? "Starting..." : "Start goal"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          }
        >
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="offerSummary">What AI thinks you sell</Label>
              <Textarea
                id="offerSummary"
                value={planForm.offerSummary}
                onChange={(event) => setPlanForm({ ...planForm, offerSummary: event.target.value })}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="planTargets">We will target</Label>
                <Textarea
                  id="planTargets"
                  value={planForm.targetCustomers}
                  onChange={(event) => setPlanForm({ ...planForm, targetCustomers: event.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="avoidList">We will avoid</Label>
                <Textarea
                  id="avoidList"
                  value={planForm.avoidList}
                  onChange={(event) => setPlanForm({ ...planForm, avoidList: event.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_140px]">
              <div className="grid gap-2">
                <Label htmlFor="outreachAngle">Outreach angle</Label>
                <Textarea
                  id="outreachAngle"
                  value={planForm.outreachAngle}
                  onChange={(event) => setPlanForm({ ...planForm, outreachAngle: event.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="firstBatchSize">First batch</Label>
                <Input
                  id="firstBatchSize"
                  type="number"
                  min={10}
                  max={50}
                  value={planForm.firstBatchSize}
                  onChange={(event) => setPlanForm({ ...planForm, firstBatchSize: event.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="primaryRisk">Primary risk</Label>
                <Textarea
                  id="primaryRisk"
                  value={planForm.primaryRisk}
                  onChange={(event) => setPlanForm({ ...planForm, primaryRisk: event.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="successCriteria">Success looks like</Label>
                <Textarea
                  id="successCriteria"
                  value={planForm.successCriteria}
                  onChange={(event) => setPlanForm({ ...planForm, successCriteria: event.target.value })}
                />
              </div>
            </div>
            <details className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-[color:var(--foreground)]">
                Deliverability and learning
              </summary>
              <div className="mt-3 grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="deliverabilitySummary">Deliverability plan</Label>
                  <Textarea
                    id="deliverabilitySummary"
                    value={planForm.deliverabilitySummary}
                    onChange={(event) => setPlanForm({ ...planForm, deliverabilitySummary: event.target.value })}
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Textarea
                    aria-label="Inbox strategy"
                    value={planForm.inboxStrategy}
                    onChange={(event) => setPlanForm({ ...planForm, inboxStrategy: event.target.value })}
                    placeholder="Inbox strategy"
                  />
                  <Textarea
                    aria-label="Warmup strategy"
                    value={planForm.warmupStrategy}
                    onChange={(event) => setPlanForm({ ...planForm, warmupStrategy: event.target.value })}
                    placeholder="Warmup strategy"
                  />
                  <Textarea
                    aria-label="Inbox placement test"
                    value={planForm.inboxPlacementTest}
                    onChange={(event) => setPlanForm({ ...planForm, inboxPlacementTest: event.target.value })}
                    placeholder="Inbox placement test"
                  />
                  <Textarea
                    aria-label="Learning plan"
                    value={planForm.learningSummary}
                    onChange={(event) => setPlanForm({ ...planForm, learningSummary: event.target.value })}
                    placeholder="Learning plan"
                  />
                </div>
              </div>
            </details>
          </div>
        </SectionPanel>
      ) : null}

      {latestMission ? (
        <SectionPanel title="Recent goals" description="Open a goal to see its current move, risk, and results.">
          <div className="grid gap-2">
            {missions.slice(0, 5).map((mission) => (
              <Link
                key={mission.id}
                href={`/brands/${brandId}/missions/${mission.id}`}
                className="flex items-center justify-between rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2.5 text-sm transition-colors hover:bg-[color:var(--surface-hover)]"
              >
                <span className="min-w-0 truncate">{mission.generatedPlan.offerSummary || mission.websiteUrl}</span>
                <span className="shrink-0 text-xs text-[color:var(--muted-foreground)]">{statusLabel(mission.status)}</span>
              </Link>
            ))}
          </div>
        </SectionPanel>
      ) : !loading ? (
        <EmptyState
          title="No goals yet."
          description={brand ? `Set the first Brand GPT goal for ${brand.name}.` : "Set the first Brand GPT goal."}
        />
      ) : null}
    </div>
  );
}
