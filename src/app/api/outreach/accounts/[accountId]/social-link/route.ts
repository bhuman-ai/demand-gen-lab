import { NextResponse } from "next/server";
import { getOutreachAccount, updateOutreachAccount } from "@/lib/outreach-data";
import { prepareYouTubeConnectUrl, YouTubeConnectError } from "@/lib/youtube-connect";
import {
  createUnipileHostedAuthLink,
  resolveUnipileSocialIdentity,
  unipileConfigured,
  unipileProvidersForPlatforms,
} from "@/lib/unipile";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function appOrigin(request: Request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function notifySecret() {
  return String(process.env.UNIPILE_NOTIFY_SECRET ?? process.env.AUTH_SESSION_SECRET ?? "").trim();
}

function redirectPathForBrand(brandId: string, accountId: string) {
  const path = brandId
    ? `/brands/${encodeURIComponent(brandId)}/social-discovery`
    : "/settings/outreach";
  return `${path}?linkedAccount=${encodeURIComponent(accountId)}`;
}

function requestedPlatforms(
  body: Record<string, unknown>,
  account: NonNullable<Awaited<ReturnType<typeof getOutreachAccount>>>
) {
  if (Array.isArray(body.platforms)) {
    return body.platforms.map((entry) => String(entry ?? "").trim().toLowerCase()).filter(Boolean);
  }
  return account.config.social.platforms.map((entry) => String(entry ?? "").trim().toLowerCase()).filter(Boolean);
}

function wantsYouTubeConnect(
  body: Record<string, unknown>,
  account: NonNullable<Awaited<ReturnType<typeof getOutreachAccount>>>
) {
  const platforms = requestedPlatforms(body, account);
  return (
    platforms.includes("youtube") ||
    account.config.social.connectionProvider === "youtube" ||
    account.config.social.linkedProvider === "youtube"
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await context.params;
    const account = await getOutreachAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "account not found" }, { status: 404 });
    }

    const body = asRecord(await request.json().catch(() => ({})));
    const action = String(body.action ?? "create_link").trim().toLowerCase();

    if (action === "sync") {
      const externalAccountId = String(
        body.externalAccountId ?? body.external_account_id ?? account.config.social.externalAccountId ?? ""
      ).trim();
      if (!externalAccountId) {
        return NextResponse.json({ error: "No Unipile account id is linked yet." }, { status: 400 });
      }
      const syncedSocial = await resolveUnipileSocialIdentity(externalAccountId);
      const updated = await updateOutreachAccount(accountId, {
        config: {
          social: {
            ...syncedSocial,
            connectionProvider: "unipile",
            externalAccountId,
            enabled: account.config.social.enabled || Boolean(account.config.social.handle.trim()),
            linkedAt: account.config.social.linkedAt || syncedSocial.linkedAt,
          },
        },
      });
      return NextResponse.json({ account: updated });
    }

    if (action !== "create_link") {
      return NextResponse.json({ error: "unsupported action" }, { status: 400 });
    }

    const brandId = String(body.brandId ?? body.brand_id ?? "").trim();
    if (wantsYouTubeConnect(body, account)) {
      const url = await prepareYouTubeConnectUrl({
        accountId,
        brandId,
      });
      return NextResponse.json({
        url,
        provider: "youtube",
      });
    }

    if (!unipileConfigured()) {
      return NextResponse.json({ error: "UNIPILE_API_KEY is not configured." }, { status: 500 });
    }

    const origin = appOrigin(request);
    const providers = unipileProvidersForPlatforms(requestedPlatforms(body, account));
    const nextProviders = providers.length ? providers : ["LINKEDIN", "INSTAGRAM", "TWITTER"];
    const redirectPath = redirectPathForBrand(brandId, accountId);
    const successRedirectUrl = `${origin}${redirectPath}&unipile=success`;
    const failureRedirectUrl = `${origin}${redirectPath}&unipile=failure`;
    const token = notifySecret();
    const notifyUrl = new URL(`${origin}/api/webhooks/unipile/accounts`);
    if (token) notifyUrl.searchParams.set("token", token);

    const payload = await createUnipileHostedAuthLink({
      name: `outreach:${accountId}`,
      providers: nextProviders,
      notifyUrl: notifyUrl.toString(),
      successRedirectUrl,
      failureRedirectUrl,
      bypassSuccessScreen: true,
    });

    return NextResponse.json({
      url: String(payload.url ?? "").trim(),
      providers: nextProviders,
      expiresOn: String(payload.expiresOn ?? "").trim(),
    });
  } catch (error) {
    if (error instanceof YouTubeConnectError) {
      return NextResponse.json(
        {
          error: error.message,
          ...(error.errorCode ? { errorCode: error.errorCode } : {}),
          ...(error.missingFields?.length ? { missingFields: error.missingFields } : {}),
        },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to prepare Unipile link" },
      { status: 500 }
    );
  }
}
