import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import {
  deleteExperimentRecord,
  getExperimentRecordById,
  updateExperimentRecord,
} from "@/lib/experiment-data";
import { clampExperimentSampleSize } from "@/lib/experiment-policy";
import type { ExperimentRecord } from "@/lib/factory-types";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const experiment = await getExperimentRecordById(brandId, experimentId);
  if (!experiment) {
    return NextResponse.json({ error: "experiment not found" }, { status: 404 });
  }

  return NextResponse.json({ experiment });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const body = asRecord(await request.json());
  const patch: Partial<
    Pick<
      ExperimentRecord,
      "name" | "status" | "offer" | "audience" | "testEnvelope" | "successMetric" | "promotedCampaignId"
    >
  > = {};

  if (typeof body.name === "string") patch.name = body.name;
  if (
    ["draft", "ready", "running", "paused", "completed", "promoted", "archived"].includes(
      String(body.status ?? "")
    )
  ) {
    patch.status = body.status as ExperimentRecord["status"];
  }
  if (typeof body.offer === "string") patch.offer = body.offer;
  if (typeof body.audience === "string") patch.audience = body.audience;

  if (body.testEnvelope && typeof body.testEnvelope === "object") {
    const row = asRecord(body.testEnvelope);
    const parsedBusinessDays = Array.isArray(row.businessDays)
      ? row.businessDays
          .map((entry) => Math.round(Number(entry)))
          .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 6)
      : [1, 2, 3, 4, 5];
    const businessDays = Array.from(new Set(parsedBusinessDays)).sort((a, b) => a - b);
    patch.testEnvelope = {
      sampleSize: clampExperimentSampleSize(row.sampleSize),
      durationDays: Math.max(1, Number(row.durationDays ?? 7)),
      dailyCap: Math.max(1, Number(row.dailyCap ?? 30)),
      hourlyCap: Math.max(1, Number(row.hourlyCap ?? 6)),
      timezone: String(row.timezone ?? "America/Los_Angeles"),
      minSpacingMinutes: Math.max(1, Number(row.minSpacingMinutes ?? 8)),
      oneContactPerCompany: row.oneContactPerCompany !== false,
      businessHoursEnabled: row.businessHoursEnabled !== false,
      businessHoursStartHour: Math.max(0, Math.min(23, Math.round(Number(row.businessHoursStartHour ?? 9) || 9))),
      businessHoursEndHour: Math.max(1, Math.min(24, Math.round(Number(row.businessHoursEndHour ?? 17) || 17))),
      businessDays: businessDays.length ? businessDays : [1, 2, 3, 4, 5],
    };
  }

  if (body.successMetric && typeof body.successMetric === "object") {
    const row = asRecord(body.successMetric);
    patch.successMetric = {
      metric: "reply_rate",
      thresholdPct: Math.max(0, Number(row.thresholdPct ?? 5)),
    };
  }

  if (typeof body.promotedCampaignId === "string") {
    patch.promotedCampaignId = body.promotedCampaignId;
  }

  const experiment = await updateExperimentRecord(brandId, experimentId, patch);
  if (!experiment) {
    return NextResponse.json({ error: "experiment not found" }, { status: 404 });
  }

  return NextResponse.json({ experiment });
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;
  const deleted = await deleteExperimentRecord(brandId, experimentId);
  if (!deleted) {
    return NextResponse.json({ error: "experiment not found" }, { status: 404 });
  }
  return NextResponse.json({ deletedId: experimentId });
}
