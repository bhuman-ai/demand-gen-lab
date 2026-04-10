import { NextResponse } from "next/server";
import { getSavedOutreachFlowResult, saveOutreachFlowResult } from "@/lib/outreach-flow-result-data";
import {
  runOutreachFlowTournament,
  serializeOutreachFlowTournamentError,
} from "@/lib/outreach-flow-tournament";
import type {
  OutreachFlowTournamentInput,
  OutreachFlowTournamentResult,
} from "@/lib/factory-types";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ brandId: string }> }) {
  try {
    const { brandId } = await context.params;
    const savedResult = await getSavedOutreachFlowResult(brandId);
    return NextResponse.json({ savedResult });
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

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  try {
    const { brandId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as OutreachFlowTournamentInput;
    const tournament = await runOutreachFlowTournament({
      brandId,
      brief: body,
      signal: request.signal,
    });
    const savedResult = await saveOutreachFlowResult({
      brandId,
      brief: tournament.brief,
      result: tournament.result,
    });
    return NextResponse.json({ brief: tournament.brief, result: tournament.result, savedResult });
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

export async function PUT(request: Request, context: { params: Promise<{ brandId: string }> }) {
  try {
    const { brandId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      brief?: OutreachFlowTournamentInput;
      result?: OutreachFlowTournamentResult;
    };
    const brief = body?.brief ?? ({} as OutreachFlowTournamentInput);
    const result = body?.result;

    if (!result || typeof result !== "object") {
      return NextResponse.json({ error: "Missing outreach-flow result." }, { status: 400 });
    }

    const savedResult = await saveOutreachFlowResult({
      brandId,
      brief,
      result,
    });

    return NextResponse.json({ savedResult });
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
