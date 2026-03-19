import { NextResponse } from "next/server";
import { countExperimentSendableLeadContacts } from "@/lib/experiment-prospect-import";

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;
  const summary = await countExperimentSendableLeadContacts(brandId, experimentId);
  return NextResponse.json(summary);
}
