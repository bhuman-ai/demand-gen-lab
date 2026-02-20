import { NextResponse } from "next/server";
import {
  defaultExperimentRunPolicy,
  defaultHypothesisSourceConfig,
  getCampaignById,
  updateCampaign,
  type CampaignRecord,
  type Experiment,
  type Hypothesis,
} from "@/lib/factory-data";
import { autoQueueApprovedHypothesisRuns } from "@/lib/outreach-runtime";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function clamp01(value: unknown, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num));
}

function normalizeObjective(
  value: unknown,
  fallback: CampaignRecord["objective"]
): CampaignRecord["objective"] {
  if (!value || typeof value !== "object") return fallback;
  const row = asRecord(value);
  const scoring = asRecord(row.scoring);
  const conversionWeight = clamp01(scoring.conversionWeight, fallback.scoring.conversionWeight);
  const qualityWeight = clamp01(scoring.qualityWeight, fallback.scoring.qualityWeight);
  const replyWeight = clamp01(scoring.replyWeight, fallback.scoring.replyWeight);
  const sum = conversionWeight + qualityWeight + replyWeight || 1;
  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    goal: String(row.goal ?? fallback.goal).trim(),
    constraints: String(row.constraints ?? fallback.constraints).trim(),
    scoring: {
      conversionWeight: round(conversionWeight / sum),
      qualityWeight: round(qualityWeight / sum),
      replyWeight: round(replyWeight / sum),
    },
  };
}

function normalizeAngles(value: unknown): Hypothesis[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      const sourceConfig = asRecord(row.sourceConfig);
      return {
        id: String(row.id ?? `hyp_${Math.random().toString(36).slice(2, 8)}`),
        title: String(row.title ?? "").trim(),
        channel: String(row.channel ?? "Email").trim() || "Email",
        rationale: String(row.rationale ?? "").trim(),
        actorQuery: String(row.actorQuery ?? "").trim(),
        sourceConfig: {
          ...defaultHypothesisSourceConfig(),
          actorId: String(sourceConfig.actorId ?? "").trim(),
          actorInput:
            sourceConfig.actorInput && typeof sourceConfig.actorInput === "object"
              ? (sourceConfig.actorInput as Record<string, unknown>)
              : {},
          maxLeads: Math.max(1, Math.min(500, Number(sourceConfig.maxLeads ?? 100) || 100)),
        },
        seedInputs: Array.isArray(row.seedInputs)
          ? row.seedInputs.map((item: unknown) => String(item ?? "").trim()).filter(Boolean)
          : [],
        status: String(row.status ?? "draft") === "approved" ? "approved" : "draft",
      } satisfies Hypothesis;
    })
    .filter((row) => row.title.length > 0);
}

function normalizeVariants(value: unknown): Experiment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      const runPolicy = asRecord(row.runPolicy);
      return {
        id: String(row.id ?? `exp_${Math.random().toString(36).slice(2, 8)}`),
        hypothesisId: String(row.hypothesisId ?? "").trim(),
        name: String(row.name ?? "").trim(),
        status: ["draft", "testing", "scaling", "paused"].includes(String(row.status ?? ""))
          ? (String(row.status) as Experiment["status"])
          : "draft",
        notes: String(row.notes ?? "").trim(),
        runPolicy: {
          ...defaultExperimentRunPolicy(),
          cadence: "3_step_7_day" as const,
          dailyCap: Math.max(1, Math.min(500, Number(runPolicy.dailyCap ?? 30) || 30)),
          hourlyCap: Math.max(1, Math.min(100, Number(runPolicy.hourlyCap ?? 6) || 6)),
          timezone: String(runPolicy.timezone ?? "America/Los_Angeles").trim() || "America/Los_Angeles",
          minSpacingMinutes: Math.max(1, Math.min(120, Number(runPolicy.minSpacingMinutes ?? 8) || 8)),
        },
        executionStatus: [
          "idle",
          "queued",
          "sourcing",
          "scheduled",
          "sending",
          "monitoring",
          "paused",
          "completed",
          "failed",
        ].includes(String(row.executionStatus ?? ""))
          ? (String(row.executionStatus) as Experiment["executionStatus"])
          : "idle",
      } satisfies Experiment;
    })
    .filter((row) => row.name.length > 0);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  return NextResponse.json({
    build: {
      objective: campaign.objective,
      angles: campaign.hypotheses,
      variants: campaign.experiments,
    },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const existing = await getCampaignById(brandId, campaignId);
  if (!existing) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const body = asRecord(await request.json());
  const objective = normalizeObjective(body.objective, existing.objective);
  const angles = Array.isArray(body.angles) ? normalizeAngles(body.angles) : existing.hypotheses;
  const variants = Array.isArray(body.variants) ? normalizeVariants(body.variants) : existing.experiments;

  const campaign = await updateCampaign(brandId, campaignId, {
    objective,
    hypotheses: angles,
    experiments: variants,
    stepState: {
      ...existing.stepState,
      objectiveCompleted: Boolean(objective.goal.trim()),
      hypothesesCompleted: angles.length > 0,
      experimentsCompleted: variants.length > 0,
      currentStep: "experiments",
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  await autoQueueApprovedHypothesisRuns({
    brandId,
    campaignId,
    previous: existing,
    next: campaign,
  });

  return NextResponse.json({
    build: {
      objective: campaign.objective,
      angles: campaign.hypotheses,
      variants: campaign.experiments,
    },
  });
}
