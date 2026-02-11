import { NextResponse } from "next/server";
import {
  deleteOutreachAccount,
  getOutreachAccount,
  updateOutreachAccount,
} from "@/lib/outreach-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await context.params;
  const existing = await getOutreachAccount(accountId);
  if (!existing) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const body = asRecord(await request.json());
  const account = await updateOutreachAccount(accountId, {
    name: typeof body.name === "string" ? body.name : undefined,
    status: body.status === "inactive" ? "inactive" : body.status === "active" ? "active" : undefined,
    config: body.config,
    credentials: body.credentials,
  });

  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  return NextResponse.json({ account });
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await context.params;
  const deleted = await deleteOutreachAccount(accountId);
  if (!deleted) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }
  return NextResponse.json({ deletedId: accountId });
}
