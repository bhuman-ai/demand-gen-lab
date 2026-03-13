import { NextResponse } from "next/server";
import { getExperimentRecordById } from "@/lib/experiment-data";
import {
  buildExperimentProspectTableConfig,
  ensureEnrichAnythingProspectTable,
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
