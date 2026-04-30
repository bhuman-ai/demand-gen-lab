import { NextResponse } from "next/server";
import {
  OutreachDataError,
  createOutreachAccount,
  getOutreachAccountSecrets,
  getOutreachAccountLookupDebug,
  listOutreachAccounts,
  listSocialRoutingAccounts,
} from "@/lib/outreach-data";
import { checkYouTubeOAuthCredentials } from "@/lib/youtube";
import type { OutreachAccount } from "@/lib/factory-types";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isYouTubeSocialAccount(account: OutreachAccount) {
  return (
    account.config.social.connectionProvider === "youtube" ||
    account.config.social.linkedProvider === "youtube" ||
    account.config.social.platforms.includes("youtube")
  );
}

async function withSocialCredentialHealth(accounts: OutreachAccount[]) {
  return Promise.all(
    accounts.map(async (account) => {
      if (!isYouTubeSocialAccount(account)) return account;

      const checkedAt = new Date().toISOString();
      const secrets = await getOutreachAccountSecrets(account.id).catch(() => null);
      if (!secrets) {
        return {
          ...account,
          socialCredentialHealth: {
            provider: "youtube" as const,
            status: "needs_sign_in" as const,
            message: "Missing YouTube sign-in credentials.",
            checkedAt,
          },
        };
      }

      const health = await checkYouTubeOAuthCredentials(secrets);
      return {
        ...account,
        socialCredentialHealth: {
          provider: "youtube" as const,
          status: health.ok ? ("connected" as const) : ("needs_sign_in" as const),
          message: health.message,
          checkedAt,
        },
      };
    })
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope");
    const baseAccounts = scope === "social" ? await listSocialRoutingAccounts() : await listOutreachAccounts();
    const accounts = scope === "social" ? await withSocialCredentialHealth(baseAccounts) : baseAccounts;
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
      provider: body.provider === "mailpool" ? "mailpool" : "customerio",
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
