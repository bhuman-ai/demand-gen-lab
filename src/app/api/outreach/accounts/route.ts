import { NextResponse } from "next/server";
import {
  OutreachDataError,
  createOutreachAccount,
  getOutreachAccountLookupDebug,
  listOutreachAccounts,
} from "@/lib/outreach-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET() {
  try {
    const accounts = await listOutreachAccounts();
    return NextResponse.json({ accounts });
  } catch (err) {
    if (err instanceof OutreachDataError) {
      return NextResponse.json({ error: err.message, hint: err.hint, debug: err.debug }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Failed to list accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = asRecord(await request.json());
    const name = String(body.name ?? "").trim();

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const account = await createOutreachAccount({
      name,
      accountType:
        body.accountType === "delivery" || body.accountType === "mailbox" || body.accountType === "hybrid"
          ? body.accountType
          : "hybrid",
      status: String(body.status ?? "active") === "inactive" ? "inactive" : "active",
      config: body.config,
      credentials: body.credentials,
    });

    const debug = await getOutreachAccountLookupDebug(account.id);
    const hint =
      debug.supabaseConfigured && !debug.supabaseHasAccount && debug.localHasAccount
        ? "Created in local fallback only. This can cause cross-instance lookup failures on serverless. Check Supabase write errors/migrations."
        : "";

    return NextResponse.json({ account, debug, hint }, { status: 201 });
  } catch (err) {
    if (err instanceof OutreachDataError) {
      return NextResponse.json({ error: err.message, hint: err.hint, debug: err.debug }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Failed to create account";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
