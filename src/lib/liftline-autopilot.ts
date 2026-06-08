import { getBrandById, updateBrand, type BrandRecord } from "@/lib/factory-data";
import type { OutreachAccount } from "@/lib/factory-types";
import { getOutreachAccountSecrets, listSocialRoutingAccounts } from "@/lib/outreach-data";
import { checkYouTubeOAuthCredentials, hasYouTubeOAuthCredentials } from "@/lib/youtube";

type LiftlinePlatform = "instagram" | "youtube";
type LiftlinePlanId = "starter" | "growth" | "scale";

type LiftlinePlan = {
  id: LiftlinePlanId;
  name: string;
  dailyCommentLimit: number;
  accountLimit: number;
};

export type LiftlineProofEvent = {
  label: string;
  detail: string;
  time: string;
};

export class LiftlineAutopilotError extends Error {
  status: number;
  proof: LiftlineProofEvent[];
  backendBrandId: string;

  constructor(
    message: string,
    input: {
      status?: number;
      proof?: LiftlineProofEvent[];
      backendBrandId?: string;
    } = {}
  ) {
    super(message);
    this.name = "LiftlineAutopilotError";
    this.status = input.status ?? 500;
    this.proof = input.proof ?? [];
    this.backendBrandId = input.backendBrandId ?? "";
  }
}

const PLANS: Record<LiftlinePlanId, LiftlinePlan> = {
  starter: {
    id: "starter",
    name: "Starter",
    dailyCommentLimit: 10,
    accountLimit: 1,
  },
  growth: {
    id: "growth",
    name: "Growth",
    dailyCommentLimit: 30,
    accountLimit: 3,
  },
  scale: {
    id: "scale",
    name: "Scale",
    dailyCommentLimit: 75,
    accountLimit: 10,
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeStringArray(value: unknown, fallback: string[] = []) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n|,/) : fallback;
  return raw
    .map((entry) => String(entry ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizePlatforms(value: unknown, fallback: LiftlinePlatform[] = ["instagram", "youtube"]) {
  const platforms = normalizeStringArray(value, fallback)
    .map((platform) => platform.toLowerCase())
    .filter((platform): platform is LiftlinePlatform => platform === "instagram" || platform === "youtube");
  return uniqueStrings(platforms).length ? (uniqueStrings(platforms) as LiftlinePlatform[]) : fallback;
}

function normalizePlan(value: unknown): LiftlinePlan {
  const row = asRecord(value);
  const id = String(row.id ?? row.planId ?? row.plan_id ?? value ?? "").trim().toLowerCase();
  if (id === "starter" || id === "scale" || id === "growth") return PLANS[id];
  return PLANS.growth;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? Math.round(parsed) : fallback));
}

function bridgeSecret() {
  return String(
    process.env.LIFTLINE_AUTOPILOT_WEBHOOK_SECRET ??
      process.env.LIFTLINE_WEBHOOK_SECRET ??
      ""
  ).trim();
}

function allowMissingSecret() {
  return process.env.NODE_ENV !== "production";
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export function isLiftlineAutopilotAuthorized(request: Request) {
  const secret = bridgeSecret();
  if (!secret) return allowMissingSecret();
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const headerSecret = request.headers.get("x-liftline-secret")?.trim() ?? "";
  return safeEqual(bearer, secret) || safeEqual(headerSecret, secret);
}

function hasInstagramConnection(account: OutreachAccount) {
  const social = account.config.social;
  return (
    account.status === "active" &&
    social.enabled &&
    social.connectionProvider === "unipile" &&
    Boolean(social.externalAccountId.trim()) &&
    (social.linkedProvider === "instagram" || social.platforms.includes("instagram"))
  );
}

function isYouTubeConnection(account: OutreachAccount) {
  const social = account.config.social;
  return (
    account.status === "active" &&
    social.enabled &&
    social.connectionProvider === "youtube" &&
    (social.linkedProvider === "youtube" || social.platforms.includes("youtube"))
  );
}

async function hasHealthyYouTubeConnection(account: OutreachAccount) {
  const secrets = await getOutreachAccountSecrets(account.id).catch(() => null);
  if (!secrets || !hasYouTubeOAuthCredentials(secrets)) return false;
  const health = await checkYouTubeOAuthCredentials(secrets).catch(() => ({ ok: false }));
  return health.ok;
}

async function accountReadiness(platforms: LiftlinePlatform[]) {
  const accounts = await listSocialRoutingAccounts();
  const instagramAccounts = accounts.filter(hasInstagramConnection);
  const youtubeAccounts = accounts.filter(isYouTubeConnection);
  const healthyYouTubeAccounts = platforms.includes("youtube")
    ? (await Promise.all(
        youtubeAccounts.map(async (account) => ((await hasHealthyYouTubeConnection(account)) ? account : null))
      )).filter((account): account is OutreachAccount => Boolean(account))
    : [];

  return {
    instagramReady: !platforms.includes("instagram") || instagramAccounts.length > 0,
    youtubeReady: !platforms.includes("youtube") || healthyYouTubeAccounts.length > 0,
    instagramAccounts,
    youtubeAccounts: healthyYouTubeAccounts,
  };
}

function commentPrompt(input: {
  brand: BrandRecord;
  platforms: LiftlinePlatform[];
  targets: string[];
  voice: string;
  voiceSample: string;
  timingWindowMinutes: number;
  plan: LiftlinePlan;
}) {
  return [
    "Liftline autopilot is enabled for this brand.",
    `Platforms: ${input.platforms.join(", ")}.`,
    `Targets: ${input.targets.join(", ")}.`,
    `Voice: ${input.voice}.`,
    input.voiceSample ? `Example voice: ${input.voiceSample}` : "",
    `Comment about ${input.timingWindowMinutes} minutes after a relevant post or video goes live.`,
    `Daily comment limit: ${input.plan.dailyCommentLimit}.`,
    "Write one useful, human comment. Do not sound generic, spammy, promotional, or automated.",
    "Boost is automatic after comment verification.",
  ]
    .filter(Boolean)
    .join("\n");
}

function proof(input: {
  brand: BrandRecord;
  platforms: LiftlinePlatform[];
  targets: string[];
  plan: LiftlinePlan;
  readiness: Awaited<ReturnType<typeof accountReadiness>>;
}) {
  const rows: LiftlineProofEvent[] = [
    {
      label: "Autopilot configured",
      detail: `${input.brand.name} / ${input.platforms.join(" + ")} / ${input.plan.dailyCommentLimit} comments per day`,
      time: "Now",
    },
    {
      label: "Watching targets",
      detail: input.targets.slice(0, 3).join(", "),
      time: "Ready",
    },
  ];
  if (input.platforms.includes("instagram")) {
    rows.push({
      label: input.readiness.instagramReady ? "Instagram ready" : "Instagram needs connection",
      detail: input.readiness.instagramReady
        ? `${input.readiness.instagramAccounts.length} connected Instagram account(s)`
        : "Connect an Instagram account through Unipile before posting starts.",
      time: input.readiness.instagramReady ? "Ready" : "Blocked",
    });
  }
  if (input.platforms.includes("youtube")) {
    rows.push({
      label: input.readiness.youtubeReady ? "YouTube ready" : "YouTube needs reconnection",
      detail: input.readiness.youtubeReady
        ? `${input.readiness.youtubeAccounts.length} healthy YouTube OAuth account(s)`
        : "Reconnect YouTube OAuth before posting starts.",
      time: input.readiness.youtubeReady ? "Ready" : "Blocked",
    });
  }
  return rows.slice(0, 4);
}

function boolEnv(name: string, fallback: boolean) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

export async function acceptLiftlineAutopilotSetup(payload: unknown) {
  const body = asRecord(payload);
  const setup = asRecord(body.setup);
  const autopilot = asRecord(body.autopilot);
  const backend = asRecord(body.backend);
  const setupId = String(setup.setupId ?? setup.setup_id ?? body.setupId ?? "").trim();
  const brandId = String(
    backend.brandId ??
      backend.brand_id ??
      process.env.LIFTLINE_AUTOPILOT_BACKEND_BRAND_ID ??
      process.env.LIFTLINE_DEFAULT_BRAND_ID ??
      ""
  ).trim();
  if (!brandId) {
    throw new LiftlineAutopilotError(
      "Set LIFTLINE_AUTOPILOT_BACKEND_BRAND_ID on the Liftline backend before accepting setups.",
      { status: 500 }
    );
  }

  const brand = await getBrandById(brandId);
  if (!brand) {
    throw new LiftlineAutopilotError("Liftline backend brand was not found.", {
      status: 404,
      backendBrandId: brandId,
    });
  }

  const platforms = normalizePlatforms(autopilot.platforms ?? setup.platforms ?? setup.platform);
  const targets = normalizeStringArray(autopilot.targets ?? setup.targets, ["@competitor", "creator tools"]).slice(0, 24);
  const voice = String(asRecord(autopilot.commentVoice).preset ?? setup.voice ?? "Warm").trim() || "Warm";
  const voiceSample =
    String(asRecord(autopilot.commentVoice).sample ?? setup.voiceSample ?? setup.voice_sample ?? "").trim();
  const timing = asRecord(autopilot.timing);
  const plan = normalizePlan(setup.plan ?? body.plan ?? autopilot.plan);
  const dailyCommentLimit = normalizeNumber(
    asRecord(setup.plan).dailyCommentLimit ?? asRecord(body.plan).dailyCommentLimit,
    plan.dailyCommentLimit,
    1,
    500
  );
  const accountLimit = normalizeNumber(
    asRecord(setup.plan).accountLimit ?? asRecord(body.plan).accountLimit,
    plan.accountLimit,
    1,
    100
  );
  const configuredPlan: LiftlinePlan = {
    ...plan,
    dailyCommentLimit,
    accountLimit,
  };
  const timingWindowMinutes = normalizeNumber(
    timing.postAfterMinutes ?? setup.timingWindowMinutes ?? setup.timing_window_minutes,
    10,
    1,
    240
  );
  const updatedBrand = await updateBrand(brand.id, {
    socialDiscoveryPlatforms: uniqueStrings([...brand.socialDiscoveryPlatforms, ...platforms]),
    socialDiscoveryQueries: targets,
    socialDiscoveryCommentPrompt: commentPrompt({
      brand,
      platforms,
      targets,
      voice,
      voiceSample,
      timingWindowMinutes,
      plan: configuredPlan,
    }),
    socialDiscoveryYouTubeAutoCommentEnabled: platforms.includes("youtube")
      ? true
      : brand.socialDiscoveryYouTubeAutoCommentEnabled,
    liftlineAutopilotConfig: {
      enabled: true,
      setupId,
      source: "liftline",
      planId: configuredPlan.id,
      dailyCommentLimit: configuredPlan.dailyCommentLimit,
      accountLimit: configuredPlan.accountLimit,
      platforms,
      targets,
      voice,
      voiceSample,
      timingWindowMinutes,
      boostMode: "automatic",
      carefulMode: true,
      lastSetupAt: new Date().toISOString(),
    },
  });
  if (!updatedBrand) {
    throw new LiftlineAutopilotError("Liftline backend brand could not be updated.", {
      status: 500,
      backendBrandId: brand.id,
    });
  }

  const readiness = await accountReadiness(platforms);
  const events = proof({
    brand: updatedBrand,
    platforms,
    targets,
    plan: configuredPlan,
    readiness,
  });
  const requireConnectedAccounts = boolEnv("LIFTLINE_AUTOPILOT_REQUIRE_CONNECTED_ACCOUNTS", true);
  const blockedPlatforms = [
    platforms.includes("instagram") && !readiness.instagramReady ? "Instagram" : "",
    platforms.includes("youtube") && !readiness.youtubeReady ? "YouTube" : "",
  ].filter(Boolean);
  if (requireConnectedAccounts && blockedPlatforms.length) {
    throw new LiftlineAutopilotError(`${blockedPlatforms.join(" and ")} needs reconnection before autopilot can start.`, {
      status: 409,
      backendBrandId: updatedBrand.id,
      proof: events,
    });
  }

  return {
    ok: true,
    setupId,
    mode: "webhook",
    bridgeStatus: "accepted",
    message: "Liftline autopilot setup accepted.",
    backendBrandId: updatedBrand.id,
    proof: events,
    automation: {
      platforms,
      planId: configuredPlan.id,
      dailyCommentLimit: configuredPlan.dailyCommentLimit,
      accountLimit: configuredPlan.accountLimit,
      boostMode: "automatic",
    },
  };
}
