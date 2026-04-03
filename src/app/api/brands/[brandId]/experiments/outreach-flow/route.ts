import { NextResponse } from "next/server";
import {
  runOutreachFlowTournament,
  serializeOutreachFlowTournamentError,
} from "@/lib/outreach-flow-tournament";
import type { OutreachFlowTournamentInput } from "@/lib/factory-types";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  try {
    const { brandId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as OutreachFlowTournamentInput;
    const result = await runOutreachFlowTournament({
      brandId,
      brief: body,
      signal: request.signal,
    });
    return NextResponse.json({ result });
  } catch (error) {
    const payload = serializeOutreachFlowTournamentError(error);
    return NextResponse.json(
      {
        error: payload.error,
        hint: payload.hint,
        debug: payload.debug,
      },
      { status: payload.status }
    );
  }
}
