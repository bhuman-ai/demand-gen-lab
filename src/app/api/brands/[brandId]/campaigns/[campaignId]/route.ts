import { NextResponse } from "next/server";
import {
  defaultExperimentRunPolicy,
  defaultHypothesisSourceConfig,
  deleteCampaign,
  getCampaignById,
  type CampaignRecord,
  type EvolutionSnapshot,
  type Experiment,
  type Hypothesis,
  updateCampaign,
} from "@/lib/factory-data";
import { autoQueueApprovedHypothesisRuns } from "@/lib/outreach-runtime";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeHypotheses(value: unknown): Hypothesis[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      const status: Hypothesis["status"] = String(row.status ?? "draft") === "approved" ? "approved" : "draft";
      const sourceConfig = asRecord(row.sourceConfig);
      return {
        id: String(row.id ?? `hyp_${Math.random().toString(36).slice(2, 8)}`),
        title: String(row.title ?? "").trim(),
        channel: String(row.channel ?? "").trim(),
        rationale: String(row.rationale ?? "").trim(),
        actorQuery: String(row.actorQuery ?? "").trim(),
        sourceConfig: {
          ...defaultHypothesisSourceConfig(),
          actorId: String(sourceConfig.actorId ?? row.actorId ?? "").trim(),
          actorInput:
            sourceConfig.actorInput && typeof sourceConfig.actorInput === "object"
              ? (sourceConfig.actorInput as Record<string, unknown>)
              : {},
          maxLeads: Number(sourceConfig.maxLeads ?? row.maxLeads ?? 100),
        },
        seedInputs: Array.isArray(row.seedInputs)
          ? row.seedInputs.map((item: unknown) => String(item ?? "").trim()).filter(Boolean)
          : [],
        status,
      };
    })
    .filter((row) => row.title.length > 0);
}

function normalizeExperiments(value: unknown): Experiment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      const runPolicy = asRecord(row.runPolicy);
      return {
        id: String(row.id ?? `exp_${Math.random().toString(36).slice(2, 8)}`),
        hypothesisId: String(row.hypothesisId ?? ""),
        name: String(row.name ?? "").trim(),
        status: ["draft", "testing", "scaling", "paused"].includes(String(row.status ?? ""))
          ? (String(row.status) as Experiment["status"])
          : "draft",
        notes: String(row.notes ?? "").trim(),
        runPolicy: {
          ...defaultExperimentRunPolicy(),
          cadence: "3_step_7_day" as const,
          dailyCap: Number(runPolicy.dailyCap ?? 30),
          hourlyCap: Number(runPolicy.hourlyCap ?? 6),
          timezone: String(runPolicy.timezone ?? "America/Los_Angeles"),
          minSpacingMinutes: Number(runPolicy.minSpacingMinutes ?? 8),
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
        ].includes(String(row.executionStatus))
          ? (String(row.executionStatus) as Experiment["executionStatus"])
          : "idle",
      };
    })
    .filter((row) => row.name.length > 0);
}

function normalizeEvolution(value: unknown): EvolutionSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      return {
        id: String(row.id ?? `evo_${Math.random().toString(36).slice(2, 8)}`),
        title: String(row.title ?? "").trim(),
        summary: String(row.summary ?? "").trim(),
        status: ["observing", "winner", "killed"].includes(String(row.status ?? ""))
          ? (String(row.status) as EvolutionSnapshot["status"])
          : "observing",
      };
    })
    .filter((row) => row.title.length > 0);
}

function normalizeStepState(
  current: CampaignRecord["stepState"],
  value: unknown
): CampaignRecord["stepState"] {
  if (!value || typeof value !== "object") return current;
  const row = value as Record<string, unknown>;
  return {
    objectiveCompleted: Boolean(row.objectiveCompleted ?? current.objectiveCompleted),
    hypothesesCompleted: Boolean(row.hypothesesCompleted ?? current.hypothesesCompleted),
    experimentsCompleted: Boolean(row.experimentsCompleted ?? current.experimentsCompleted),
    evolutionCompleted: Boolean(row.evolutionCompleted ?? current.evolutionCompleted),
    currentStep: ["objective", "hypotheses", "experiments", "evolution"].includes(
      String(row.currentStep ?? "")
    )
      ? (String(row.currentStep) as CampaignRecord["stepState"]["currentStep"])
      : current.currentStep,
  };
}

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }
  return NextResponse.json({ campaign });
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
  const patch: Partial<
    Pick<
      CampaignRecord,
      "name" | "status" | "objective" | "hypotheses" | "experiments" | "evolution" | "stepState"
    >
  > = {};

  if (typeof body.name === "string") patch.name = body.name.trim();
  if (["draft", "active", "paused"].includes(String(body.status ?? ""))) {
    patch.status = body.status as CampaignRecord["status"];
  }
  if (body.objective && typeof body.objective === "object") {
    const objective = asRecord(body.objective);
    const scoring = asRecord(objective.scoring);
    patch.objective = {
      goal: String(objective.goal ?? existing.objective.goal),
      constraints: String(objective.constraints ?? existing.objective.constraints),
      scoring: {
        conversionWeight: Number(scoring.conversionWeight ?? existing.objective.scoring.conversionWeight),
        qualityWeight: Number(scoring.qualityWeight ?? existing.objective.scoring.qualityWeight),
        replyWeight: Number(scoring.replyWeight ?? existing.objective.scoring.replyWeight),
      },
    };
  }
  if (Array.isArray(body.hypotheses)) patch.hypotheses = normalizeHypotheses(body.hypotheses);
  if (Array.isArray(body.experiments)) patch.experiments = normalizeExperiments(body.experiments);
  if (Array.isArray(body.evolution)) patch.evolution = normalizeEvolution(body.evolution);
  if (body.stepState) patch.stepState = normalizeStepState(existing.stepState, body.stepState);

  const campaign = await updateCampaign(brandId, campaignId, patch);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  await autoQueueApprovedHypothesisRuns({
    brandId,
    campaignId,
    previous: existing,
    next: campaign,
  });

  return NextResponse.json({ campaign });
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const deleted = await deleteCampaign(brandId, campaignId);
  if (!deleted) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }
  return NextResponse.json({ deletedId: campaignId });
}
