import { NextResponse } from "next/server";
import {
  getOutreachAccount,
  getOutreachAccountSecrets,
  updateOutreachAccount,
} from "@/lib/outreach-data";
import { testOutreachProviders } from "@/lib/outreach-providers";

export async function POST(
  _: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await context.params;
  const account = await getOutreachAccount(accountId);
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const secrets = await getOutreachAccountSecrets(accountId);
  if (!secrets) {
    return NextResponse.json({ error: "account credentials missing" }, { status: 400 });
  }

  const result = await testOutreachProviders(account, secrets);
  const now = new Date().toISOString();

  await updateOutreachAccount(accountId, {
    lastTestAt: now,
    lastTestStatus: result.ok ? "pass" : "fail",
  });

  return NextResponse.json({ result: { ...result, testedAt: now } });
}
