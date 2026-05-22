import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { createMission, createMissionAgentDecision, createMissionEvent, listMissions } from "@/lib/mission-data";
import { generateMissionPlan } from "@/lib/mission-plan-generation";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET(_: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const missions = await listMissions(brandId);
  return NextResponse.json({ missions });
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId, { includeEmbedded: true });
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const websiteUrl = String(body.websiteUrl ?? body.website ?? brand.website ?? "").trim();
  const targetCustomerText = String(body.targetCustomerText ?? "").trim();
  if (!websiteUrl) {
    return NextResponse.json({ error: "Website URL is required." }, { status: 400 });
  }
  if (!targetCustomerText) {
    return NextResponse.json({ error: "Target customers are required." }, { status: 400 });
  }

  try {
    const generated = await generateMissionPlan({ brand, websiteUrl, targetCustomerText });
    const mission = await createMission({
      brandId,
      websiteUrl: generated.website.url,
      targetCustomerText,
      generatedPlan: generated.plan,
      status: "plan_ready",
    });
    await createMissionEvent({
      missionId: mission.id,
      brandId,
      eventType: "plan_generated",
      summary: "AI generated an editable mission plan from the site and target customers.",
      payload: {
        model: generated.model,
        website: {
          url: generated.website.url,
          hostname: generated.website.hostname,
          title: generated.website.title,
          description: generated.website.description,
        },
      },
    });
    await createMissionAgentDecision({
      missionId: mission.id,
      brandId,
      agent: "mission_operator",
      action: "generate_mission_plan",
      rationale: "The user should edit one AI-generated plan instead of configuring experiments, targeting, and deliverability by hand.",
      riskLevel: "read",
      input: { websiteUrl, targetCustomerText },
      output: { model: generated.model, plan: generated.plan },
    });
    return NextResponse.json({ mission }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate mission plan." },
      { status: 500 }
    );
  }
}
