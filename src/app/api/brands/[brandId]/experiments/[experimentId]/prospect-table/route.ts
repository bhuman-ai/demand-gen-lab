import { NextResponse } from "next/server";
import { getExperimentRecordById } from "@/lib/experiment-data";
import {
  buildExperimentProspectTableConfig,
  ensureEnrichAnythingProspectTable,
  runEnrichAnythingProspectTable,
  updateEnrichAnythingProspectTableDiscovery,
} from "@/lib/enrichanything-live-table";

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  try {
    const { brandId, experimentId } = await context.params;
    const experiment = await getExperimentRecordById(brandId, experimentId);
    if (!experiment) {
      return NextResponse.json({ error: "experiment not found" }, { status: 404 });
    }

    const config = await ensureEnrichAnythingProspectTable(
      buildExperimentProspectTableConfig(experiment)
    );
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to prepare prospect table",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  try {
    const { brandId, experimentId } = await context.params;
    const experiment = await getExperimentRecordById(brandId, experimentId);
    if (!experiment) {
      return NextResponse.json({ error: "experiment not found" }, { status: 404 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const discoveryPrompt = String(body.discoveryPrompt ?? "").trim();
    const discoveryMeta =
      body.discoveryMeta && typeof body.discoveryMeta === "object" && !Array.isArray(body.discoveryMeta)
        ? (body.discoveryMeta as Record<string, unknown>)
        : null;

    const config = buildExperimentProspectTableConfig(experiment);
    const table = await updateEnrichAnythingProspectTableDiscovery(config, {
      discoveryPrompt: discoveryPrompt || config.discoveryPrompt,
      discoveryMeta,
    });

    return NextResponse.json(table);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to update prospect table",
      },
      { status: 500 }
    );
  }
}

export async function POST(
  _: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  try {
    const { brandId, experimentId } = await context.params;
    const experiment = await getExperimentRecordById(brandId, experimentId);
    if (!experiment) {
      return NextResponse.json({ error: "experiment not found" }, { status: 404 });
    }

    const config = buildExperimentProspectTableConfig(experiment);
    await ensureEnrichAnythingProspectTable(config);
    const table = await runEnrichAnythingProspectTable(config);
    return NextResponse.json(table);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to run prospect table",
      },
      { status: 500 }
    );
  }
}
