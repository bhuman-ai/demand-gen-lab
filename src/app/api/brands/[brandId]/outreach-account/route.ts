import { NextResponse } from "next/server";
import {
  getBrandOutreachAssignment,
  getOutreachAccount,
  setBrandOutreachAssignment,
} from "@/lib/outreach-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await context.params;
  const assignment = await getBrandOutreachAssignment(brandId);
  if (!assignment) {
    return NextResponse.json({ assignment: null, account: null });
  }

  const account = await getOutreachAccount(assignment.accountId);
  return NextResponse.json({ assignment, account });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await context.params;
  const body = asRecord(await request.json());
  const accountId = String(body.accountId ?? "").trim();

  if (accountId) {
    const account = await getOutreachAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "account not found" }, { status: 404 });
    }
  }

  const assignment = await setBrandOutreachAssignment(brandId, accountId);
  const account = assignment ? await getOutreachAccount(assignment.accountId) : null;
  return NextResponse.json({ assignment, account });
}
