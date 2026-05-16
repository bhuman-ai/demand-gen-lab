import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { createMission, createMissionAgentDecision, createMissionEvent, listMissions, updateMission } from "@/lib/mission-data";
import { startMission } from "@/lib/mission-orchestrator";
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
  const autopilot = body.autopilot === true;
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
      eventType: autopilot ? "autopilot_plan_generated" : "plan_generated",
      summary: autopilot
        ? "AI generated the mission plan and is starting autopilot under the default safety guardrails."
        : "AI generated an editable mission plan from the site and target customers.",
      payload: {
        model: generated.model,
        autopilot,
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
      action: autopilot ? "generate_and_autostart_mission" : "generate_mission_plan",
      rationale: autopilot
        ? "The default product promise is site, target customers, Go. The generated plan becomes the first approved safe batch while deliverability remains a launch gate."
        : "The user should edit one AI-generated plan instead of configuring experiments, targeting, and deliverability by hand.",
      riskLevel: "read",
      input: { websiteUrl, targetCustomerText },
      output: { model: generated.model, plan: generated.plan },
    });

    if (autopilot) {
      try {
        const startedMission = await startMission({
          brandId,
          missionId: mission.id,
          approvedPlan: generated.plan,
        });
        return NextResponse.json({ mission: startedMission }, { status: 201 });
      } catch (startError) {
        const message = startError instanceof Error ? startError.message : "Autopilot start failed.";
        await updateMission(brandId, mission.id, {
          status: "failed",
          lastError: message,
        }).catch(() => null);
        await createMissionEvent({
          missionId: mission.id,
          brandId,
          eventType: "autopilot_start_failed",
          summary: message,
          payload: { autopilot: true },
        }).catch(() => null);
        throw startError;
      }
    }

    return NextResponse.json({ mission }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate mission plan." },
      { status: 500 }
    );
  }
}
