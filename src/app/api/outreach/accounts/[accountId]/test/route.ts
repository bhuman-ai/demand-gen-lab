import { NextResponse } from "next/server";
import {
  OutreachDataError,
  getOutreachAccountLookupDebug,
  getOutreachAccount,
  getOutreachAccountSecrets,
  updateOutreachAccount,
} from "@/lib/outreach-data";
import { testOutreachProviders, type ProviderTestScope } from "@/lib/outreach-providers";

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await context.params;
    const account = await getOutreachAccount(accountId);
    if (!account) {
      const debug = await getOutreachAccountLookupDebug(accountId);
      return NextResponse.json(
        {
          error: "account not found",
          hint:
            "Account lookup failed on this runtime. If credentials were just created, ensure Supabase writes are succeeding and schema migrations are applied.",
          debug,
        },
        { status: 404 }
      );
    }

    const secrets = await getOutreachAccountSecrets(accountId);
    if (!secrets) {
      const debug = await getOutreachAccountLookupDebug(accountId);
      return NextResponse.json(
        {
          error: "account credentials missing",
          hint: "Account exists but encrypted credentials were not found for this record.",
          debug,
        },
        { status: 400 }
      );
    }

    const url = new URL(request.url);
    const scopeParam = String(url.searchParams.get("scope") ?? "").trim();
    const scope: ProviderTestScope =
      scopeParam === "customerio" || scopeParam === "mailbox" ? scopeParam : "full";

    const result = await testOutreachProviders(account, secrets, scope);
    const now = new Date().toISOString();

    await updateOutreachAccount(accountId, {
      lastTestAt: now,
      lastTestStatus: result.ok ? "pass" : "fail",
    });

    return NextResponse.json({ result: { ...result, testedAt: now } });
  } catch (err) {
    if (err instanceof OutreachDataError) {
      return NextResponse.json({ error: err.message, hint: err.hint, debug: err.debug }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Outreach account test failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
