import { NextResponse } from "next/server";
import { OutreachDataError, getOutreachAccountLookupDebug } from "@/lib/outreach-data";
import { refreshMailpoolOutreachAccount } from "@/lib/mailpool-account-refresh";

export async function POST(
  _request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await context.params;
    const result = await refreshMailpoolOutreachAccount(accountId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OutreachDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const { accountId } = await context.params;
    const message = error instanceof Error ? error.message : "Mailpool refresh failed";
    const status = message === "Mailpool outreach account not found" ? 404 : message.startsWith("Only Mailpool") ? 400 : 500;
    const debug = status === 404 ? await getOutreachAccountLookupDebug(accountId) : undefined;
    return NextResponse.json({ error: message, debug }, { status });
  }
}
