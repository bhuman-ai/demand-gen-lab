import { NextResponse } from "next/server";
import { getBrandById, updateBrand } from "@/lib/factory-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function expectedSecret() {
  return (
    String(process.env.LIFTLINE_AUTOPILOT_WEBHOOK_SECRET ?? "").trim() ||
    String(process.env.LIFTLINE_WEBHOOK_SECRET ?? "").trim()
  );
}

function suppliedSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return (
    String(request.headers.get("x-liftline-secret") ?? "").trim() ||
    authorization.replace(/^Bearer\s+/i, "").trim()
  );
}

function strings(value: unknown, limit = 12) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean))
  ).slice(0, limit);
}

function contextualCommentPrompt(input: {
  brandName: string;
  positioning: string;
  voice: string;
  voiceSample: string;
  maximumSharePercent: number;
}) {
  return [
    "Write one short, platform-native comment that is genuinely useful to the exact conversation.",
    "The answer must work even if the brand name is removed.",
    "Brand name: " + input.brandName,
    "Brand positioning: " + input.positioning,
    "Voice preset: " + input.voice,
    "Voice example: " + input.voiceSample,
    "Contextual mention policy:",
    "- Mention the exact brand only when heuristic_mention_policy is possible_soft_mention and the brand directly helps the answer.",
    "- Keep brand mentions at or below " + input.maximumSharePercent + "% of qualified comments across the campaign.",
    "- If the mention would feel forced, promotional, repetitive, or unsupported, write a useful no-mention comment or return shouldComment=false.",
    "- Never add a link unless the person explicitly asks for one.",
    "- Never call the comment a backlink or promise search-ranking impact.",
    "- Never fake personal experience, customer status, or product results.",
    "- When the brand appears, mention it exactly once and keep it incidental.",
  ].join("\n");
}

export async function POST(request: Request) {
  const expected = expectedSecret();
  if (!expected || suppliedSecret(request) !== expected) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const setup = asRecord(body.setup);
  const autopilot = asRecord(body.autopilot);
  const backend = asRecord(body.backend);
  const tenant = asRecord(setup.tenant);
  const commentVoice = asRecord(autopilot.commentVoice);
  const brandMention = asRecord(autopilot.brandMention);
  const account = asRecord(setup.account);
  const connections = asRecord(account.connections);
  const brandId = String(backend.brandId ?? "").trim();
  const setupId = String(setup.setupId ?? "").trim();

  if (!brandId) {
    return NextResponse.json({ ok: false, message: "Backend brand is required." }, { status: 400 });
  }

  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ ok: false, message: "Backend brand was not found." }, { status: 404 });
  }

  const targets = strings(autopilot.targets ?? setup.targets);
  const platforms = strings(autopilot.platforms ?? setup.platforms).filter(
    (platform) => platform === "instagram" || platform === "youtube"
  );
  const requestedBrandName =
    String(brandMention.exactBrandName ?? tenant.brandName ?? "").trim() || brand.name;
  const positioning = String(brandMention.positioning ?? setup.brandSummary ?? "").trim();
  const maximumSharePercent = Math.min(
    50,
    Math.max(10, Number(brandMention.maximumSharePercent) || 35)
  );
  const active = setup.status !== "paused";
  const youtubeConnected = connections.youtube === true;

  const updated = await updateBrand(brandId, {
    socialDiscoveryCommentPrompt: contextualCommentPrompt({
      brandName: requestedBrandName,
      positioning,
      voice: String(commentVoice.preset ?? setup.voice ?? "Warm").trim(),
      voiceSample: String(commentVoice.sample ?? setup.voiceSample ?? "").trim(),
      maximumSharePercent,
    }),
    socialDiscoveryPlatforms: platforms.length ? platforms : ["youtube"],
    socialDiscoveryQueries: targets,
    socialDiscoveryYouTubeAutoCommentEnabled:
      active && youtubeConnected && platforms.includes("youtube"),
  });

  if (!updated) {
    return NextResponse.json({ ok: false, message: "Campaign could not be saved." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    setupId,
    mode: "webhook",
    bridgeStatus: "accepted",
    message: youtubeConnected
      ? "Brand-mention campaign accepted."
      : "Campaign saved. Connect YouTube before automatic posting starts.",
    backendBrandId: updated.id,
    proof: [
      {
        label: "Watching relevant conversations",
        detail: targets.slice(0, 3).join(", ") || "Campaign targets saved",
        time: "Now",
      },
      {
        label: "Contextual mention policy",
        detail: "Useful first / mention at most " + maximumSharePercent + "% / skip when unnatural",
        time: "Ready",
      },
    ],
  });
}
