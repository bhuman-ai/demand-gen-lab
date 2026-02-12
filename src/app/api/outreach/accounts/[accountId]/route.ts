import { NextResponse } from "next/server";
import {
  OutreachDataError,
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
  try {
    const { accountId } = await context.params;
    const existing = await getOutreachAccount(accountId);
    if (!existing) {
      return NextResponse.json({ error: "account not found" }, { status: 404 });
    }

    const body = asRecord(await request.json());
    const account = await updateOutreachAccount(accountId, {
      name: typeof body.name === "string" ? body.name : undefined,
      accountType:
        body.accountType === "delivery" || body.accountType === "mailbox" || body.accountType === "hybrid"
          ? body.accountType
          : undefined,
      status: body.status === "inactive" ? "inactive" : body.status === "active" ? "active" : undefined,
      config: body.config,
      credentials: body.credentials,
    });

    if (!account) {
      return NextResponse.json({ error: "account not found" }, { status: 404 });
    }

    return NextResponse.json({ account });
  } catch (err) {
    if (err instanceof OutreachDataError) {
      return NextResponse.json({ error: err.message, hint: err.hint, debug: err.debug }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Failed to update account";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await context.params;
    const deleted = await deleteOutreachAccount(accountId);
    if (!deleted) {
      return NextResponse.json({ error: "account not found" }, { status: 404 });
    }
    return NextResponse.json({ deletedId: accountId });
  } catch (err) {
    if (err instanceof OutreachDataError) {
      return NextResponse.json({ error: err.message, hint: err.hint, debug: err.debug }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Failed to delete account";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
