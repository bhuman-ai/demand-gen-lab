"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchBrand,
  fetchBuildView,
  fetchCampaign,
  suggestBuildApi,
  updateBuildView,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { Angle, BrandRecord, BuildViewModel, ObjectiveData, Variant } from "@/lib/factory-types";

const makeAngleId = () => `hyp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const makeVariantId = () => `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function emptyAngle(): Angle {
  return {
    id: makeAngleId(),
    title: "",
    channel: "Email",
    rationale: "",
    actorQuery: "",
    sourceConfig: {
      actorId: "",
      actorInput: {},
      maxLeads: 100,
    },
    seedInputs: [],
    status: "draft",
  };
}

function emptyVariant(hypothesisId = ""): Variant {
  return {
    id: makeVariantId(),
    hypothesisId,
    name: "",
    status: "draft",
    notes: "",
    runPolicy: {
      cadence: "3_step_7_day",
      dailyCap: 30,
      hourlyCap: 6,
      timezone: "America/Los_Angeles",
      minSpacingMinutes: 8,
    },
    executionStatus: "idle",
  };
}

function defaultObjective(): ObjectiveData {
  return {
    goal: "",
    constraints: "",
    scoring: {
      conversionWeight: 0.6,
      qualityWeight: 0.2,
      replyWeight: 0.2,
    },
  };
}

export default function BuildClient({ brandId, campaignId }: { brandId: string; campaignId: string }) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaignName, setCampaignName] = useState("Campaign");
  const [build, setBuild] = useState<BuildViewModel | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<
    Array<{
      title: string;
      rationale: string;
      objective: {
        goal: string;
        constraints: string;
        scoring: ObjectiveData["scoring"];
      };
      angle: {
        title: string;
        rationale: string;
        channel: "Email";
        actorQuery: string;
        maxLeads: number;
        seedInputs: string[];
      };
      variants: Array<{
        name: string;
        notes: string;
        status: "draft" | "testing" | "scaling" | "paused";
        runPolicy: {
          cadence: "3_step_7_day";
          dailyCap: number;
          hourlyCap: number;
          timezone: string;
          minSpacingMinutes: number;
        };
      }>;
    }>
  >([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState("");

  useEffect(() => {
    let mounted = true;
    setError("");
    void Promise.all([fetchBrand(brandId), fetchCampaign(brandId, campaignId), fetchBuildView(brandId, campaignId)])
      .then(([brandRow, campaign, buildRow]) => {
        if (!mounted) return;
        setBrand(brandRow);
        setCampaignName(campaign.name || "Campaign");
        setBuild({
          objective: buildRow.objective ?? defaultObjective(),
          angles: Array.isArray(buildRow.angles) ? buildRow.angles : [],
          variants: Array.isArray(buildRow.variants) ? buildRow.variants : [],
        });
        localStorage.setItem("factory.activeBrandId", brandId);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load build workspace");
      });

    return () => {
      mounted = false;
    };
  }, [brandId, campaignId]);

  useEffect(() => {
    trackEvent("build_viewed", { brandId, campaignId });
  }, [brandId, campaignId]);

  const angleCount = build?.angles.length ?? 0;
  const variantCount = build?.variants.length ?? 0;

  const selectedBuildReadiness = useMemo(() => {
    if (!build) return { objective: false, angles: false, variants: false, ready: false };
    const objectiveReady = Boolean(build.objective.goal.trim());
    const anglesReady = build.angles.some((angle) => angle.title.trim() && angle.actorQuery.trim());
    const variantsReady = build.variants.some((variant) => variant.name.trim() && variant.hypothesisId.trim());
    return {
      objective: objectiveReady,
      angles: anglesReady,
      variants: variantsReady,
      ready: objectiveReady && anglesReady && variantsReady,
    };
  }, [build]);

  const loadSuggestions = async () => {
    setSuggestionsLoading(true);
    setSuggestionsError("");
    try {
      const rows = await suggestBuildApi(brandId, campaignId);
      setSuggestions(rows);
    } catch (err) {
      setSuggestionsError(err instanceof Error ? err.message : "Failed to generate build suggestions");
      trackEvent("generation_error", { brandId, campaignId, step: "build" });
    } finally {
      setSuggestionsLoading(false);
    }
  };

  useEffect(() => {
    if (!build) return;
    if (suggestions.length || suggestionsLoading || suggestionsError) return;
    void loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build]);

  if (!build) {
    if (error) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Could not load build workspace</CardTitle>
            <CardDescription className="text-[color:var(--danger)]">{error}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <Button asChild type="button" variant="outline">
              <Link href={`/brands/${brandId}/campaigns`}>Back to Campaigns</Link>
            </Button>
          </CardContent>
        </Card>
      );
    }
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading build workspace...</div>;
  }

  const saveBuild = async () => {
    setSaving(true);
    setError("");
    try {
      const next = await updateBuildView(brandId, campaignId, build);
      setBuild(next);
      trackEvent("campaign_saved", { brandId, campaignId, step: "build" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save build");
    } finally {
      setSaving(false);
    }
  };

  const applyBundle = (
    bundle: NonNullable<typeof suggestions>[number]
  ) => {
    const angleId = makeAngleId();
    setBuild(() => {
      return {
        objective: {
          goal: bundle.objective.goal,
          constraints: bundle.objective.constraints,
          scoring: bundle.objective.scoring,
        },
        angles: [
          {
            id: angleId,
            title: bundle.angle.title,
            channel: "Email",
            rationale: bundle.angle.rationale,
            actorQuery: bundle.angle.actorQuery,
            sourceConfig: {
              actorId: "",
              actorInput: {},
              maxLeads: bundle.angle.maxLeads,
            },
            seedInputs: bundle.angle.seedInputs,
            status: "draft",
          },
        ],
        variants: bundle.variants.map((variant) => ({
          id: makeVariantId(),
          hypothesisId: angleId,
          name: variant.name,
          status: variant.status,
          notes: variant.notes,
          runPolicy: {
            cadence: "3_step_7_day",
            dailyCap: variant.runPolicy.dailyCap,
            hourlyCap: variant.runPolicy.hourlyCap,
            timezone: variant.runPolicy.timezone,
            minSpacingMinutes: variant.runPolicy.minSpacingMinutes,
          },
          executionStatus: "idle",
        })),
      };
    });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{brand?.name} · {campaignName}</CardTitle>
          <CardDescription>
            Build your campaign in one place: Objective -&gt; Angles -&gt; Variants.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-xs">
          <Badge variant={selectedBuildReadiness.objective ? "success" : "muted"}>Objective</Badge>
          <Badge variant={selectedBuildReadiness.angles ? "success" : "muted"}>Angles</Badge>
          <Badge variant={selectedBuildReadiness.variants ? "success" : "muted"}>Variants</Badge>
          <Badge variant={selectedBuildReadiness.ready ? "success" : "accent"}>
            {selectedBuildReadiness.ready ? "Ready to Run" : "Build in progress"}
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Build Suggestions</CardTitle>
          <CardDescription>
            Click one bundle card to prefill objective, one angle, and starter variants.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="button" variant="secondary" onClick={loadSuggestions} disabled={suggestionsLoading}>
              <Sparkles className="h-4 w-4" />
              {suggestionsLoading ? "Generating..." : suggestions.length ? "Refresh AI" : "Generate AI"}
            </Button>
          </div>
          {suggestionsError ? <div className="text-xs text-[color:var(--danger)]">{suggestionsError}</div> : null}
          {suggestionsLoading && !suggestions.length ? (
            <div className="text-xs text-[color:var(--muted-foreground)]">Generating tailored build bundles...</div>
          ) : null}
          {suggestions.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {suggestions.map((bundle) => (
                <button
                  key={bundle.title}
                  type="button"
                  className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-left transition hover:bg-[color:var(--surface)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                  onClick={() => applyBundle(bundle)}
                >
                  <div className="text-sm font-semibold">{bundle.title}</div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{bundle.rationale}</div>
                  <div className="mt-2 text-xs">
                    <div><span className="font-medium">Goal:</span> {bundle.objective.goal}</div>
                    <div><span className="font-medium">Angle:</span> {bundle.angle.title}</div>
                    <div><span className="font-medium">Variants:</span> {bundle.variants.map((item) => item.name).join(" • ")}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Objective</CardTitle>
          <CardDescription>Define the business outcome and key constraints.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="build-goal">Goal</Label>
            <Textarea
              id="build-goal"
              value={build.objective.goal}
              onChange={(event) =>
                setBuild((prev) =>
                  prev
                    ? { ...prev, objective: { ...prev.objective, goal: event.target.value } }
                    : prev
                )
              }
              placeholder="What outcome should this campaign drive?"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="build-constraints">Constraints</Label>
            <Textarea
              id="build-constraints"
              value={build.objective.constraints}
              onChange={(event) =>
                setBuild((prev) =>
                  prev
                    ? { ...prev, objective: { ...prev.objective, constraints: event.target.value } }
                    : prev
                )
              }
              placeholder="Volume, targeting, message constraints"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Angles</CardTitle>
            <CardDescription>Angles are the strategic messaging bets you want to test.</CardDescription>
          </div>
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() =>
              setBuild((prev) =>
                prev
                  ? {
                      ...prev,
                      angles: [emptyAngle(), ...prev.angles],
                    }
                  : prev
              )
            }
          >
            <Plus className="h-4 w-4" />
            Add Angle
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {build.angles.map((angle, index) => (
            <div key={angle.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Angle {index + 1}</div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setBuild((prev) =>
                      prev
                        ? {
                            ...prev,
                            angles: prev.angles.filter((row) => row.id !== angle.id),
                            variants: prev.variants.map((variant) =>
                              variant.hypothesisId === angle.id ? { ...variant, hypothesisId: "" } : variant
                            ),
                          }
                        : prev
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor={`angle-title-${angle.id}`}>Angle Title</Label>
                  <Input
                    id={`angle-title-${angle.id}`}
                    value={angle.title}
                    onChange={(event) =>
                      setBuild((prev) =>
                        prev
                          ? {
                              ...prev,
                              angles: prev.angles.map((row) =>
                                row.id === angle.id ? { ...row, title: event.target.value } : row
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`angle-status-${angle.id}`}>Status</Label>
                  <Select
                    id={`angle-status-${angle.id}`}
                    value={angle.status}
                    onChange={(event) =>
                      setBuild((prev) =>
                        prev
                          ? {
                              ...prev,
                              angles: prev.angles.map((row) =>
                                row.id === angle.id
                                  ? {
                                      ...row,
                                      status: event.target.value === "approved" ? "approved" : "draft",
                                    }
                                  : row
                              ),
                            }
                          : prev
                      )
                    }
                  >
                    <option value="draft">draft</option>
                    <option value="approved">approved</option>
                  </Select>
                </div>
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor={`angle-rationale-${angle.id}`}>Rationale</Label>
                  <Textarea
                    id={`angle-rationale-${angle.id}`}
                    value={angle.rationale}
                    onChange={(event) =>
                      setBuild((prev) =>
                        prev
                          ? {
                              ...prev,
                              angles: prev.angles.map((row) =>
                                row.id === angle.id ? { ...row, rationale: event.target.value } : row
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`angle-target-${angle.id}`}>Target Segment</Label>
                  <Textarea
                    id={`angle-target-${angle.id}`}
                    value={angle.actorQuery}
                    onChange={(event) =>
                      setBuild((prev) =>
                        prev
                          ? {
                              ...prev,
                              angles: prev.angles.map((row) =>
                                row.id === angle.id ? { ...row, actorQuery: event.target.value } : row
                              ),
                            }
                          : prev
                      )
                    }
                    placeholder="Who should we reach? role + company type"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`angle-max-leads-${angle.id}`}>Max Leads</Label>
                  <Input
                    id={`angle-max-leads-${angle.id}`}
                    type="number"
                    min={1}
                    max={500}
                    value={angle.sourceConfig.maxLeads}
                    onChange={(event) =>
                      setBuild((prev) =>
                        prev
                          ? {
                              ...prev,
                              angles: prev.angles.map((row) =>
                                row.id === angle.id
                                  ? {
                                      ...row,
                                      sourceConfig: {
                                        ...row.sourceConfig,
                                        maxLeads: Number(event.target.value || 100),
                                      },
                                    }
                                  : row
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
              </div>
            </div>
          ))}
          {!build.angles.length ? (
            <div className="text-sm text-[color:var(--muted-foreground)]">No angles yet. Add one to continue.</div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Variants</CardTitle>
            <CardDescription>Variants are testable message versions for each angle.</CardDescription>
          </div>
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() =>
              setBuild((prev) =>
                prev
                  ? {
                      ...prev,
                      variants: [emptyVariant(prev.angles[0]?.id ?? ""), ...prev.variants],
                    }
                  : prev
              )
            }
          >
            <Plus className="h-4 w-4" />
            Add Variant
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {build.variants.map((variant, index) => (
            <div key={variant.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Variant {index + 1}</div>
                <div className="flex items-center gap-1">
                  <Button asChild type="button" size="sm" variant="outline">
                    <Link href={`/brands/${brandId}/campaigns/${campaignId}/build/flows/${variant.id}`}>
                      Conversation Map
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setBuild((prev) =>
                        prev
                          ? {
                              ...prev,
                              variants: prev.variants.filter((row) => row.id !== variant.id),
                            }
                          : prev
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor={`variant-name-${variant.id}`}>Variant Name</Label>
                  <Input
                    id={`variant-name-${variant.id}`}
                    value={variant.name}
                    onChange={(event) =>
                      setBuild((prev) =>
                        prev
                          ? {
                              ...prev,
                              variants: prev.variants.map((row) =>
                                row.id === variant.id ? { ...row, name: event.target.value } : row
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`variant-angle-${variant.id}`}>Angle</Label>
                  <Select
                    id={`variant-angle-${variant.id}`}
                    value={variant.hypothesisId}
                    onChange={(event) =>
                      setBuild((prev) =>
                        prev
                          ? {
                              ...prev,
                              variants: prev.variants.map((row) =>
                                row.id === variant.id ? { ...row, hypothesisId: event.target.value } : row
                              ),
                            }
                          : prev
                      )
                    }
                  >
                    <option value="">Unassigned</option>
                    {build.angles.map((angle) => (
                      <option key={angle.id} value={angle.id}>
                        {angle.title || `Angle ${angle.id.slice(-4)}`}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor={`variant-notes-${variant.id}`}>Notes</Label>
                  <Textarea
                    id={`variant-notes-${variant.id}`}
                    value={variant.notes}
                    onChange={(event) =>
                      setBuild((prev) =>
                        prev
                          ? {
                              ...prev,
                              variants: prev.variants.map((row) =>
                                row.id === variant.id ? { ...row, notes: event.target.value } : row
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`variant-daily-cap-${variant.id}`}>Daily Cap</Label>
                  <Input
                    id={`variant-daily-cap-${variant.id}`}
                    type="number"
                    min={1}
                    value={variant.runPolicy.dailyCap}
                    onChange={(event) =>
                      setBuild((prev) =>
                        prev
                          ? {
                              ...prev,
                              variants: prev.variants.map((row) =>
                                row.id === variant.id
                                  ? {
                                      ...row,
                                      runPolicy: {
                                        ...row.runPolicy,
                                        dailyCap: Number(event.target.value || 30),
                                      },
                                    }
                                  : row
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`variant-hourly-cap-${variant.id}`}>Hourly Cap</Label>
                  <Input
                    id={`variant-hourly-cap-${variant.id}`}
                    type="number"
                    min={1}
                    value={variant.runPolicy.hourlyCap}
                    onChange={(event) =>
                      setBuild((prev) =>
                        prev
                          ? {
                              ...prev,
                              variants: prev.variants.map((row) =>
                                row.id === variant.id
                                  ? {
                                      ...row,
                                      runPolicy: {
                                        ...row.runPolicy,
                                        hourlyCap: Number(event.target.value || 6),
                                      },
                                    }
                                  : row
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
              </div>
            </div>
          ))}
          {!build.variants.length ? (
            <div className="text-sm text-[color:var(--muted-foreground)]">No variants yet. Add at least one to run.</div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <button
            type="button"
            className="text-left text-sm font-semibold underline decoration-dotted underline-offset-4"
            onClick={() => setAdvancedOpen((prev) => !prev)}
          >
            {advancedOpen ? "Hide Advanced" : "Show Advanced"}
          </button>
          <CardDescription>
            Technical mapping for power users: Angle = Hypothesis, Variant = Experiment.
          </CardDescription>
        </CardHeader>
        {advancedOpen ? (
          <CardContent className="text-xs text-[color:var(--muted-foreground)]">
            <div>Angles: {angleCount} (stored as hypotheses)</div>
            <div>Variants: {variantCount} (stored as experiments)</div>
            <div>Run controls continue to use experiment-level runtime execution.</div>
          </CardContent>
        ) : null}
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Button type="button" onClick={saveBuild} disabled={saving}>
            {saving ? "Saving..." : "Save Build"}
          </Button>
          <Button asChild type="button" variant="outline">
            <Link href={`/brands/${brandId}/campaigns/${campaignId}/run/overview`}>
              Go to Run
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
