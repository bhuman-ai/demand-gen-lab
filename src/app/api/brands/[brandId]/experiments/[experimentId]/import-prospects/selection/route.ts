import { NextResponse } from "next/server";
import { importExperimentProspectRows } from "@/lib/experiment-prospect-import";

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];

  try {
    const origin = new URL(request.url).origin;
    const result = await importExperimentProspectRows({
      brandId,
      experimentId,
      rows,
      requestOrigin: origin,
      tableTitle: String(body.tableTitle ?? ""),
      prompt: String(body.prompt ?? ""),
      entityType: String(body.entityType ?? ""),
    });

    if (result.importedCount <= 0) {
      return NextResponse.json(result, { status: 200 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No importable prospects were found.";

    if (message === "experiment not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    if (message === "experiment runtime is not configured") {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: "No importable prospects were found.",
        hint: message,
      },
      { status: 400 }
    );
  }
}
