import { NextResponse } from "next/server";
import { getExperimentRecordById } from "@/lib/experiment-data";

export async function POST(
  _: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;
  const experiment = await getExperimentRecordById(brandId, experimentId);
  if (!experiment) {
    return NextResponse.json({ error: "experiment not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      error: "CSV lead imports are disabled.",
      hint: "Use the EnrichAnything prospect table for this experiment. lastb2b only sends from approved EnrichAnything rows.",
    },
    { status: 400 }
  );
}
