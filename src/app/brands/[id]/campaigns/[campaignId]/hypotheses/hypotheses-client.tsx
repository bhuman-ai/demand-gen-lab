"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, Sparkles, Trash2 } from "lucide-react";
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
  generateHypothesesApi,
  updateCampaignApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, CampaignRecord, Hypothesis } from "@/lib/factory-types";

const makeId = () => `hyp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export default function HypothesesClient({ brandId, campaignId }: { brandId: string; campaignId: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    void Promise.all([fetchBrand(brandId), fetchCampaign(brandId, campaignId)])
      .then(([brandRow, campaignRow]) => {
        if (!mounted) return;
        setBrand(brandRow);
        setCampaign(campaignRow);
        setHypotheses(campaignRow.hypotheses);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load hypotheses");
      });
    return () => {
      mounted = false;
    };
  }, [brandId, campaignId]);

  useEffect(() => {
    trackEvent("campaign_step_viewed", { brandId, campaignId, step: "hypotheses" });
  }, [brandId, campaignId]);

  if (!campaign) {
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading hypotheses...</div>;
  }

  const hypothesisTemplates: Array<Pick<Hypothesis, "title" | "channel" | "rationale">> = [
    {
      title: "ICP pain: stop doing X manually",
      channel: "Email",
      rationale:
        "If we target a single role at a narrow company type and lead with a specific pain, we should see higher reply quality and faster learning.",
    },
    {
      title: "Offer test: the 10-minute teardown",
      channel: "Email",
      rationale:
        "If we offer a short, concrete artifact (teardown/audit) with a low-friction CTA, we should increase positive replies without lowering lead quality.",
    },
    {
      title: "Trigger-based: new hire or funding",
      channel: "Email",
      rationale:
        "If we filter to prospects with an obvious trigger, we should improve relevance and reduce negative replies.",
    },
  ];

  const save = async (completeStep: boolean) => {
    setSaving(true);
    setError("");
    try {
      const next = await updateCampaignApi(brandId, campaignId, {
        hypotheses,
        stepState: completeStep ? completeStepState("hypotheses", campaign.stepState) : campaign.stepState,
      });
      setCampaign(next);
      trackEvent("campaign_saved", { brandId, campaignId, step: "hypotheses" });
      if (completeStep) {
        trackEvent("campaign_step_completed", { brandId, campaignId, step: "hypotheses" });
        router.push(`/brands/${brandId}/campaigns/${campaignId}/experiments`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const generated = await generateHypothesesApi(brandId, campaignId, {
        brandName: brand?.name ?? "Brand",
        goal: campaign.objective.goal,
        constraints: campaign.objective.constraints,
      });
      const normalized = generated.map((item) => ({
        ...item,
        id: makeId(),
        sourceConfig: {
          actorId: item.sourceConfig?.actorId ?? item.actorQuery ?? "",
          actorInput: item.sourceConfig?.actorInput ?? {},
          maxLeads: item.sourceConfig?.maxLeads ?? 100,
        },
        status: "draft" as const,
      }));
      setHypotheses(normalized);
    } catch (err) {
      trackEvent("generation_error", { brandId, campaignId, step: "hypotheses" });
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const addManual = (input?: Partial<Pick<Hypothesis, "title" | "channel" | "rationale">>) => {
    setHypotheses((prev) => [
      {
        id: makeId(),
        title: input?.title ?? "New hypothesis",
        channel: input?.channel ?? "Email",
        rationale: input?.rationale ?? "",
        actorQuery: "",
        sourceConfig: {
          actorId: "",
          actorInput: {},
          maxLeads: 100,
        },
        seedInputs: [],
        status: "draft",
      },
      ...prev,
    ]);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{brand?.name} · {campaign.name}</CardTitle>
          <CardDescription>Step 2 of 4: generate and approve hypotheses.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={generate} disabled={loading}>
            <Sparkles className="h-4 w-4" />
            {loading ? "Generating..." : "Generate Hypotheses"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => addManual()}
          >
            <Plus className="h-4 w-4" />
            Add Manual
          </Button>
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <div className="grid gap-4">
        {hypotheses.map((hypothesis, index) => (
          <Card key={hypothesis.id}>
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Hypothesis {index + 1}</CardTitle>
                <Badge variant={hypothesis.status === "approved" ? "success" : "muted"}>{hypothesis.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor={`hypothesis-title-${index}`}>Title</Label>
                <Input
                  id={`hypothesis-title-${index}`}
                  value={hypothesis.title}
                  onChange={(event) => {
                    const next = [...hypotheses];
                    next[index] = { ...next[index], title: event.target.value };
                    setHypotheses(next);
                  }}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor={`hypothesis-rationale-${index}`}>Rationale</Label>
                  <Textarea
                    id={`hypothesis-rationale-${index}`}
                    value={hypothesis.rationale}
                    onChange={(event) => {
                      const next = [...hypotheses];
                      next[index] = { ...next[index], rationale: event.target.value };
                      setHypotheses(next);
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`hypothesis-channel-${index}`}>Channel</Label>
                  <Input
                    id={`hypothesis-channel-${index}`}
                    value={hypothesis.channel}
                    onChange={(event) => {
                      const next = [...hypotheses];
                      next[index] = { ...next[index], channel: event.target.value };
                      setHypotheses(next);
                    }}
                  />
                  <Label htmlFor={`hypothesis-status-${index}`}>Status</Label>
                  <Select
                    id={`hypothesis-status-${index}`}
                    value={hypothesis.status}
                    onChange={(event) => {
                      const next = [...hypotheses];
                      next[index] = {
                        ...next[index],
                        status: event.target.value === "approved" ? "approved" : "draft",
                      };
                      setHypotheses(next);
                    }}
                  >
                    <option value="draft">Draft</option>
                    <option value="approved">Approved</option>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2 md:max-w-[260px]">
                <Label htmlFor={`hypothesis-max-leads-${index}`}>Lead Target</Label>
                <Input
                  id={`hypothesis-max-leads-${index}`}
                  type="number"
                  min={1}
                  max={500}
                  value={hypothesis.sourceConfig?.maxLeads ?? 100}
                  onChange={(event) => {
                    const next = [...hypotheses];
                    next[index] = {
                      ...next[index],
                      sourceConfig: {
                        actorId: next[index].sourceConfig?.actorId ?? "",
                        actorInput: next[index].sourceConfig?.actorInput ?? {},
                        maxLeads: Number(event.target.value || 100),
                      },
                    };
                    setHypotheses(next);
                  }}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setHypotheses((prev) => prev.filter((item) => item.id !== hypothesis.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {!hypotheses.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Start Here</CardTitle>
              <CardDescription>
                You can generate from your objective, or start from a template and edit.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {!campaign.objective.goal.trim() ? (
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-sm">
                  Objective goal is empty. Hypothesis generation works best after you define a clear goal.
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/brands/${brandId}/campaigns/${campaignId}/objective`}>Go to Objective</Link>
                    </Button>
                    <Button size="sm" variant="secondary" type="button" onClick={generate} disabled={loading}>
                      <Sparkles className="h-4 w-4" />
                      {loading ? "Generating..." : "Generate Anyway"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" type="button" onClick={generate} disabled={loading}>
                    <Sparkles className="h-4 w-4" />
                    {loading ? "Generating..." : "Generate From Objective"}
                  </Button>
                  <Button size="sm" variant="outline" type="button" onClick={() => addManual()}>
                    <Plus className="h-4 w-4" />
                    Add Manual
                  </Button>
                </div>
              )}

              <div className="grid gap-2">
                <div className="text-xs font-semibold text-[color:var(--muted-foreground)]">Templates</div>
                <div className="flex flex-wrap gap-2">
                  {hypothesisTemplates.map((template) => (
                    <Button
                      key={template.title}
                      size="sm"
                      variant="outline"
                      type="button"
                      title={template.rationale}
                      onClick={() => addManual(template)}
                    >
                      {template.title}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Button type="button" onClick={() => save(false)} disabled={saving}>
            {saving ? "Saving..." : "Save Hypotheses"}
          </Button>
          <Button type="button" variant="outline" onClick={() => save(true)} disabled={saving || !hypotheses.length}>
            Save & Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button asChild variant="ghost">
            <Link href={`/brands/${brandId}/campaigns/${campaignId}/experiments`}>Skip to Experiments</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
