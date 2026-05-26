import { getBrandById, listBrands } from "@/lib/factory-data";
import type { BrandRecord, OutreachAccount, ScaleCampaignRecord } from "@/lib/factory-types";
import {
  createExperimentRecord,
  createScaleCampaignRecordFromExperiment,
  ensureRuntimeForExperiment,
  getExperimentRecordById,
  listScaleCampaignRecords,
  resolveScaleCampaignLane,
  updateScaleCampaignRecord,
} from "@/lib/experiment-data";
import { invokeGrowthTool, listGrowthToolCatalog } from "@/lib/growth-tool-registry";
import {
  createMission,
  createMissionAgentDecision,
  createMissionEvent,
  getMissionDetail,
  listMissions,
  updateMission,
} from "@/lib/mission-data";
import { inspectMissionDeliverability } from "@/lib/mission-learning";
import { startMission } from "@/lib/mission-orchestrator";
import { generateMissionPlan } from "@/lib/mission-plan-generation";
import type { Mission, MissionPlan, MissionRiskLevel } from "@/lib/mission-types";
import { refreshMailpoolOutreachAccount } from "@/lib/mailpool-account-refresh";
import { inspectMailboxPlacement } from "@/lib/mailbox-imap";
import { generateJsonWithLlm } from "@/lib/llm-json";
import { getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import {
  createOutreachEvent,
  enqueueOutreachJob,
  getBrandOutreachAssignment,
  getOutreachAccountSecrets,
  getOutreachRun,
  listDeliverabilitySeedReservations,
  listDeliverabilityProbeRuns,
  listOutreachAccounts,
  listRunAnomalies,
  listRunJobs,
  listRunLeads,
  listRunMessages,
  listWarmupSeedReservations,
  updateOutreachRun,
  updateDeliverabilitySeedReservations,
  updateOutreachAccount,
  type OutreachAccountSecrets,
} from "@/lib/outreach-data";
import { buildOutreachStatusResponse, type OutreachBrandStatus } from "@/lib/outreach-status";
import { provisionSender, type ProvisionSenderInput } from "@/lib/outreach-provisioning";
import {
  launchExperimentRun,
  launchScaleCampaignRun,
  reconcileOutreachStateInvariants,
} from "@/lib/outreach-runtime";
import { countScaleCampaignSendableLeadContacts } from "@/lib/scale-campaign-prospect-import";
import { prepareScaleCampaignSendableContacts } from "@/lib/scale-campaign-sendable-prep";
import { getCanonicalSenderPoolForBrand } from "@/lib/senders";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getVercelRegistrarMode } from "@/lib/vercel-domain-registrar";

type ActivationAction =
  | "activate_brand"
  | "start_existing_mission"
  | "continue_ready_mission"
  | "refill_campaign_leads"
  | "source_more_leads"
  | "repair_outreach_run"
  | "repair_seed_pool"
  | "run_inbox_placement_test"
  | "provision_mailpool_sender"
  | "refresh_mailpool_sender"
  | "use_growth_tool"
  | "observe";

type ActivationDecision = {
  brandId: string;
  action: ActivationAction;
  rationale: string;
  riskLevel: MissionRiskLevel;
  shouldCreateMission: boolean;
  shouldStartMission: boolean;
  shouldProvisionSender: boolean;
  refreshAccountId: string;
  targetCustomerText: string;
  leadRefill: {
    campaignId: string;
    experimentId: string;
    targetSendableLeads: number;
    maxLiveTopUpPasses: number;
  };
  runTool: {
    runId: string;
    targetLeadCount: number;
  };
  placementTest: {
    runId: string;
    messageId: string;
    recentProbeCooldownHours: number;
  };
  sender: {
    domainMode: "register" | "existing" | "";
    domain: string;
    domainCandidates: string[];
    fromLocalPart: string;
    senderFirstName: string;
    senderLastName: string;
    accountName: string;
  };
  growthTool: {
    toolName: string;
    input: Record<string, unknown>;
  };
};

type ActivationPlan = {
  summary: string;
  actions: ActivationDecision[];
};

type DeliverabilitySeedPoolSnapshot = {
  totalSeedRecords: number;
  activeUsable: number;
  inactiveConfigured: number;
  repairDue: number;
  failed: number;
  excluded: number;
  gmailBackedUsable: number;
  otherImapUsable: number;
  reservedDeliverability: number;
  reservedWarmup: number;
  availableUsableEstimate: number;
  staleDeliverabilityReservations: number;
  minimumUsableTarget: number;
  needsRepair: boolean;
  lastCheckedAt: string;
  error: string;
};

type BrandActivationSnapshot = {
  brand: {
    id: string;
    name: string;
    website: string;
    product: string;
    targetMarkets: string[];
    idealCustomerProfiles: string[];
    keyBenefits: string[];
    notes: string;
  };
  outreach: Pick<
    OutreachBrandStatus,
    | "healthy"
    | "sendingToday"
    | "primaryBlockerDomain"
    | "primaryBlockerCode"
    | "primaryBlockerSummary"
    | "recommendedNextAction"
    | "automaticAction"
    | "senderSummary"
    | "campaignSummary"
    | "experimentSummary"
    | "inventorySummary"
    | "capacitySummary"
    | "executionSummary"
    | "senderRouteEvidence"
  >;
  seedPool: DeliverabilitySeedPoolSnapshot;
  missions: Array<{
    id: string;
    status: Mission["status"];
    websiteUrl: string;
    targetCustomerText: string;
    deliverabilityStage: string;
    primaryBlocker: string;
    hasGeneratedPlan: boolean;
    hasApprovedPlan: boolean;
    currentExperimentId: string;
    currentRuntimeCampaignId: string;
    currentRuntimeExperimentId: string;
    currentRunId: string;
    updatedAt: string;
  }>;
};

type BrandActivationResult = {
  brandId: string;
  brandName: string;
  action: ActivationAction;
  ok: boolean;
  dryRun: boolean;
  summary: string;
  rationale: string;
  details: Record<string, unknown>;
  error: string;
};

type ActivationConfig = {
  enabled: boolean;
  dryRun: boolean;
  limitBrands: number;
  maxActionsPerTick: number;
  planCooldownMinutes: number;
  provisionFailureCooldownMinutes: number;
  allowDomainRegistration: boolean;
  allowGrowthTools: boolean;
  allowGuardedGrowthTools: boolean;
  allowSpendGrowthTools: boolean;
  allowReputationGrowthTools: boolean;
  brandAllowlist: Set<string>;
  brandDenylist: Set<string>;
  brandNameDenylist: Set<string>;
  registrant: ProvisionSenderInput["registrant"] | undefined;
};

const ACTIVE_MISSION_STATUSES = new Set<Mission["status"]>([
  "draft",
  "site_analyzing",
  "plan_ready",
  "starting",
  "running",
  "monitoring",
  "learning",
  "deliverability_blocked",
  "paused",
]);

const OPEN_OUTREACH_RUN_STATUSES = new Set([
  "queued",
  "sourcing",
  "scheduled",
  "sending",
  "monitoring",
  "paused",
]);

const DEFAULT_DELIVERABILITY_SEED_POOL_EXCLUDED_EMAILS = ["sherief@bhuman.ai"];
const DELIVERABILITY_SEND_ATTEMPT_STARTED_REASON = "probe_send_attempt_started";
const DELIVERABILITY_STALE_UNKNOWN_SEND_PROVIDER_ID = "unknown_stale_send_attempt";
const DEFAULT_BRAND_ACTIVATION_DENY_BRAND_NAMES = ["unibari", "unibari labs"];

function nowIso() {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = asString(value).toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function envBoolean(name: string, fallback = false) {
  return asBoolean(process.env[name], fallback);
}

function envNumber(name: string, fallback: number, min: number, max: number) {
  const parsed = Math.round(Number(process.env[name]));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function staleQueuedInboxPlacementProbeMinutes() {
  const deliverabilityDefault = envNumber("DELIVERABILITY_RESERVED_STALE_MINUTES", 15, 5, 120);
  return envNumber(
    "BRAND_ACTIVATION_AUTOPILOT_STALE_QUEUED_PROBE_MINUTES",
    deliverabilityDefault,
    5,
    120
  );
}

function envSet(name: string) {
  return new Set(
    asString(process.env[name])
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function envLowercaseSet(name: string, defaults: string[] = []) {
  return new Set(
    [...defaults, ...Array.from(envSet(name))]
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function seedPoolMinimumUsableTarget() {
  return envNumber("DELIVERABILITY_SEED_POOL_MIN_USABLE", 12, 1, 100);
}

function seedPoolRepairMaxChecks() {
  return envNumber("DELIVERABILITY_SEED_POOL_REPAIR_MAX_CHECKS", 50, 1, 100);
}

function seedPoolExcludedEmails() {
  return envLowercaseSet(
    "DELIVERABILITY_SEED_POOL_EXCLUDED_EMAILS",
    DEFAULT_DELIVERABILITY_SEED_POOL_EXCLUDED_EMAILS
  );
}

function toTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function ageMs(value: string) {
  const timestamp = toTimestamp(value);
  return timestamp > 0 ? Date.now() - timestamp : 0;
}

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/^\.+|\.+$/g, "");
}

function normalizeLocalPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, "")
    .replace(/^\.+|\.+$/g, "");
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    rows.push(normalized);
  }
  return rows;
}

function clampFirstBatch(value: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(10, Math.min(50, parsed));
}

function clampLeadRefillTarget(value: number, fallback = 25) {
  const parsed = Math.round(Number(value));
  const safeFallback = Math.max(10, Math.min(250, Math.round(Number(fallback) || 25)));
  if (!Number.isFinite(parsed)) return safeFallback;
  return Math.max(10, Math.min(250, parsed));
}

function clampLiveTopUpPasses(value: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(3, parsed));
}

function clampRunLeadTarget(value: number, fallback = 25) {
  const parsed = Math.round(Number(value));
  const safeFallback = Math.max(1, Math.min(500, Math.round(Number(fallback) || 25)));
  if (!Number.isFinite(parsed)) return safeFallback;
  return Math.max(1, Math.min(500, parsed));
}

function clampPlacementCooldownHours(value: number, fallback = 12) {
  const parsed = Math.round(Number(value));
  const safeFallback = Math.max(1, Math.min(72, Math.round(Number(fallback) || 12)));
  if (!Number.isFinite(parsed)) return safeFallback;
  return Math.max(1, Math.min(72, parsed));
}

function planIsComplete(plan: MissionPlan) {
  return Boolean(
    plan.offerSummary.trim() &&
      plan.targetCustomers.length > 0 &&
      plan.outreachAngle.trim()
  );
}

function readRegistrantFromEnv(): ProvisionSenderInput["registrant"] | undefined {
  const registrant = {
    firstName: asString(process.env.BRAND_ACTIVATION_AUTOPILOT_REGISTRANT_FIRST_NAME),
    lastName: asString(process.env.BRAND_ACTIVATION_AUTOPILOT_REGISTRANT_LAST_NAME),
    organizationName: asString(process.env.BRAND_ACTIVATION_AUTOPILOT_REGISTRANT_ORGANIZATION),
    emailAddress: asString(process.env.BRAND_ACTIVATION_AUTOPILOT_REGISTRANT_EMAIL),
    phone: asString(process.env.BRAND_ACTIVATION_AUTOPILOT_REGISTRANT_PHONE),
    address1: asString(process.env.BRAND_ACTIVATION_AUTOPILOT_REGISTRANT_ADDRESS1),
    city: asString(process.env.BRAND_ACTIVATION_AUTOPILOT_REGISTRANT_CITY),
    stateProvince: asString(process.env.BRAND_ACTIVATION_AUTOPILOT_REGISTRANT_STATE),
    postalCode: asString(process.env.BRAND_ACTIVATION_AUTOPILOT_REGISTRANT_POSTAL_CODE),
    country: asString(process.env.BRAND_ACTIVATION_AUTOPILOT_REGISTRANT_COUNTRY),
  };
  const required = [
    registrant.firstName,
    registrant.lastName,
    registrant.emailAddress,
    registrant.address1,
    registrant.city,
    registrant.postalCode,
    registrant.country,
  ];
  return required.every(Boolean) ? registrant : undefined;
}

function readConfig(): ActivationConfig {
  const enabled = envBoolean("BRAND_ACTIVATION_AUTOPILOT_ENABLED", false);
  const allowDomainRegistration = envBoolean("BRAND_ACTIVATION_AUTOPILOT_ALLOW_DOMAIN_REGISTRATION", false);
  return {
    enabled,
    dryRun: envBoolean("BRAND_ACTIVATION_AUTOPILOT_DRY_RUN", false),
    limitBrands: envNumber("BRAND_ACTIVATION_AUTOPILOT_LIMIT", 20, 1, 80),
    maxActionsPerTick: envNumber("BRAND_ACTIVATION_AUTOPILOT_ACTIONS_PER_TICK", 1, 1, 5),
    planCooldownMinutes: envNumber("BRAND_ACTIVATION_AUTOPILOT_PLAN_COOLDOWN_MINUTES", 60, 5, 1440),
    provisionFailureCooldownMinutes: envNumber(
      "BRAND_ACTIVATION_AUTOPILOT_PROVISION_FAILURE_COOLDOWN_MINUTES",
      60,
      0,
      1440
    ),
    allowDomainRegistration,
    allowGrowthTools: envBoolean("BRAND_ACTIVATION_AUTOPILOT_ALLOW_GROWTH_TOOLS", true),
    allowGuardedGrowthTools: envBoolean("BRAND_ACTIVATION_AUTOPILOT_ALLOW_GUARDED_GROWTH_TOOLS", enabled),
    allowSpendGrowthTools: envBoolean("BRAND_ACTIVATION_AUTOPILOT_ALLOW_SPEND_GROWTH_TOOLS", false),
    allowReputationGrowthTools: envBoolean("BRAND_ACTIVATION_AUTOPILOT_ALLOW_REPUTATION_GROWTH_TOOLS", enabled),
    brandAllowlist: envSet("BRAND_ACTIVATION_AUTOPILOT_BRAND_IDS"),
    brandDenylist: envSet("BRAND_ACTIVATION_AUTOPILOT_DENY_BRAND_IDS"),
    brandNameDenylist: envLowercaseSet(
      "BRAND_ACTIVATION_AUTOPILOT_DENY_BRAND_NAMES",
      DEFAULT_BRAND_ACTIVATION_DENY_BRAND_NAMES
    ),
    registrant: readRegistrantFromEnv(),
  };
}

function latestActionableMission(missions: Mission[]) {
  return missions.find((mission) => ACTIVE_MISSION_STATUSES.has(mission.status)) ?? null;
}

function summarizeMission(mission: Mission) {
  return {
    id: mission.id,
    status: mission.status,
    websiteUrl: mission.websiteUrl,
    targetCustomerText: mission.targetCustomerText,
    deliverabilityStage: mission.deliverabilityState.stage,
    primaryBlocker: mission.deliverabilityState.primaryBlocker,
    hasGeneratedPlan: planIsComplete(mission.generatedPlan),
    hasApprovedPlan: planIsComplete(mission.approvedPlan),
    currentExperimentId: mission.currentExperimentId,
    currentRuntimeCampaignId: mission.currentRuntimeCampaignId,
    currentRuntimeExperimentId: mission.currentRuntimeExperimentId,
    currentRunId: mission.currentRunId,
    updatedAt: mission.updatedAt,
  };
}

function compactBrand(brand: BrandRecord) {
  return {
    id: brand.id,
    name: brand.name,
    website: brand.website,
    product: brand.product,
    targetMarkets: brand.targetMarkets.slice(0, 8),
    idealCustomerProfiles: brand.idealCustomerProfiles.slice(0, 8),
    keyBenefits: brand.keyBenefits.slice(0, 8),
    notes: brand.notes.replace(/\s+/g, " ").slice(0, 900),
  };
}

function brandMatchesNameDenylist(brand: BrandRecord, denylist: Set<string>) {
  if (!denylist.size) return false;
  const normalizedName = brand.name.trim().toLowerCase();
  const normalizedWebsite = normalizeDomain(brand.website);
  return Array.from(denylist).some((denied) => {
    if (!denied) return false;
    return (
      normalizedName === denied ||
      normalizedName.includes(denied) ||
      normalizedWebsite === denied ||
      normalizedWebsite.includes(denied)
    );
  });
}

function actionFromUnknown(value: unknown): ActivationAction {
  const normalized = asString(value);
  if (
    normalized === "activate_brand" ||
    normalized === "start_existing_mission" ||
    normalized === "continue_ready_mission" ||
    normalized === "refill_campaign_leads" ||
    normalized === "source_more_leads" ||
    normalized === "repair_outreach_run" ||
    normalized === "repair_seed_pool" ||
    normalized === "run_inbox_placement_test" ||
    normalized === "provision_mailpool_sender" ||
    normalized === "refresh_mailpool_sender" ||
    normalized === "use_growth_tool" ||
    normalized === "observe"
  ) {
    return normalized;
  }
  return "observe";
}

function riskFromUnknown(value: unknown): MissionRiskLevel {
  const normalized = asString(value);
  if (normalized === "read" || normalized === "safe_write" || normalized === "guarded_write" || normalized === "blocked") {
    return normalized;
  }
  return "read";
}

function normalizeActivationPlan(value: unknown, maxActions: number): ActivationPlan {
  const row = asRecord(value);
  const rawActions = Array.isArray(row.actions) ? row.actions : [];
  const actions = rawActions
    .map((entry): ActivationDecision => {
      const action = asRecord(entry);
      const sender = asRecord(action.sender);
      const leadRefill = asRecord(action.leadRefill);
      const runTool = asRecord(action.runTool);
      const placementTest = asRecord(action.placementTest);
      const growthTool = asRecord(action.growthTool);
      const domainMode = asString(sender.domainMode);
      return {
        brandId: asString(action.brandId),
        action: actionFromUnknown(action.action),
        rationale: asString(action.rationale),
        riskLevel: riskFromUnknown(action.riskLevel),
        shouldCreateMission: asBoolean(action.shouldCreateMission),
        shouldStartMission: asBoolean(action.shouldStartMission),
        shouldProvisionSender: asBoolean(action.shouldProvisionSender),
        refreshAccountId: asString(action.refreshAccountId),
        targetCustomerText: asString(action.targetCustomerText),
        leadRefill: {
          campaignId: asString(leadRefill.campaignId),
          experimentId: asString(leadRefill.experimentId),
          targetSendableLeads: clampLeadRefillTarget(Number(leadRefill.targetSendableLeads ?? 0)),
          maxLiveTopUpPasses: clampLiveTopUpPasses(Number(leadRefill.maxLiveTopUpPasses ?? 0)),
        },
        runTool: {
          runId: asString(runTool.runId),
          targetLeadCount: clampRunLeadTarget(Number(runTool.targetLeadCount ?? 0)),
        },
        placementTest: {
          runId: asString(placementTest.runId),
          messageId: asString(placementTest.messageId),
          recentProbeCooldownHours: clampPlacementCooldownHours(
            Number(placementTest.recentProbeCooldownHours ?? 0)
          ),
        },
        sender: {
          domainMode: domainMode === "register" || domainMode === "existing" ? domainMode : "",
          domain: normalizeDomain(asString(sender.domain)),
          domainCandidates: uniqueStrings(
            (Array.isArray(sender.domainCandidates) ? sender.domainCandidates : [])
              .map((candidate) => normalizeDomain(asString(candidate)))
              .filter((candidate) => candidate.includes("."))
          ).slice(0, 10),
          fromLocalPart: normalizeLocalPart(asString(sender.fromLocalPart)),
          senderFirstName: asString(sender.senderFirstName).replace(/\s+/g, " "),
          senderLastName: asString(sender.senderLastName).replace(/\s+/g, " "),
          accountName: asString(sender.accountName),
        },
        growthTool: {
          toolName: asString(growthTool.toolName),
          input: asRecord(growthTool.input),
        },
      };
    })
    .filter((action) => action.brandId)
    .slice(0, maxActions);

  return {
    summary: asString(row.summary),
    actions,
  };
}

function brandSlug(brand: Pick<BrandRecord, "name" | "website">) {
  const domain = normalizeDomain(brand.website).split(".")[0] ?? "";
  const source = domain || brand.name;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 18);
  return slug || "outbound";
}

function fallbackDomainCandidates(brand: Pick<BrandRecord, "name" | "website">, preferred = "") {
  const slug = brandSlug(brand);
  return uniqueStrings([
    normalizeDomain(preferred),
    `get${slug}.com`,
    `try${slug}.com`,
    `${slug}mail.com`,
    `${slug}hq.com`,
    `use${slug}.com`,
    `${slug}.co`,
  ]).filter((domain) => domain.includes("."));
}

function primaryWebsiteDomain(brand: Pick<BrandRecord, "website">) {
  return normalizeDomain(brand.website);
}

function normalizeSenderDecision(brand: BrandRecord, decision: ActivationDecision) {
  const protectedDomain = primaryWebsiteDomain(brand);
  const candidates = fallbackDomainCandidates(brand, decision.sender.domain).filter(
    (domain) => domain && domain !== protectedDomain
  );
  const domain = decision.sender.domain && decision.sender.domain !== protectedDomain
    ? decision.sender.domain
    : candidates[0] ?? "";
  const fromLocalPart =
    decision.sender.fromLocalPart ||
    normalizeLocalPart(decision.sender.senderFirstName) ||
    "hello";
  return {
    ...decision.sender,
    domainMode: decision.sender.domainMode || ("register" as const),
    domain,
    domainCandidates: uniqueStrings([domain, ...decision.sender.domainCandidates, ...candidates])
      .map(normalizeDomain)
      .filter((candidate) => candidate.includes(".") && candidate !== protectedDomain)
      .slice(0, 12),
    fromLocalPart,
    accountName:
      decision.sender.accountName ||
      `${brand.name || "Brand"} ${fromLocalPart}@${domain || "sender"}`,
  };
}

function shouldRetryMailpoolDomainRegistration(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("mailpool post /domains/ failed") &&
    (normalized.includes("http 500") || normalized.includes("internal server error"))
  );
}

async function recentProvisioningFailure(input: {
  mission: Mission | null;
  cooldownMinutes: number;
}) {
  if (!input.mission || input.cooldownMinutes <= 0) return null;
  const detail = await getMissionDetail(input.mission.brandId, input.mission.id).catch(() => null);
  const cutoff = Date.now() - input.cooldownMinutes * 60 * 1000;
  return (
    (detail?.events ?? []).find((event) => {
      if (event.eventType !== "autonomous_sender_provisioning_failed") return false;
      const createdAt = new Date(event.createdAt).getTime();
      return Number.isFinite(createdAt) && createdAt >= cutoff;
    }) ?? null
  );
}

function canBypassRecentProvisioningFailure(value: unknown) {
  if (getVercelRegistrarMode() !== "vercel") return false;
  const payload = asRecord(value);
  const attempts = asArray(payload.attempts);
  return attempts.some((attempt) => {
    const error = asString(asRecord(attempt).error).toLowerCase();
    if (error.includes("mailboxes count limit exceeded") || error.includes("mailbox cannot be deleted")) {
      return false;
    }
    return (
      (error.includes("mailpool post /domains/ failed") && error.includes("http 500")) ||
      (error.includes("mailpool post /subscriptions/update-slots failed") && error.includes("http 500")) ||
      error.includes("vercel api token is not configured")
    );
  });
}

function isDedicatedDeliverabilityMonitorAccount(account: OutreachAccount) {
  const label = account.name.trim().toLowerCase();
  const email = account.config.mailbox.email.trim().toLowerCase();
  return (
    label.startsWith("deliverability ") ||
    label.includes("deliverability monitor") ||
    label.includes("seed monitor") ||
    email.endsWith("@mailivery.io")
  );
}

function seedMailboxEmail(account: OutreachAccount) {
  return (
    account.config.mailbox.email.trim().toLowerCase() ||
    getOutreachAccountFromEmail(account).trim().toLowerCase()
  );
}

function seedMailboxHasImapConfig(account: OutreachAccount, secrets: OutreachAccountSecrets | null) {
  return Boolean(
    seedMailboxEmail(account) &&
      account.config.mailbox.host.trim() &&
      Number(account.config.mailbox.port || 0) > 0 &&
      secrets?.mailboxPassword.trim()
  );
}

function isGmailBackedSeedMailbox(account: OutreachAccount) {
  const email = seedMailboxEmail(account);
  const host = account.config.mailbox.host.trim().toLowerCase();
  return account.config.mailbox.provider === "gmail" || email.endsWith("@gmail.com") || host.includes("gmail.com");
}

function isUsableSeedMailbox(account: OutreachAccount, secrets: OutreachAccountSecrets | null) {
  return Boolean(
    account.status === "active" &&
      account.accountType !== "delivery" &&
      account.config.mailbox.status === "connected" &&
      seedMailboxHasImapConfig(account, secrets)
  );
}

function defaultSeedPoolSnapshot(error = ""): DeliverabilitySeedPoolSnapshot {
  return {
    totalSeedRecords: 0,
    activeUsable: 0,
    inactiveConfigured: 0,
    repairDue: 0,
    failed: 0,
    excluded: DEFAULT_DELIVERABILITY_SEED_POOL_EXCLUDED_EMAILS.length,
    gmailBackedUsable: 0,
    otherImapUsable: 0,
    reservedDeliverability: 0,
    reservedWarmup: 0,
    availableUsableEstimate: 0,
    staleDeliverabilityReservations: 0,
    minimumUsableTarget: seedPoolMinimumUsableTarget(),
    needsRepair: false,
    lastCheckedAt: nowIso(),
    error,
  };
}

async function readDeliverabilitySeedPoolSnapshot(): Promise<DeliverabilitySeedPoolSnapshot> {
  const minimumUsableTarget = seedPoolMinimumUsableTarget();
  const staleMs = staleQueuedInboxPlacementProbeMinutes() * 60 * 1000;
  try {
    const [accounts, deliverabilityReservations, warmupReservations] = await Promise.all([
      listOutreachAccounts(),
      listDeliverabilitySeedReservations({ statuses: ["reserved"] }),
      listWarmupSeedReservations({ statuses: ["reserved"] }),
    ]);
    const excludedEmails = seedPoolExcludedEmails();
    const seedAccounts = accounts.filter(isDedicatedDeliverabilityMonitorAccount);
    const secretsByAccountId = new Map<string, OutreachAccountSecrets | null>();
    await Promise.all(
      seedAccounts.map(async (account) => {
        secretsByAccountId.set(account.id, await getOutreachAccountSecrets(account.id).catch(() => null));
      })
    );

    let activeUsable = 0;
    let inactiveConfigured = 0;
    let repairDue = 0;
    let failed = 0;
    let excluded = 0;
    let gmailBackedUsable = 0;
    let otherImapUsable = 0;

    for (const account of seedAccounts) {
      const secrets = secretsByAccountId.get(account.id) ?? null;
      const email = seedMailboxEmail(account);
      if (email && excludedEmails.has(email)) {
        excluded += 1;
        continue;
      }
      const configured = seedMailboxHasImapConfig(account, secrets);
      const usable = isUsableSeedMailbox(account, secrets);
      if (usable) {
        activeUsable += 1;
        if (isGmailBackedSeedMailbox(account)) {
          gmailBackedUsable += 1;
        } else {
          otherImapUsable += 1;
        }
        continue;
      }
      if (configured) {
        inactiveConfigured += 1;
        const recentlyFailed =
          account.lastTestStatus === "fail" &&
          ageMs(account.lastTestAt || account.updatedAt || account.createdAt) < 24 * 60 * 60 * 1000;
        if (!recentlyFailed) {
          repairDue += 1;
        }
      }
      if (account.lastTestStatus === "fail" || account.config.mailbox.status === "error") {
        failed += 1;
      }
    }

    const warmupReservedKeys = new Set(
      warmupReservations
        .map((reservation) => reservation.monitorAccountId || reservation.monitorEmail)
        .filter(Boolean)
    );
    const staleDeliverabilityReservations = deliverabilityReservations.filter((reservation) => {
      if (reservation.providerMessageId.trim()) return false;
      return ageMs(reservation.reservedAt || reservation.createdAt || reservation.updatedAt) >= staleMs;
    }).length;
    const availableUsableEstimate = Math.max(0, activeUsable - warmupReservedKeys.size);
    return {
      totalSeedRecords: seedAccounts.length,
      activeUsable,
      inactiveConfigured,
      repairDue,
      failed,
      excluded,
      gmailBackedUsable,
      otherImapUsable,
      reservedDeliverability: deliverabilityReservations.length,
      reservedWarmup: warmupReservations.length,
      availableUsableEstimate,
      staleDeliverabilityReservations,
      minimumUsableTarget,
      needsRepair:
        (activeUsable < minimumUsableTarget && inactiveConfigured > 0) ||
        repairDue > 0 ||
        staleDeliverabilityReservations > 0,
      lastCheckedAt: nowIso(),
      error: "",
    };
  } catch (error) {
    return defaultSeedPoolSnapshot(error instanceof Error ? error.message : "Seed pool snapshot failed.");
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results: R[] = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, Math.max(items.length, 1)));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    })
  );
  return results;
}

async function releaseStaleDeliverabilitySeedReservations(dryRun: boolean) {
  const reservations = await listDeliverabilitySeedReservations({ statuses: ["reserved"] });
  const staleMs = staleQueuedInboxPlacementProbeMinutes() * 60 * 1000;
  const releaseIds: string[] = [];
  const consumedUnknownAttemptIds: string[] = [];
  for (const reservation of reservations) {
    if (reservation.providerMessageId.trim()) continue;
    if (ageMs(reservation.reservedAt || reservation.createdAt || reservation.updatedAt) < staleMs) continue;
    if (reservation.releasedReason.trim() === DELIVERABILITY_SEND_ATTEMPT_STARTED_REASON) {
      consumedUnknownAttemptIds.push(reservation.id);
    } else {
      releaseIds.push(reservation.id);
    }
  }
  const updatedAt = nowIso();
  if (!dryRun) {
    await Promise.all([
      releaseIds.length
        ? updateDeliverabilitySeedReservations(releaseIds, {
            status: "released",
            releasedAt: updatedAt,
            releasedReason: "autonomous_seed_pool_repair_stale_reservation",
          })
        : Promise.resolve([]),
      consumedUnknownAttemptIds.length
        ? updateDeliverabilitySeedReservations(consumedUnknownAttemptIds, {
            status: "consumed",
            providerMessageId: DELIVERABILITY_STALE_UNKNOWN_SEND_PROVIDER_ID,
            consumedAt: updatedAt,
            releasedAt: "",
            releasedReason: "autonomous_seed_pool_repair_unknown_send_attempt",
          })
        : Promise.resolve([]),
    ]);
  }
  return {
    staleReservedCount: releaseIds.length + consumedUnknownAttemptIds.length,
    releasedCount: releaseIds.length,
    consumedUnknownAttemptCount: consumedUnknownAttemptIds.length,
    dryRun,
  };
}

async function repairSeedMailboxAccount(input: {
  account: OutreachAccount;
  dryRun: boolean;
  excludedEmails: Set<string>;
}) {
  const { account, dryRun, excludedEmails } = input;
  const checkedAt = nowIso();
  const email = seedMailboxEmail(account);
  const secrets = await getOutreachAccountSecrets(account.id).catch(() => null);
  const base = {
    accountId: account.id,
    email,
    name: account.name,
    previousStatus: account.status,
    previousMailboxStatus: account.config.mailbox.status,
    checkedAt,
    dryRun,
  };

  const deactivate = async (reason: string, mailboxStatus: "disconnected" | "error" = "disconnected") => {
    if (!dryRun) {
      await updateOutreachAccount(account.id, {
        status: "inactive",
        config: {
          mailbox: {
            ...account.config.mailbox,
            status: mailboxStatus,
          },
        },
        lastTestAt: checkedAt,
        lastTestStatus: mailboxStatus === "error" ? "fail" : account.lastTestStatus,
      });
    }
    return {
      ...base,
      outcome: "disabled",
      reason,
    };
  };

  if (!email) {
    return deactivate("seed mailbox email missing");
  }
  if (excludedEmails.has(email)) {
    return deactivate("seed mailbox is excluded by policy");
  }
  if (!seedMailboxHasImapConfig(account, secrets)) {
    return deactivate("seed mailbox IMAP config or password missing");
  }

  const placement = await inspectMailboxPlacement({
    mailbox: {
      host: account.config.mailbox.host.trim(),
      port: Number(account.config.mailbox.port || 993),
      secure: account.config.mailbox.secure !== false,
      email,
      password: secrets!.mailboxPassword.trim(),
    },
    fromEmail: `no-such-seed-check-${Date.now()}@lastb2b.invalid`,
    subject: `LastB2B seed pool connectivity ${Date.now()}`,
    since: new Date(Date.now() - 60 * 60 * 1000),
  });

  if (!placement.ok) {
    if (!dryRun) {
      await updateOutreachAccount(account.id, {
        status: "inactive",
        config: {
          mailbox: {
            ...account.config.mailbox,
            status: "error",
          },
        },
        lastTestAt: checkedAt,
        lastTestStatus: "fail",
      });
    }
    return {
      ...base,
      outcome: "failed",
      reason: placement.error || "IMAP connectivity failed",
    };
  }

  if (!dryRun) {
    await updateOutreachAccount(account.id, {
      status: "active",
      config: {
        mailbox: {
          ...account.config.mailbox,
          email,
          status: "connected",
        },
      },
      lastTestAt: checkedAt,
      lastTestStatus: "pass",
    });
  }
  return {
    ...base,
    outcome: account.status === "active" && account.config.mailbox.status === "connected" ? "confirmed" : "reactivated",
    reason: "IMAP connectivity passed",
  };
}

async function repairDeliverabilitySeedPool(dryRun: boolean) {
  const before = await readDeliverabilitySeedPoolSnapshot();
  const [accounts, reservationRepair] = await Promise.all([
    listOutreachAccounts(),
    releaseStaleDeliverabilitySeedReservations(dryRun),
  ]);
  const excludedEmails = seedPoolExcludedEmails();
  const seedAccounts = accounts
    .filter(isDedicatedDeliverabilityMonitorAccount)
    .filter((account) => {
      const email = seedMailboxEmail(account);
      if (email && excludedEmails.has(email)) return true;
      const recentlyFailed =
        account.lastTestStatus === "fail" &&
        ageMs(account.lastTestAt || account.updatedAt || account.createdAt) < 24 * 60 * 60 * 1000;
      if (recentlyFailed && before.activeUsable >= before.minimumUsableTarget) {
        return false;
      }
      return (
        account.status !== "active" ||
        account.config.mailbox.status !== "connected" ||
        account.lastTestStatus === "fail"
      );
    })
    .slice(0, seedPoolRepairMaxChecks());

  const checks = await mapWithConcurrency(seedAccounts, 5, async (account) =>
    repairSeedMailboxAccount({ account, dryRun, excludedEmails })
  );
  const after = await readDeliverabilitySeedPoolSnapshot();
  return {
    before,
    after,
    checkedAccounts: checks.length,
    reactivatedAccounts: checks.filter((check) => check.outcome === "reactivated").length,
    confirmedAccounts: checks.filter((check) => check.outcome === "confirmed").length,
    disabledAccounts: checks.filter((check) => check.outcome === "disabled").length,
    failedAccounts: checks.filter((check) => check.outcome === "failed").length,
    excludedEmails: Array.from(excludedEmails),
    reservationRepair,
    checks,
  };
}

function hasOpenOutboundWork(status: OutreachBrandStatus) {
  return Boolean(
    status.executionSummary.openOutboundRunCount > 0 ||
      status.executionSummary.activeOutboundRunId ||
      status.sendingToday
  );
}

function actionCanTouchOpenOutboundWork(action: ActivationAction) {
  return (
    action === "refresh_mailpool_sender" ||
    action === "repair_outreach_run" ||
    action === "repair_seed_pool" ||
    action === "source_more_leads" ||
    action === "run_inbox_placement_test" ||
    action === "use_growth_tool"
  );
}

function canProvisionAnotherSender(status: OutreachBrandStatus) {
  return (
    status.senderSummary.readySenderCount === 0 &&
    status.senderSummary.warmingSenderCount === 0 &&
    status.senderSummary.provisioningSenderCount === 0
  );
}

function snapshotHasOpenOutboundWork(snapshot: BrandActivationSnapshot) {
  return Boolean(
    snapshot.outreach.executionSummary.openOutboundRunCount > 0 ||
      snapshot.outreach.executionSummary.activeOutboundRunId ||
      snapshot.outreach.sendingToday
  );
}

function snapshotHasRepairableOpenOutboundWork(snapshot: BrandActivationSnapshot) {
  const execution = snapshot.outreach.executionSummary;
  if (!snapshotHasOpenOutboundWork(snapshot)) return false;
  if (snapshot.outreach.primaryBlockerDomain === "execution" || snapshot.outreach.primaryBlockerDomain === "inventory") {
    return true;
  }
  if (execution.duplicateOpenRunCount > 0) return true;
  if (execution.dueMessageCount > 0 && execution.activeDispatchJobCount <= 0) return true;
  if (
    execution.activeOutboundRunId &&
    ["queued", "sourcing"].includes(execution.activeOutboundRunStatus) &&
    execution.scheduledNext24hCount <= 0 &&
    execution.activeDispatchJobCount <= 0
  ) {
    return true;
  }
  return false;
}

function statusNeedsInboxPlacementTest(status: {
  executionSummary: OutreachBrandStatus["executionSummary"];
}) {
  return Boolean(
    status.executionSummary.activeOutboundRunId &&
      ["scheduled", "sending", "monitoring"].includes(status.executionSummary.activeOutboundRunStatus) &&
      status.executionSummary.scheduledNext24hCount > 0
  );
}

function snapshotNeedsInboxPlacementTest(snapshot: BrandActivationSnapshot) {
  return statusNeedsInboxPlacementTest(snapshot.outreach);
}

function routeEvidenceHasPlacement(
  evidence: OutreachBrandStatus["senderRouteEvidence"][number]
) {
  return Boolean(evidence.checkedAt && evidence.totalMonitors > 0);
}

function routeEvidenceShowsSpam(
  evidence: OutreachBrandStatus["senderRouteEvidence"][number]
) {
  if (!routeEvidenceHasPlacement(evidence)) return false;
  if (evidence.placement === "spam") return true;
  if (evidence.totalMonitors >= 2 && evidence.spamRate >= 0.5) return true;
  return evidence.spamCount > 0 && evidence.inboxCount === 0;
}

function routeEvidenceShowsInbox(
  evidence: OutreachBrandStatus["senderRouteEvidence"][number]
) {
  if (!routeEvidenceHasPlacement(evidence)) return false;
  if (evidence.placement === "inbox") return true;
  if (evidence.totalMonitors >= 2 && evidence.inboxRate >= 0.5 && evidence.spamCount === 0) return true;
  return evidence.inboxCount > 0 && evidence.spamCount === 0;
}

function gmailUiSpamEvidence(snapshot: BrandActivationSnapshot) {
  return gmailUiSpamEvidenceFromRoutes(snapshot.outreach.senderRouteEvidence);
}

function gmailUiSpamEvidenceFromRoutes(routes: OutreachBrandStatus["senderRouteEvidence"]) {
  return routes
    .filter((evidence) => evidence.routeKind === "gmail_ui" && routeEvidenceShowsSpam(evidence))
    .sort((left, right) => toTimestamp(right.checkedAt) - toTimestamp(left.checkedAt));
}

function customerIoRouteEvidence(snapshot: BrandActivationSnapshot) {
  return snapshot.outreach.senderRouteEvidence.filter((evidence) => evidence.routeKind === "customerio");
}

function verifiedPromotableInboxRoutesFromRoutes(routes: OutreachBrandStatus["senderRouteEvidence"]) {
  return routes
    .filter(
      (evidence) =>
        routeEvidenceShowsInbox(evidence) &&
        evidence.accountId &&
        evidence.fromEmail &&
        evidence.routeKind !== "unknown" &&
        evidence.state === "ready"
    )
    .sort((left, right) => {
      const timestampDelta = toTimestamp(right.checkedAt) - toTimestamp(left.checkedAt);
      if (timestampDelta !== 0) return timestampDelta;
      return right.inboxRate - left.inboxRate;
    });
}

function verifiedPromotableInboxRoutes(snapshot: BrandActivationSnapshot) {
  return verifiedPromotableInboxRoutesFromRoutes(snapshot.outreach.senderRouteEvidence);
}

function statusNeedsTransportFallback(status: Pick<OutreachBrandStatus, "campaignSummary" | "executionSummary" | "senderRouteEvidence">) {
  if (gmailUiSpamEvidenceFromRoutes(status.senderRouteEvidence).length === 0) return false;
  return Boolean(
    status.executionSummary.activeOutboundRunId &&
      status.campaignSummary.activeOutboundCampaignId
  );
}

function snapshotNeedsTransportFallback(snapshot: BrandActivationSnapshot) {
  return statusNeedsTransportFallback(snapshot.outreach);
}

function statusNeedsVerifiedTransportPromotion(status: Pick<
  OutreachBrandStatus,
  "campaignSummary" | "executionSummary" | "senderRouteEvidence" | "senderSummary" | "primaryBlockerDomain" | "capacitySummary"
>) {
  if (!status.executionSummary.activeOutboundRunId || !status.campaignSummary.activeOutboundCampaignId) {
    return false;
  }
  if (verifiedPromotableInboxRoutesFromRoutes(status.senderRouteEvidence).length === 0) return false;
  if (gmailUiSpamEvidenceFromRoutes(status.senderRouteEvidence).length > 0) return true;
  if (status.executionSummary.activeOutboundRunStatus === "paused") return true;
  if (status.executionSummary.dueMessageCount > 0 && status.executionSummary.activeDispatchJobCount <= 0) return true;
  if (status.primaryBlockerDomain === "sender" || status.primaryBlockerDomain === "execution") return true;
  if (status.senderSummary.readySenderCount === 0) return true;
  return !status.capacitySummary.dispatchableNow;
}

function snapshotNeedsVerifiedTransportPromotion(snapshot: BrandActivationSnapshot) {
  return statusNeedsVerifiedTransportPromotion(snapshot.outreach);
}

function statusNeedsCampaignLaunch(status: Pick<
  OutreachBrandStatus,
  "campaignSummary" | "executionSummary" | "senderSummary" | "primaryBlockerDomain" | "primaryBlockerCode"
>) {
  if (!status.campaignSummary.activeOutboundCampaignId) return false;
  if (status.executionSummary.activeOutboundRunId || status.executionSummary.openOutboundRunCount > 0) return false;
  if (status.campaignSummary.readyOutboundCampaignCount <= 0) return false;
  if (status.senderSummary.readySenderCount <= 0) return false;
  if (
    status.primaryBlockerDomain === "sender" ||
    status.primaryBlockerDomain === "capacity" ||
    status.primaryBlockerDomain === "provider" ||
    status.primaryBlockerDomain === "execution"
  ) {
    return false;
  }
  if (status.primaryBlockerDomain === "experiment" && status.primaryBlockerCode !== "no_active_outbound_campaign") {
    return false;
  }
  return true;
}

function snapshotNeedsCampaignLaunch(snapshot: BrandActivationSnapshot) {
  return statusNeedsCampaignLaunch(snapshot.outreach);
}

function summarizeTransportFallback(snapshot: BrandActivationSnapshot) {
  const gmailSpam = gmailUiSpamEvidence(snapshot);
  const customerIoRoutes = customerIoRouteEvidence(snapshot);
  const customerIoTestedRoutes = customerIoRoutes.filter(routeEvidenceHasPlacement);
  const activeRunId = snapshot.outreach.executionSummary.activeOutboundRunId;
  const activeCampaignId = snapshot.outreach.campaignSummary.activeOutboundCampaignId;
  const due = snapshotNeedsTransportFallback(snapshot);
  return {
    due,
    reason: due
      ? "Gmail UI route has fresh spam placement evidence; compare/provision another transport using the same real campaign copy."
      : "",
    gmailUiSpamEvidence: gmailSpam.slice(0, 3).map((evidence) => ({
      accountId: evidence.accountId,
      fromEmail: evidence.fromEmail,
      placement: evidence.placement,
      checkedAt: evidence.checkedAt,
      totalMonitors: evidence.totalMonitors,
      inboxCount: evidence.inboxCount,
      spamCount: evidence.spamCount,
      spamRate: evidence.spamRate,
      summaryText: evidence.summaryText,
    })),
    customerIo: {
      assignedRouteCount: customerIoRoutes.length,
      testedRouteCount: customerIoTestedRoutes.length,
      untestedRouteCount: customerIoRoutes.length - customerIoTestedRoutes.length,
    },
    recommendedTool:
      due && customerIoRoutes.length > 0
        ? "campaign.control_email_run"
        : due
          ? "customerio.sender.provision"
          : "",
    recommendedInput:
      due && customerIoRoutes.length > 0
        ? {
            brandId: snapshot.brand.id,
            campaignId: activeCampaignId,
            runId: activeRunId,
            action: "probe_all_senders_deliverability",
            reason:
              "Gmail UI exact-copy inbox placement landed in spam; test all sender transports with the same campaign copy.",
          }
      : {},
  };
}

function summarizeVerifiedTransportPromotion(snapshot: BrandActivationSnapshot) {
  const verifiedRoutes = verifiedPromotableInboxRoutes(snapshot);
  const activeRunId = snapshot.outreach.executionSummary.activeOutboundRunId;
  const activeCampaignId = snapshot.outreach.campaignSummary.activeOutboundCampaignId;
  const due = snapshotNeedsVerifiedTransportPromotion(snapshot);
  const bestRoute = verifiedRoutes[0] ?? null;
  return {
    due,
    reason:
      due && bestRoute
        ? "A ready sender route has exact-copy inbox placement evidence; promote that route for the active run instead of waiting for manual instruction."
        : "",
    verifiedInboxRouteEvidence: verifiedRoutes.slice(0, 3).map((evidence) => ({
      accountId: evidence.accountId,
      fromEmail: evidence.fromEmail,
      routeKind: evidence.routeKind,
      state: evidence.state,
      placement: evidence.placement,
      checkedAt: evidence.checkedAt,
      totalMonitors: evidence.totalMonitors,
      inboxCount: evidence.inboxCount,
      spamCount: evidence.spamCount,
      inboxRate: evidence.inboxRate,
      summaryText: evidence.summaryText,
    })),
    recommendedTool: due && bestRoute ? "campaign.control_email_run" : "",
    recommendedInput:
      due && bestRoute
        ? {
            brandId: snapshot.brand.id,
            campaignId: activeCampaignId,
            runId: activeRunId,
            action: "resume_sender_deliverability",
            senderAccountId: bestRoute.accountId,
            reason: `Sender ${bestRoute.fromEmail} passed exact-copy inbox placement and is ready; promote it for the active run.`,
          }
      : {},
  };
}

function summarizeCampaignLaunch(snapshot: BrandActivationSnapshot) {
  const due = snapshotNeedsCampaignLaunch(snapshot);
  const campaignId = snapshot.outreach.campaignSummary.activeOutboundCampaignId;
  return {
    due,
    reason: due
      ? "A ready outbound campaign has no open run. Launching it creates real campaign-copy messages so sourcing, dispatch, and exact-copy deliverability tests can proceed."
      : "",
    campaignId,
    campaignName: snapshot.outreach.campaignSummary.activeOutboundCampaignName,
    readyOutboundCampaignCount: snapshot.outreach.campaignSummary.readyOutboundCampaignCount,
    inventory: snapshot.outreach.inventorySummary,
    recommendedTool: due ? "campaign.launch_email_run" : "",
    recommendedInput: due
      ? {
          brandId: snapshot.brand.id,
          campaignId,
          reason:
            "Ready outbound campaign is idle with no open run; launch a limited real-copy run so the autonomous system can source, schedule, test, and dispatch.",
        }
      : {},
  };
}

function emptyDecisionParts() {
  return {
    shouldCreateMission: false,
    shouldStartMission: false,
    shouldProvisionSender: false,
    refreshAccountId: "",
    targetCustomerText: "",
    leadRefill: {
      campaignId: "",
      experimentId: "",
      targetSendableLeads: 25,
      maxLiveTopUpPasses: 1,
    },
    runTool: {
      runId: "",
      targetLeadCount: 25,
    },
    placementTest: {
      runId: "",
      messageId: "",
      recentProbeCooldownHours: 12,
    },
    sender: {
      domainMode: "" as const,
      domain: "",
      domainCandidates: [] as string[],
      fromLocalPart: "",
      senderFirstName: "",
      senderLastName: "",
      accountName: "",
    },
    growthTool: {
      toolName: "",
      input: {} as Record<string, unknown>,
    },
  };
}

function buildProbeAllSenderTransportsDecision(
  snapshot: BrandActivationSnapshot
): ActivationDecision | null {
  const campaignId = snapshot.outreach.campaignSummary.activeOutboundCampaignId;
  const runId = snapshot.outreach.executionSummary.activeOutboundRunId;
  if (!campaignId || !runId) return null;
  return {
    brandId: snapshot.brand.id,
    action: "use_growth_tool",
    rationale:
      "Gmail UI exact-copy inbox placement landed in spam, so the next autonomous move is to test every available sender transport with the same campaign copy before scaling or choosing a route.",
    riskLevel: "guarded_write",
    ...emptyDecisionParts(),
    growthTool: {
      toolName: "campaign.control_email_run",
      input: {
        brandId: snapshot.brand.id,
        campaignId,
        runId,
        action: "probe_all_senders_deliverability",
        reason:
          "Gmail UI exact-copy inbox placement landed in spam; compare all available sender transports using the same campaign copy.",
      },
    },
  };
}

function buildPromoteVerifiedSenderRouteDecision(
  snapshot: BrandActivationSnapshot
): ActivationDecision | null {
  const campaignId = snapshot.outreach.campaignSummary.activeOutboundCampaignId;
  const runId = snapshot.outreach.executionSummary.activeOutboundRunId;
  const route = verifiedPromotableInboxRoutes(snapshot)[0] ?? null;
  if (!campaignId || !runId || !route) return null;
  return {
    brandId: snapshot.brand.id,
    action: "use_growth_tool",
    rationale:
      `Sender ${route.fromEmail} has exact-copy inbox placement evidence and is ready, so the autonomous next move is to promote that route for the active campaign run and resume dispatch instead of waiting for a human prompt.`,
    riskLevel: "guarded_write",
    ...emptyDecisionParts(),
    growthTool: {
      toolName: "campaign.control_email_run",
      input: {
        brandId: snapshot.brand.id,
        campaignId,
        runId,
        action: "resume_sender_deliverability",
        senderAccountId: route.accountId,
        accountId: route.accountId,
        reason:
          `Sender ${route.fromEmail} passed exact-copy inbox placement (${route.inboxCount}/${route.totalMonitors} inbox, ${route.spamCount} spam) and is ready; promote it for the active run.`,
      },
    },
  };
}

function buildProvisionCustomerIoFallbackDecision(input: {
  snapshot: BrandActivationSnapshot;
  config: ActivationConfig;
}): ActivationDecision | null {
  if (
    !input.config.allowGrowthTools ||
    !input.config.allowGuardedGrowthTools ||
    !input.config.allowSpendGrowthTools ||
    !input.config.allowDomainRegistration ||
    !input.config.registrant
  ) {
    return null;
  }
  const protectedDomain = normalizeDomain(input.snapshot.brand.website);
  const domainCandidates = fallbackDomainCandidates(input.snapshot.brand).filter(
    (domain) => domain && domain !== protectedDomain
  );
  const domain = domainCandidates[0] ?? "";
  if (!domain) return null;
  return {
    brandId: input.snapshot.brand.id,
    action: "use_growth_tool",
    rationale:
      "Gmail UI exact-copy placement is spam-heavy and no Customer.io route is assigned yet, so provision a Customer.io sender route for the agent to test with the real campaign copy.",
    riskLevel: "guarded_write",
    ...emptyDecisionParts(),
    growthTool: {
      toolName: "customerio.sender.provision",
      input: {
        brandId: input.snapshot.brand.id,
        domainMode: "register",
        domain,
        domainCandidates,
        fromLocalPart: "hello",
        accountName: `${input.snapshot.brand.name || "Brand"} Customer.io ${domain}`,
      },
    },
  };
}

function buildLaunchActiveCampaignDecision(snapshot: BrandActivationSnapshot): ActivationDecision | null {
  const campaignId = snapshot.outreach.campaignSummary.activeOutboundCampaignId;
  if (!campaignId) return null;
  return {
    brandId: snapshot.brand.id,
    action: "use_growth_tool",
    rationale:
      "A real outbound campaign is ready but idle with no open run. The autonomous next move is to launch a limited campaign run so real campaign-copy messages exist for sourcing, dispatch, inbox placement, and learning.",
    riskLevel: "guarded_write",
    ...emptyDecisionParts(),
    growthTool: {
      toolName: "campaign.launch_email_run",
      input: {
        brandId: snapshot.brand.id,
        campaignId,
        reason:
          "Ready outbound campaign is idle with no open run; launch a limited real-copy run so automation can keep moving.",
      },
    },
  };
}

function decisionHandlesTransportFallback(decision: ActivationDecision) {
  if (decision.action === "run_inbox_placement_test") return true;
  if (decision.action !== "use_growth_tool") return false;
  const toolName = decision.growthTool.toolName;
  const action = asString(decision.growthTool.input.action);
  return (
    toolName === "customerio.sender.provision" ||
    toolName === "provision_customerio_sender" ||
    (toolName === "campaign.control_email_run" &&
      (action === "probe_all_senders_deliverability" || action === "resume_sender_deliverability"))
  );
}

function decisionHandlesVerifiedTransportPromotion(decision: ActivationDecision) {
  if (decision.action !== "use_growth_tool") return false;
  return (
    decision.growthTool.toolName === "campaign.control_email_run" &&
    asString(decision.growthTool.input.action) === "resume_sender_deliverability"
  );
}

function decisionHandlesCampaignLaunch(decision: ActivationDecision) {
  return decision.action === "use_growth_tool" && decision.growthTool.toolName === "campaign.launch_email_run";
}

function applyAutonomousCampaignLaunch(input: {
  plan: ActivationPlan;
  snapshots: BrandActivationSnapshot[];
  config: ActivationConfig;
}) {
  const plannedLaunchBrandIds = new Set(
    input.plan.actions
      .filter(decisionHandlesCampaignLaunch)
      .map((decision) => decision.brandId)
  );
  const launchActions: ActivationDecision[] = [];
  for (const snapshot of input.snapshots) {
    if (!snapshotNeedsCampaignLaunch(snapshot)) continue;
    if (plannedLaunchBrandIds.has(snapshot.brand.id)) continue;
    const decision = buildLaunchActiveCampaignDecision(snapshot);
    if (!decision) continue;
    plannedLaunchBrandIds.add(snapshot.brand.id);
    launchActions.push(decision);
  }
  if (launchActions.length === 0) return input.plan;
  const actions = [
    ...launchActions,
    ...input.plan.actions.filter(
      (decision) =>
        !launchActions.some(
          (launch) => launch.brandId === decision.brandId && decision.action === "observe"
        )
    ),
  ].slice(0, input.config.maxActionsPerTick);
  return {
    summary: input.plan.summary
      ? `${input.plan.summary} Added autonomous launch for ready idle campaigns.`
      : "Added autonomous launch for ready idle campaigns.",
    actions,
  };
}

function applyAutonomousVerifiedTransportPromotion(input: {
  plan: ActivationPlan;
  snapshots: BrandActivationSnapshot[];
  config: ActivationConfig;
}) {
  const plannedPromotionBrandIds = new Set(
    input.plan.actions
      .filter(decisionHandlesVerifiedTransportPromotion)
      .map((decision) => decision.brandId)
  );
  const promotionActions: ActivationDecision[] = [];
  for (const snapshot of input.snapshots) {
    if (!snapshotNeedsVerifiedTransportPromotion(snapshot)) continue;
    if (plannedPromotionBrandIds.has(snapshot.brand.id)) continue;
    const decision = buildPromoteVerifiedSenderRouteDecision(snapshot);
    if (!decision) continue;
    plannedPromotionBrandIds.add(snapshot.brand.id);
    promotionActions.push(decision);
  }
  if (promotionActions.length === 0) return input.plan;
  const actions = [
    ...promotionActions,
    ...input.plan.actions.filter(
      (decision) =>
        !promotionActions.some(
          (promotion) => promotion.brandId === decision.brandId && decision.action === "observe"
        )
    ),
  ].slice(0, input.config.maxActionsPerTick);
  return {
    summary: input.plan.summary
      ? `${input.plan.summary} Added autonomous sender route promotion from live inbox evidence.`
      : "Added autonomous sender route promotion from live inbox evidence.",
    actions,
  };
}

function applyAutonomousTransportFallback(input: {
  plan: ActivationPlan;
  snapshots: BrandActivationSnapshot[];
  config: ActivationConfig;
}) {
  const plannedFallbackBrandIds = new Set(
    input.plan.actions
      .filter(decisionHandlesTransportFallback)
      .map((decision) => decision.brandId)
  );
  const fallbackActions: ActivationDecision[] = [];
  for (const snapshot of input.snapshots) {
    if (!snapshotNeedsTransportFallback(snapshot)) continue;
    if (plannedFallbackBrandIds.has(snapshot.brand.id)) continue;
    const customerIoRoutes = customerIoRouteEvidence(snapshot);
    const decision =
      customerIoRoutes.length > 0
        ? buildProbeAllSenderTransportsDecision(snapshot)
        : buildProvisionCustomerIoFallbackDecision({ snapshot, config: input.config });
    if (!decision) continue;
    plannedFallbackBrandIds.add(snapshot.brand.id);
    fallbackActions.push(decision);
  }
  if (fallbackActions.length === 0) return input.plan;
  const actions = [
    ...fallbackActions,
    ...input.plan.actions.filter(
      (decision) =>
        !fallbackActions.some(
          (fallback) => fallback.brandId === decision.brandId && decision.action === "observe"
        )
    ),
  ].slice(0, input.config.maxActionsPerTick);
  return {
    summary: input.plan.summary
      ? `${input.plan.summary} Added autonomous transport fallback for Gmail UI spam evidence.`
      : "Added autonomous transport fallback for Gmail UI spam evidence.",
    actions,
  };
}

function applyAutonomousEvidenceActions(input: {
  plan: ActivationPlan;
  snapshots: BrandActivationSnapshot[];
  config: ActivationConfig;
}) {
  return applyAutonomousCampaignLaunch({
    plan: applyAutonomousTransportFallback({
      plan: applyAutonomousVerifiedTransportPromotion(input),
      snapshots: input.snapshots,
      config: input.config,
    }),
    snapshots: input.snapshots,
    config: input.config,
  });
}

function buildAutonomousEvidenceOnlyPlan(input: {
  snapshots: BrandActivationSnapshot[];
  config: ActivationConfig;
  summary: string;
}) {
  return applyAutonomousEvidenceActions({
    plan: {
      summary: input.summary,
      actions: [],
    },
    snapshots: input.snapshots,
    config: input.config,
  });
}

function activationDecisionKey(decision: ActivationDecision) {
  return [
    decision.brandId,
    decision.action,
    decision.growthTool.toolName,
    decision.growthTool.input.action,
    decision.growthTool.input.runId,
    decision.growthTool.input.senderAccountId,
  ].join(":");
}

function mergeEvidenceFirstPlan(input: {
  evidencePlan: ActivationPlan;
  llmPlan: ActivationPlan;
  config: ActivationConfig;
}) {
  if (input.evidencePlan.actions.length === 0) return input.llmPlan;

  const actions = [...input.evidencePlan.actions];
  const seen = new Set(actions.map(activationDecisionKey));
  for (const decision of input.llmPlan.actions) {
    if (actions.length >= input.config.maxActionsPerTick) break;
    const key = activationDecisionKey(decision);
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push(decision);
  }

  return {
    summary: [input.evidencePlan.summary, input.llmPlan.summary].filter(Boolean).join(" "),
    actions,
  };
}

function snapshotNeedsAutonomousWork(snapshot: BrandActivationSnapshot) {
  if (snapshot.seedPool.needsRepair) {
    return true;
  }
  if (snapshotNeedsTransportFallback(snapshot)) {
    return true;
  }
  if (snapshotNeedsVerifiedTransportPromotion(snapshot)) {
    return true;
  }
  if (snapshotNeedsCampaignLaunch(snapshot)) {
    return true;
  }
  if (
    snapshotHasOpenOutboundWork(snapshot) &&
    !snapshotHasRepairableOpenOutboundWork(snapshot) &&
    !snapshotNeedsInboxPlacementTest(snapshot)
  ) {
    return false;
  }
  if (snapshot.outreach.senderSummary.readySenderCount === 0 && snapshot.outreach.senderSummary.warmingSenderCount === 0) {
    return true;
  }
  if (snapshotNeedsInboxPlacementTest(snapshot)) {
    return true;
  }
  if (snapshot.outreach.campaignSummary.activeOutboundCampaignCount === 0) {
    return true;
  }
  return snapshot.missions.some((mission) => Boolean(mission.primaryBlocker || mission.status === "deliverability_blocked"));
}

function summarizeEligibleWork(snapshots: BrandActivationSnapshot[]) {
  return snapshots
    .filter(snapshotNeedsAutonomousWork)
    .slice(0, 12)
    .map((snapshot) => ({
      brandId: snapshot.brand.id,
      brandName: snapshot.brand.name,
      website: snapshot.brand.website,
      primaryBlockerDomain: snapshot.outreach.primaryBlockerDomain,
      primaryBlockerCode: snapshot.outreach.primaryBlockerCode,
      primaryBlockerSummary: snapshot.outreach.primaryBlockerSummary,
      repairableOpenWork: snapshotHasRepairableOpenOutboundWork(snapshot),
      inboxPlacementCandidate: snapshotNeedsInboxPlacementTest(snapshot),
      campaignLaunch: summarizeCampaignLaunch(snapshot),
      transportFallback: summarizeTransportFallback(snapshot),
      transportPromotion: summarizeVerifiedTransportPromotion(snapshot),
      seedPool: snapshot.seedPool,
      senderSummary: snapshot.outreach.senderSummary,
      senderRouteEvidence: snapshot.outreach.senderRouteEvidence,
      campaignSummary: snapshot.outreach.campaignSummary,
      executionSummary: snapshot.outreach.executionSummary,
      missions: snapshot.missions.slice(0, 3),
    }));
}

function latestSnapshotMissionUpdatedAt(snapshot: BrandActivationSnapshot) {
  const missionLatest = snapshot.missions.reduce((latest, mission) => {
    const timestamp = toTimestamp(mission.updatedAt);
    return timestamp > latest ? timestamp : latest;
  }, 0);
  return snapshot.outreach.senderRouteEvidence.reduce((latest, evidence) => {
    const timestamp = toTimestamp(evidence.checkedAt);
    return timestamp > latest ? timestamp : latest;
  }, missionLatest);
}

async function readRecentActivationDecisionTimes(brandIds: string[], sinceIso: string) {
  const latestByBrandId = new Map<string, number>();
  if (brandIds.length === 0) return latestByBrandId;

  const supabase = getSupabaseAdmin();
  if (!supabase) return latestByBrandId;

  const { data, error } = await supabase
    .from("demanddev_mission_agent_decisions")
    .select("brand_id,created_at")
    .eq("agent", "brand_activation_operator")
    .in("brand_id", brandIds)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(Math.max(brandIds.length * 8, 50));

  if (error || !data) return latestByBrandId;

  for (const row of data as Array<{ brand_id?: string; created_at?: string }>) {
    const brandId = asString(row.brand_id);
    const timestamp = toTimestamp(asString(row.created_at));
    if (!brandId || timestamp <= 0) continue;
    latestByBrandId.set(brandId, Math.max(latestByBrandId.get(brandId) ?? 0, timestamp));
  }

  return latestByBrandId;
}

async function filterSnapshotsDueForPlanning(snapshots: BrandActivationSnapshot[], config: ActivationConfig) {
  const eligible = snapshots.filter(snapshotNeedsAutonomousWork);
  if (eligible.length === 0) {
    return { due: eligible, skipped: 0, eligible: 0 };
  }

  const cooldownMs = config.planCooldownMinutes * 60_000;
  const sinceIso = new Date(Date.now() - cooldownMs).toISOString();
  const recentByBrandId = await readRecentActivationDecisionTimes(
    eligible.map((snapshot) => snapshot.brand.id),
    sinceIso
  );

  const due = eligible.filter((snapshot) => {
    if (
      snapshotNeedsTransportFallback(snapshot) ||
      snapshotNeedsVerifiedTransportPromotion(snapshot) ||
      snapshotNeedsCampaignLaunch(snapshot)
    ) {
      return true;
    }
    const lastDecisionAt = recentByBrandId.get(snapshot.brand.id) ?? 0;
    if (lastDecisionAt <= 0) return true;
    return latestSnapshotMissionUpdatedAt(snapshot) > lastDecisionAt + 30_000;
  });

  return {
    due,
    skipped: eligible.length - due.length,
    eligible: eligible.length,
  };
}

async function buildSnapshots(config: ActivationConfig): Promise<BrandActivationSnapshot[]> {
  const [brands, statusResponse, seedPool] = await Promise.all([
    listBrands(),
    buildOutreachStatusResponse({ limitBrands: Math.max(config.limitBrands, 50) }),
    readDeliverabilitySeedPoolSnapshot(),
  ]);
  const brandById = new Map(brands.map((brand) => [brand.id, brand] as const));
  const statuses = statusResponse.brands.filter((status) => {
    const brand = brandById.get(status.brandId);
    if (config.brandAllowlist.size > 0 && !config.brandAllowlist.has(status.brandId)) return false;
    if (config.brandDenylist.has(status.brandId)) return false;
    if (!brand) return false;
    if (brandMatchesNameDenylist(brand, config.brandNameDenylist)) return false;
    return true;
  });

  const prioritized = statuses
    .map((status) => {
      const senderPriority =
        status.senderSummary.readySenderCount === 0
          ? status.senderSummary.assignedSenderCount === 0
            ? 80
            : 55
          : 0;
      const missionPriority = status.campaignSummary.activeOutboundCampaignCount === 0 ? 40 : 0;
      const blockedPriority = status.primaryBlockerDomain === "sender" ? 25 : 0;
      const placementPriority = statusNeedsInboxPlacementTest(status) ? 35 : 0;
      const transportFallbackPriority = statusNeedsTransportFallback(status) ? 70 : 0;
      const transportPromotionPriority = statusNeedsVerifiedTransportPromotion(status) ? 80 : 0;
      const campaignLaunchPriority = statusNeedsCampaignLaunch(status) ? 65 : 0;
      const livePenalty =
        hasOpenOutboundWork(status) &&
        placementPriority === 0 &&
        transportFallbackPriority === 0 &&
        transportPromotionPriority === 0 &&
        campaignLaunchPriority === 0
          ? -100
          : 0;
      return {
        status,
        score:
          senderPriority +
          missionPriority +
          blockedPriority +
          placementPriority +
          transportFallbackPriority +
          transportPromotionPriority +
          campaignLaunchPriority +
          livePenalty,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, config.limitBrands);

  return Promise.all(
    prioritized.map(async ({ status }) => {
      const brand = (await getBrandById(status.brandId, { includeEmbedded: true })) ?? brandById.get(status.brandId)!;
      const missions = await listMissions(brand.id).catch(() => []);
      return {
        brand: compactBrand(brand),
        outreach: {
          healthy: status.healthy,
          sendingToday: status.sendingToday,
          primaryBlockerDomain: status.primaryBlockerDomain,
          primaryBlockerCode: status.primaryBlockerCode,
          primaryBlockerSummary: status.primaryBlockerSummary,
          recommendedNextAction: status.recommendedNextAction,
          automaticAction: status.automaticAction,
          senderSummary: status.senderSummary,
          campaignSummary: status.campaignSummary,
          experimentSummary: status.experimentSummary,
          inventorySummary: status.inventorySummary,
          capacitySummary: status.capacitySummary,
          executionSummary: status.executionSummary,
          senderRouteEvidence: status.senderRouteEvidence,
        },
        seedPool,
        missions: missions.slice(0, 5).map(summarizeMission),
      } satisfies BrandActivationSnapshot;
    })
  );
}

async function planActivationWithLlm(input: {
  snapshots: BrandActivationSnapshot[];
  config: ActivationConfig;
}): Promise<{ plan: ActivationPlan; model: string }> {
  const evidenceFirstPlan = buildAutonomousEvidenceOnlyPlan({
    snapshots: input.snapshots,
    config: input.config,
    summary:
      "Used live evidence before GPT planning, so obvious sender-route or transport-fallback actions do not require an LLM call.",
  });
  const evidenceHandledBrandIds = new Set(evidenceFirstPlan.actions.map((action) => action.brandId));
  const remainingCapacity = input.config.maxActionsPerTick - evidenceFirstPlan.actions.length;
  const planningSnapshots =
    evidenceHandledBrandIds.size > 0
      ? input.snapshots.filter((snapshot) => !evidenceHandledBrandIds.has(snapshot.brand.id))
      : input.snapshots;
  const planningConfig: ActivationConfig = {
    ...input.config,
    maxActionsPerTick: Math.max(0, remainingCapacity),
  };
  const eligibleWork = summarizeEligibleWork(planningSnapshots);

  if (evidenceFirstPlan.actions.length > 0 && (planningConfig.maxActionsPerTick <= 0 || eligibleWork.length === 0)) {
    return {
      plan: evidenceFirstPlan,
      model: "evidence:first_pass",
    };
  }

  const growthToolCatalog = listGrowthToolCatalog()
    .filter((tool) => tool.enabled)
    .map((tool) => ({
      name: tool.name,
      provider: tool.provider,
      category: tool.category,
      capability: tool.capability,
      description: tool.description,
      risk: tool.risk,
      inputSchema: tool.inputSchema,
    }));
  const prompt = [
    "You are the GPT mission operator inside LastB2B.",
    "The product goal is: user enters a site and target customers, then the system handles campaign planning, lead sourcing, deliverability, inbox/domain setup, warmup, inbox placement testing, launch, and learning over time.",
    "You are choosing the next autonomous backend actions. You are not following a hardcoded playbook; choose tools dynamically from evidence and expected impact. Return strict JSON only.",
    "",
    "Allowed actions:",
    "- activate_brand: create/start a mission and optionally provision a sender.",
    "- start_existing_mission: start a plan_ready or draft mission using its generated plan.",
    "- continue_ready_mission: launch a deliverability_blocked mission only if deliverability is now ready.",
    "- refill_campaign_leads: create/use a sender-owned scale campaign for the mission experiment, run EnrichAnything plus configured email-finder waterfall prep, then continue if deliverability and inventory are ready.",
    "- source_more_leads: ask the active run to source/top up real sendable leads for the current campaign copy.",
    "- repair_outreach_run: repair the active run/job path when a run is stuck, missing a source/schedule/dispatch job, duplicated, or carrying stale failure state.",
    "- repair_seed_pool: repair the deliverability monitor seed pool by releasing stale inbox-placement reservations, rechecking inactive/error monitor mailboxes, reactivating connected monitors, and disabling excluded/broken monitors.",
    "- run_inbox_placement_test: queue an inbox-placement test using the actual scheduled/sent campaign subject and body from an active run.",
    "- provision_mailpool_sender: buy/attach a Mailpool sender when the brand has no usable sender and a real inbox is needed.",
    "- refresh_mailpool_sender: refresh a pending Mailpool sender using refreshAccountId.",
    "- use_growth_tool: call a registered growth capability by name when it is the best next action or when an older fixed action is too narrow. Put the chosen tool name and structured input in growthTool.",
    "  - For ready idle outbound campaigns, use campaign.launch_email_run so real campaign-copy messages are created and the rest of the system can source, schedule, test, and dispatch.",
    "- observe: do nothing when action is unsafe, premature, or insufficiently grounded.",
    "",
    "Growth tool registry:",
    "- The registry is a catalog of capabilities, not a strategy script. You decide whether a tool is worth using and what input it needs.",
    "- Never invent IDs, LinkedIn account IDs, campaign URLs, managed table IDs, run IDs, or message copy. If a required input is unknown, inspect state first or choose observe.",
    "- Prefer actual campaign copy for delivery, email, and LinkedIn outreach tools. Do not use synthetic probe copy for deliverability-sensitive decisions.",
    "- Spend-risk or reputation-risk tools may be blocked by runtime guardrails; still choose them when they are the correct action and the evidence supports it.",
    "",
    "Decision rules:",
    "- Prefer one high-leverage action over many shallow actions.",
    "- Do not touch brands that already have healthy open outbound work except for run_inbox_placement_test. You may choose repair_outreach_run or source_more_leads for open work only when the execution/inventory state is stuck, missing jobs, due with no dispatch job, duplicated, or under-sourced.",
    "- Skip QA/test/repro brands unless they clearly represent a real campaign.",
    "- If a brand has a real website and clear ICP/product context but no mission, create and start a mission.",
    "- If a brand has no ready/warming/provisioning sender, and domain registration is allowed, choose the best sender transport from the tool catalog. Prefer customerio.sender.provision when a verified Customer.io sending domain plus real Reply-To mailbox is enough; prefer Mailpool when a full mailbox/inbox is required.",
    "- If a mission is blocked by no EnrichAnything-backed sendable leads, no campaign-owned inventory, or no sendable leads, and the brand has a ready sender, choose refill_campaign_leads. Set leadRefill.experimentId to the mission currentExperimentId when present, campaignId only when known, targetSendableLeads to a realistic first-batch pool, and maxLiveTopUpPasses to 1-3.",
    "- If an active run is queued/sourcing/scheduled/sending but appears stuck, choose repair_outreach_run and put the activeOutboundRunId in runTool.runId.",
    "- If an active run needs more prospects, has inventory/top-up errors, or is below the intended batch size, choose source_more_leads and set runTool.targetLeadCount to the desired total sendable leads for that run.",
    "- If activeOutboundCampaignId is present, readyOutboundCampaignCount > 0, there is no activeOutboundRunId/open run, and sender/inventory state is not structurally blocked, choose use_growth_tool with campaign.launch_email_run. Do not wait for a human to press launch.",
    "- If seedPool.needsRepair is true, prefer repair_seed_pool before trying more inbox placement tests. This is infrastructure repair; do not also create missions or provision senders in the same action.",
    "- Do not choose repair_seed_pool when seedPool.needsRepair is false. Historical failed monitor counts alone are not actionable when activeUsable and availableUsableEstimate are healthy.",
    "- If an active run has real scheduled or sent campaign messages and no other urgent blocker, choose run_inbox_placement_test early in the run so deliverability is measured on the real copy before volume ramps. Put activeOutboundRunId in placementTest.runId. Leave placementTest.messageId blank unless you know the exact message.",
    "- Inbox placement tests must use actual campaign copy, never synthetic delivery-probe copy. The runtime will skip duplicates when a recent production probe already exists.",
    "- If transportFallback.due is true because Gmail UI landed in spam, do not wait for a human to ask. If a Customer.io route exists, choose use_growth_tool with campaign.control_email_run and action probe_all_senders_deliverability so all available transports are tested against the same real campaign copy. If no Customer.io route exists, choose customerio.sender.provision when growth tools and spend guardrails allow it.",
    "- If transportPromotion.due is true because a ready sender route has exact-copy inbox evidence, do not ask the user what to do. Choose use_growth_tool with campaign.control_email_run, action resume_sender_deliverability, and senderAccountId set to the proven ready account. This promotes the route and resumes the active run.",
    "- Never choose the brand's primary website domain as the sender domain. Choose a related but separate sending domain and provide alternatives.",
    "- Choose targetCustomerText from the brand's actual product, ICPs, target markets, and notes. Do not invent unsupported proof or claims.",
    "- Lead refill must prepare real campaign prospects for the actual mission messaging, not synthetic delivery probes.",
    "- Mission start is safe: the runtime will still block sends until deliverability is ready.",
    "- Provisioning a new domain is guarded but allowed when allowDomainRegistration is true.",
    "- Only choose refresh_mailpool_sender when you have a concrete refreshAccountId. Otherwise choose observe or a mission action.",
    "- Sender first/last names must look like a real operator name, not the brand name, mailbox local-part, or domain.",
    "- The output should explain why the action is the right next move, because users need to see GPT's reasoning after the fact.",
    "- If eligibleWork JSON is non-empty, actions must contain at least one non-observe action. Returning an empty actions array is invalid.",
    "- If a mission is deliverability_blocked because no sending route is assigned, and no ready/warming/provisioning sender exists, choose customerio.sender.provision through use_growth_tool or provision_mailpool_sender based on which transport is most likely to unblock exact-copy placement tests.",
    "",
    `allowDomainRegistration: ${planningConfig.allowDomainRegistration}`,
    `allowGrowthTools: ${planningConfig.allowGrowthTools}`,
    `allowGuardedGrowthTools: ${planningConfig.allowGuardedGrowthTools}`,
    `allowSpendGrowthTools: ${planningConfig.allowSpendGrowthTools}`,
    `allowReputationGrowthTools: ${planningConfig.allowReputationGrowthTools}`,
    `maxActions: ${planningConfig.maxActionsPerTick}`,
    `hasRegistrantForDomainPurchases: ${Boolean(planningConfig.registrant)}`,
    `evidenceFirstActionsAlreadyPlanned JSON: ${JSON.stringify(evidenceFirstPlan.actions)}`,
    `growthToolCatalog JSON: ${JSON.stringify(growthToolCatalog)}`,
    `eligibleWork JSON: ${JSON.stringify(eligibleWork)}`,
    `brand snapshots JSON: ${JSON.stringify(planningSnapshots)}`,
  ].join("\n");

  const schema = {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              actions: {
                type: "array",
                minItems: eligibleWork.length > 0 ? 1 : 0,
                maxItems: planningConfig.maxActionsPerTick,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    brandId: { type: "string" },
                    action: {
                      type: "string",
                      enum: [
                        "activate_brand",
                        "start_existing_mission",
                        "continue_ready_mission",
                        "refill_campaign_leads",
                        "source_more_leads",
                        "repair_outreach_run",
                        "repair_seed_pool",
                        "run_inbox_placement_test",
                        "provision_mailpool_sender",
                        "refresh_mailpool_sender",
                        "use_growth_tool",
                        "observe",
                      ],
                    },
                    rationale: { type: "string" },
                    riskLevel: {
                      type: "string",
                      enum: ["read", "safe_write", "guarded_write", "blocked"],
                    },
                    shouldCreateMission: { type: "boolean" },
                    shouldStartMission: { type: "boolean" },
                    shouldProvisionSender: { type: "boolean" },
                    refreshAccountId: { type: "string" },
                    targetCustomerText: { type: "string" },
                    leadRefill: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        campaignId: { type: "string" },
                        experimentId: { type: "string" },
                        targetSendableLeads: { type: "integer", minimum: 10, maximum: 250 },
                        maxLiveTopUpPasses: { type: "integer", minimum: 1, maximum: 3 },
                      },
                      required: [
                        "campaignId",
                        "experimentId",
                        "targetSendableLeads",
                        "maxLiveTopUpPasses",
                      ],
                    },
                    runTool: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        runId: { type: "string" },
                        targetLeadCount: { type: "integer", minimum: 1, maximum: 500 },
                      },
                      required: ["runId", "targetLeadCount"],
                    },
                    placementTest: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        runId: { type: "string" },
                        messageId: { type: "string" },
                        recentProbeCooldownHours: { type: "integer", minimum: 1, maximum: 72 },
                      },
                      required: ["runId", "messageId", "recentProbeCooldownHours"],
                    },
                    sender: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        domainMode: { type: "string", enum: ["register", "existing", ""] },
                        domain: { type: "string" },
                        domainCandidates: {
                          type: "array",
                          items: { type: "string" },
                        },
                        fromLocalPart: { type: "string" },
                        senderFirstName: { type: "string" },
                        senderLastName: { type: "string" },
                        accountName: { type: "string" },
                      },
                      required: [
                        "domainMode",
                        "domain",
                        "domainCandidates",
                        "fromLocalPart",
                        "senderFirstName",
                        "senderLastName",
                        "accountName",
                      ],
                    },
                    growthTool: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        toolName: { type: "string" },
                        input: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            brandId: { type: "string" },
                            accountId: { type: "string" },
                            mailboxAccountId: { type: "string" },
                            campaignId: { type: "string" },
                            experimentId: { type: "string" },
                            runId: { type: "string" },
                            senderAccountId: { type: "string" },
                            missionId: { type: "string" },
                            draftId: { type: "string" },
                            channelRunId: { type: "string" },
                            userId: { type: "string" },
                            action: { type: "string" },
                            reason: { type: "string" },
                            name: { type: "string" },
                            campaignName: { type: "string" },
                            audience: { type: "string" },
                            offer: { type: "string" },
                            status: { type: "string" },
                            domainMode: { type: "string" },
                            domain: { type: "string" },
                            domainCandidates: {
                              type: "array",
                              items: { type: "string" },
                            },
                            fromLocalPart: { type: "string" },
                            senderFirstName: { type: "string" },
                            senderLastName: { type: "string" },
                            accountName: { type: "string" },
                            campaignUrl: { type: "string" },
                            managedTableId: { type: "string" },
                            message: { type: "string" },
                            limit: { type: "number" },
                            targetLeadCount: { type: "number" },
                            workflowActionOrder: {
                              type: "array",
                              items: { type: "string" },
                            },
                          },
                          required: [
                            "brandId",
                            "accountId",
                            "mailboxAccountId",
                            "campaignId",
                            "experimentId",
                            "runId",
                            "senderAccountId",
                            "missionId",
                            "draftId",
                            "channelRunId",
                            "userId",
                            "action",
                            "reason",
                            "name",
                            "campaignName",
                            "audience",
                            "offer",
                            "status",
                            "domainMode",
                            "domain",
                            "domainCandidates",
                            "fromLocalPart",
                            "senderFirstName",
                            "senderLastName",
                            "accountName",
                            "campaignUrl",
                            "managedTableId",
                            "message",
                            "limit",
                            "targetLeadCount",
                            "workflowActionOrder",
                          ],
                        },
                      },
                      required: ["toolName", "input"],
                    },
                  },
                  required: [
                    "brandId",
                    "action",
                    "rationale",
                    "riskLevel",
                    "shouldCreateMission",
                    "shouldStartMission",
                    "shouldProvisionSender",
                    "refreshAccountId",
                    "targetCustomerText",
                    "leadRefill",
                    "runTool",
                    "placementTest",
                    "sender",
                    "growthTool",
                  ],
                },
              },
            },
            required: ["summary", "actions"],
  } satisfies Record<string, unknown>;
  let generated: Awaited<ReturnType<typeof generateJsonWithLlm>>;
  try {
    generated = await generateJsonWithLlm({
      task: "mission_operator",
      prompt,
      format: {
        type: "json_schema",
        name: "brand_activation_plan",
        schema,
      },
      maxOutputTokens: 1800,
      reasoningEffort: asString(process.env.OPENAI_MISSION_REASONING_EFFORT) || "high",
      openAiOverrideModel: asString(process.env.OPENAI_MODEL_MISSION_OPERATOR),
      openRouterOverrideModel: asString(process.env.OPENROUTER_MODEL_MISSION_OPERATOR),
    });
  } catch (error) {
    try {
      const relaxed = await generateJsonWithLlm({
        task: "mission_operator",
        prompt: [
          prompt,
          "",
          "The strict JSON schema interface was unavailable for this turn. Return the same plan shape as plain JSON with summary and actions.",
          "Use the exact action names and tool names from the prompt. Do not include markdown.",
        ].join("\n"),
        format: { type: "json_object" },
        maxOutputTokens: 1800,
        reasoningEffort: asString(process.env.OPENAI_MISSION_REASONING_EFFORT) || "high",
        openAiOverrideModel: asString(process.env.OPENAI_MODEL_MISSION_OPERATOR),
        openRouterOverrideModel: asString(process.env.OPENROUTER_MODEL_MISSION_OPERATOR),
      });
      let relaxedParsed: unknown = {};
      try {
        relaxedParsed = JSON.parse(relaxed.text || "{}");
      } catch {
        relaxedParsed = {};
      }
      let relaxedPlan = applyAutonomousEvidenceActions({
        plan: normalizeActivationPlan(relaxedParsed, planningConfig.maxActionsPerTick),
        snapshots: planningSnapshots,
        config: planningConfig,
      });
      if (eligibleWork.length > 0 && relaxedPlan.actions.length === 0) {
        const relaxedRetry = await generateJsonWithLlm({
          task: "mission_operator",
          prompt: [
            prompt,
            "",
            "Your previous relaxed JSON response normalized to zero executable actions even though eligibleWork is non-empty.",
            "Return at least one concrete backend action as plain JSON with summary and actions. Do not include markdown.",
            "A status summary without an action is invalid. If the brand lacks a sender, provision or refresh the sender route. If a campaign is ready and idle, launch it. If a run is stuck, repair it.",
          ].join("\n"),
          format: { type: "json_object" },
          maxOutputTokens: 1800,
          reasoningEffort: asString(process.env.OPENAI_MISSION_REASONING_EFFORT) || "high",
          openAiOverrideModel: asString(process.env.OPENAI_MODEL_MISSION_OPERATOR),
          openRouterOverrideModel: asString(process.env.OPENROUTER_MODEL_MISSION_OPERATOR),
        });
        let relaxedRetryParsed: unknown = {};
        try {
          relaxedRetryParsed = JSON.parse(relaxedRetry.text || "{}");
        } catch {
          relaxedRetryParsed = {};
        }
        relaxedPlan = applyAutonomousEvidenceActions({
          plan: normalizeActivationPlan(relaxedRetryParsed, planningConfig.maxActionsPerTick),
          snapshots: planningSnapshots,
          config: planningConfig,
        });
      }
      if (eligibleWork.length > 0 && relaxedPlan.actions.length === 0) {
        throw new Error("Relaxed mission operator plan returned zero executable actions for eligible work.");
      }
      return {
        plan: mergeEvidenceFirstPlan({
          evidencePlan: evidenceFirstPlan,
          llmPlan: relaxedPlan,
          config: input.config,
        }),
        model:
          evidenceFirstPlan.actions.length > 0
            ? `evidence:first_pass+${relaxed.provider}:${relaxed.model}:relaxed_json`
            : `${relaxed.provider}:${relaxed.model}:relaxed_json`,
      };
    } catch {
      // Fall through to evidence-only recovery below.
    }
    const fallbackPlan =
      evidenceFirstPlan.actions.length > 0
        ? evidenceFirstPlan
        : buildAutonomousEvidenceOnlyPlan({
            snapshots: input.snapshots,
            config: input.config,
            summary:
              "LLM planning was unavailable after strict and relaxed JSON attempts, so LastB2B used live deliverability evidence only.",
          });
    if (fallbackPlan.actions.length > 0) {
      return {
        plan: fallbackPlan,
        model: "evidence:first_pass:llm_unavailable",
      };
    }
    throw error;
  }
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(generated.text || "{}");
  } catch {
    parsed = {};
  }
  const plan = applyAutonomousEvidenceActions({
    plan: normalizeActivationPlan(parsed, planningConfig.maxActionsPerTick),
    snapshots: planningSnapshots,
    config: planningConfig,
  });
  if (eligibleWork.length > 0 && plan.actions.length === 0) {
    let retry: Awaited<ReturnType<typeof generateJsonWithLlm>>;
    try {
      retry = await generateJsonWithLlm({
        task: "mission_operator",
        prompt: [
          prompt,
          "",
          "Your previous response normalized to zero actions even though eligibleWork is non-empty.",
          "Return at least one concrete backend action now. Do not return an empty actions array.",
          "If you think a brand should not launch yet, provision or refresh the sender/domain/warmup prerequisite instead.",
        ].join("\n"),
        format: {
          type: "json_schema",
          name: "brand_activation_plan",
          schema,
        },
        maxOutputTokens: 1800,
        reasoningEffort: asString(process.env.OPENAI_MISSION_REASONING_EFFORT) || "high",
        openAiOverrideModel: asString(process.env.OPENAI_MODEL_MISSION_OPERATOR),
        openRouterOverrideModel: asString(process.env.OPENROUTER_MODEL_MISSION_OPERATOR),
      });
    } catch (error) {
      try {
        const relaxedRetry = await generateJsonWithLlm({
          task: "mission_operator",
          prompt: [
            prompt,
            "",
            "Your previous response normalized to zero actions, and the strict JSON schema retry was unavailable.",
            "Return at least one concrete backend action as plain JSON with summary and actions. Do not include markdown.",
          ].join("\n"),
          format: { type: "json_object" },
          maxOutputTokens: 1800,
          reasoningEffort: asString(process.env.OPENAI_MISSION_REASONING_EFFORT) || "high",
          openAiOverrideModel: asString(process.env.OPENAI_MODEL_MISSION_OPERATOR),
          openRouterOverrideModel: asString(process.env.OPENROUTER_MODEL_MISSION_OPERATOR),
        });
        let relaxedRetryParsed: unknown = {};
        try {
          relaxedRetryParsed = JSON.parse(relaxedRetry.text || "{}");
        } catch {
          relaxedRetryParsed = {};
        }
        const relaxedRetryPlan = applyAutonomousEvidenceActions({
          plan: normalizeActivationPlan(relaxedRetryParsed, planningConfig.maxActionsPerTick),
          snapshots: planningSnapshots,
          config: planningConfig,
        });
        if (eligibleWork.length > 0 && relaxedRetryPlan.actions.length === 0) {
          throw new Error("Relaxed retry plan returned zero executable actions for eligible work.");
        }
        return {
          plan: mergeEvidenceFirstPlan({
            evidencePlan: evidenceFirstPlan,
            llmPlan: relaxedRetryPlan,
            config: input.config,
          }),
          model:
            evidenceFirstPlan.actions.length > 0
              ? `evidence:first_pass+${relaxedRetry.provider}:${relaxedRetry.model}:relaxed_json`
              : `${relaxedRetry.provider}:${relaxedRetry.model}:relaxed_json`,
        };
      } catch {
        // Fall through to evidence-only recovery below.
      }
      const fallbackPlan =
        evidenceFirstPlan.actions.length > 0
          ? evidenceFirstPlan
          : buildAutonomousEvidenceOnlyPlan({
              snapshots: input.snapshots,
              config: input.config,
              summary:
                "LLM retry planning was unavailable after strict and relaxed JSON attempts, so LastB2B used live deliverability evidence only.",
            });
      if (fallbackPlan.actions.length > 0) {
        return {
          plan: fallbackPlan,
          model: "evidence:first_pass:llm_unavailable",
        };
      }
      throw error;
    }
    let retryParsed: unknown = {};
    try {
      retryParsed = JSON.parse(retry.text || "{}");
    } catch {
      retryParsed = {};
    }
    const retryPlan = applyAutonomousEvidenceActions({
      plan: normalizeActivationPlan(retryParsed, planningConfig.maxActionsPerTick),
      snapshots: planningSnapshots,
      config: planningConfig,
    });
    if (eligibleWork.length > 0 && retryPlan.actions.length === 0) {
      const fallbackPlan =
        evidenceFirstPlan.actions.length > 0
          ? evidenceFirstPlan
          : buildAutonomousEvidenceOnlyPlan({
              snapshots: input.snapshots,
              config: input.config,
              summary:
                "LLM retry planning returned zero executable actions, so LastB2B used live evidence only.",
            });
      if (fallbackPlan.actions.length > 0) {
        return {
          plan: fallbackPlan,
          model: "evidence:first_pass:llm_zero_action_retry",
        };
      }
      throw new Error("Mission operator retry returned zero executable actions for eligible work.");
    }
    return {
      plan: mergeEvidenceFirstPlan({
        evidencePlan: evidenceFirstPlan,
        llmPlan: retryPlan,
        config: input.config,
      }),
      model:
        evidenceFirstPlan.actions.length > 0
          ? `evidence:first_pass+${retry.provider}:${retry.model}`
          : `${retry.provider}:${retry.model}`,
    };
  }
  return {
    plan: mergeEvidenceFirstPlan({
      evidencePlan: evidenceFirstPlan,
      llmPlan: plan,
      config: input.config,
    }),
    model:
      evidenceFirstPlan.actions.length > 0
        ? `evidence:first_pass+${generated.provider}:${generated.model}`
        : `${generated.provider}:${generated.model}`,
  };
}

async function createAndStartMission(input: {
  brand: BrandRecord;
  targetCustomerText: string;
  decision: ActivationDecision;
  dryRun: boolean;
}) {
  const existingMission = latestActionableMission(await listMissions(input.brand.id).catch(() => []));
  if (existingMission) {
    return {
      mission: existingMission,
      generatedPlan: planIsComplete(existingMission.generatedPlan) ? existingMission.generatedPlan : existingMission.approvedPlan,
      dryRun: input.dryRun,
      reusedExisting: true,
    };
  }
  const websiteUrl = input.brand.website.trim();
  if (!websiteUrl) {
    throw new Error("Brand has no website URL, so the mission cannot be generated.");
  }
  const targetCustomerText = input.targetCustomerText.trim();
  if (!targetCustomerText) {
    throw new Error("The activation plan did not provide target customers.");
  }
  if (input.dryRun) {
    return {
      mission: null,
      generatedPlan: null,
      dryRun: true,
    };
  }

  const generated = await generateMissionPlan({
    brand: input.brand,
    websiteUrl,
    targetCustomerText,
  });
  const mission = await createMission({
    brandId: input.brand.id,
    websiteUrl: generated.website.url,
    targetCustomerText,
    generatedPlan: generated.plan,
    status: "plan_ready",
  });
  await createMissionEvent({
    missionId: mission.id,
    brandId: input.brand.id,
    eventType: "autonomous_plan_generated",
    summary: "GPT generated a mission plan during autonomous brand activation.",
    payload: {
      model: generated.model,
      website: {
        url: generated.website.url,
        hostname: generated.website.hostname,
        title: generated.website.title,
        description: generated.website.description,
      },
    },
  });
  await createMissionAgentDecision({
    missionId: mission.id,
    brandId: input.brand.id,
    agent: "brand_activation_operator",
    action: "create_mission",
    rationale: input.decision.rationale,
    riskLevel: "safe_write",
    input: {
      websiteUrl,
      targetCustomerText,
    },
    output: {
      plan: generated.plan,
      model: generated.model,
    },
  });

  if (!input.decision.shouldStartMission) {
    return { mission, generatedPlan: generated.plan, dryRun: false };
  }

  const started = await startMission({
    brandId: input.brand.id,
    missionId: mission.id,
    approvedPlan: generated.plan,
  });
  return { mission: started, generatedPlan: generated.plan, dryRun: false };
}

async function startExistingMission(input: {
  brand: BrandRecord;
  mission: Mission;
  decision: ActivationDecision;
  dryRun: boolean;
}) {
  const plan = planIsComplete(input.mission.generatedPlan)
    ? input.mission.generatedPlan
    : input.mission.approvedPlan;
  if (!planIsComplete(plan)) {
    throw new Error("Existing mission does not have a complete generated or approved plan.");
  }
  if (input.dryRun) return input.mission;
  await createMissionAgentDecision({
    missionId: input.mission.id,
    brandId: input.brand.id,
    agent: "brand_activation_operator",
    action: "start_existing_mission",
    rationale: input.decision.rationale,
    riskLevel: "guarded_write",
    input: { missionId: input.mission.id },
    output: { plan },
  });
  return startMission({
    brandId: input.brand.id,
    missionId: input.mission.id,
    approvedPlan: plan,
  });
}

async function resolveReadySenderForLeadRefill(input: {
  brandId: string;
  status: OutreachBrandStatus;
}) {
  const [pool, assignment] = await Promise.all([
    getCanonicalSenderPoolForBrand(input.brandId).catch(() => null),
    getBrandOutreachAssignment(input.brandId).catch(() => null),
  ]);
  const assignedAccountIds = new Set(
    [
      assignment?.accountId ?? "",
      ...(assignment?.accountIds ?? []),
      assignment?.mailboxAccountId ?? "",
    ]
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const readySenders = (pool?.senders ?? []).filter(
    (sender) => sender.state === "ready" && sender.deliveryAccountId
  );
  const selected =
    readySenders.find(
      (sender) =>
        assignedAccountIds.has(sender.deliveryAccountId) ||
        (sender.mailboxAccountId && assignedAccountIds.has(sender.mailboxAccountId))
    ) ??
    readySenders.sort((left, right) => right.readinessScore - left.readinessScore)[0] ??
    null;
  const accountId =
    selected?.deliveryAccountId ||
    assignment?.accountId ||
    assignment?.accountIds?.find((accountId) => accountId.trim()) ||
    "";
  const mailboxAccountId =
    selected?.mailboxAccountId ||
    assignment?.mailboxAccountId ||
    accountId;

  if (!accountId.trim()) {
    throw new Error("Lead refill requires a ready sender account, but no sender account is assigned.");
  }
  if (!selected && input.status.senderSummary.readySenderCount <= 0) {
    throw new Error("Lead refill requires a ready sender before real outreach can be launched.");
  }

  return {
    accountId: accountId.trim(),
    mailboxAccountId: mailboxAccountId.trim() || accountId.trim(),
    fromEmail: selected?.fromEmail ?? "",
    senderId: selected?.id ?? "",
  };
}

async function findScaleCampaignForExperiment(input: {
  brandId: string;
  experimentId: string;
  campaignId?: string;
}) {
  const campaigns = await listScaleCampaignRecords(input.brandId).catch(() => []);
  const requestedCampaignId = String(input.campaignId ?? "").trim();
  if (requestedCampaignId) {
    const campaign = campaigns.find((candidate) => candidate.id === requestedCampaignId) ?? null;
    if (campaign) return campaign;
  }

  const experiment = await getExperimentRecordById(input.brandId, input.experimentId);
  if (experiment?.promotedCampaignId.trim()) {
    const campaign =
      campaigns.find((candidate) => candidate.id === experiment.promotedCampaignId.trim()) ?? null;
    if (campaign) return campaign;
  }

  return (
    campaigns.find(
      (campaign) =>
        campaign.sourceExperimentId === input.experimentId &&
        resolveScaleCampaignLane(campaign) === "outbound" &&
        campaign.status !== "archived"
    ) ??
    null
  );
}

async function ensureMissionLeadCampaign(input: {
  brand: BrandRecord;
  mission: Mission;
  decision: ActivationDecision;
  status: OutreachBrandStatus;
}) {
  const experimentId =
    input.decision.leadRefill.experimentId.trim() || input.mission.currentExperimentId.trim();
  if (!experimentId) {
    throw new Error("Lead refill requires a mission experiment ID.");
  }

  const sender = await resolveReadySenderForLeadRefill({
    brandId: input.brand.id,
    status: input.status,
  });
  const targetSendableLeads = clampLeadRefillTarget(
    input.decision.leadRefill.targetSendableLeads,
    clampFirstBatch(input.mission.approvedPlan.firstBatchSize)
  );
  const requestedCampaign = await findScaleCampaignForExperiment({
    brandId: input.brand.id,
    experimentId,
    campaignId: input.decision.leadRefill.campaignId,
  });
  const targetDailyCap = Math.max(1, Math.ceil(targetSendableLeads / 3));
  const basePatch = {
    accountId: sender.accountId,
    mailboxAccountId: sender.mailboxAccountId,
    lane: "outbound" as const,
    dailyCap: targetDailyCap,
    hourlyCap: Math.max(1, Math.min(6, Math.ceil(targetDailyCap / 3))),
  };

  const campaign =
    requestedCampaign ??
    (await createScaleCampaignRecordFromExperiment({
      brandId: input.brand.id,
      experimentId,
      campaignName: `${input.brand.name || "Brand"} Mission Lead Pool`,
      status: "active",
      lane: "outbound",
      scalePolicy: basePatch,
    }));

  const updated =
    (await updateScaleCampaignRecord(input.brand.id, campaign.id, {
      status: campaign.status === "archived" || campaign.status === "completed" ? "active" : campaign.status,
      scalePolicy: {
        ...campaign.scalePolicy,
        ...basePatch,
      },
    })) ?? campaign;

  return {
    campaign: updated,
    sender,
    targetSendableLeads,
  };
}

async function findMissionLaunchCampaign(input: {
  brandId: string;
  mission: Mission;
}): Promise<ScaleCampaignRecord | null> {
  const experimentId = input.mission.currentExperimentId.trim();
  if (!experimentId) return null;
  const campaign = await findScaleCampaignForExperiment({
    brandId: input.brandId,
    experimentId,
  });
  if (!campaign || resolveScaleCampaignLane(campaign) !== "outbound") return null;
  return campaign;
}

async function refillCampaignLeadsForMission(input: {
  brand: BrandRecord;
  mission: Mission;
  status: OutreachBrandStatus;
  decision: ActivationDecision;
  dryRun: boolean;
}) {
  const ensured = await ensureMissionLeadCampaign({
    brand: input.brand,
    mission: input.mission,
    status: input.status,
    decision: input.decision,
  });
  const before = await countScaleCampaignSendableLeadContacts(input.brand.id, ensured.campaign.id);
  if (input.dryRun) {
    return {
      dryRun: true,
      campaignId: ensured.campaign.id,
      sourceExperimentId: ensured.campaign.sourceExperimentId,
      targetSendableLeads: ensured.targetSendableLeads,
      sender: ensured.sender,
      before,
    };
  }

  const prep = await prepareScaleCampaignSendableContacts({
    brandId: input.brand.id,
    campaignId: ensured.campaign.id,
    requestOrigin: "brand_activation_autopilot",
    allowLiveTopUp: true,
    backgroundMode: false,
    maxLiveTopUpPasses: input.decision.leadRefill.maxLiveTopUpPasses,
  });
  const after = await countScaleCampaignSendableLeadContacts(input.brand.id, ensured.campaign.id);
  await createMissionAgentDecision({
    missionId: input.mission.id,
    brandId: input.brand.id,
    agent: "brand_activation_operator",
    action: "refill_campaign_leads",
    rationale: input.decision.rationale,
    riskLevel: prep.ready || prep.dispatchable ? "guarded_write" : "blocked",
    input: {
      missionId: input.mission.id,
      experimentId: ensured.campaign.sourceExperimentId,
      campaignId: ensured.campaign.id,
      targetSendableLeads: ensured.targetSendableLeads,
      maxLiveTopUpPasses: input.decision.leadRefill.maxLiveTopUpPasses,
    },
    output: {
      sender: ensured.sender,
      before,
      after,
      prep: {
        ready: prep.ready,
        dispatchable: prep.dispatchable,
        blockingState: prep.blockingState,
        blockingReason: prep.blockingReason,
        blockingHint: prep.blockingHint,
        targetCount: prep.targetCount,
        sendableLeadCount: prep.sendableLeadCount,
        importedCount: prep.importedCount,
        matchedCount: prep.matchedCount,
        enrichmentError: prep.enrichmentError,
        failureSummary: prep.failureSummary,
        qualityRejectionSummary: prep.qualityRejectionSummary,
        liveTopUpAttempted: prep.liveTopUpAttempted,
        liveTopUpAttempts: prep.liveTopUpAttempts,
        liveTopUpStatus: prep.liveTopUpStatus,
        liveTopUpRowsAppended: prep.liveTopUpRowsAppended,
      },
    },
  });
  await createMissionEvent({
    missionId: input.mission.id,
    brandId: input.brand.id,
    eventType: "autonomous_lead_inventory_refilled",
    summary: prep.dispatchable
      ? `Autonomous operator prepared ${after.sendableLeadCount} sendable campaign-owned leads.`
      : `Autonomous lead refill is still blocked: ${prep.blockingReason}`,
    payload: {
      campaignId: ensured.campaign.id,
      sourceExperimentId: ensured.campaign.sourceExperimentId,
      targetSendableLeads: ensured.targetSendableLeads,
      sender: ensured.sender,
      before,
      after,
      prep,
    },
  });

  return {
    dryRun: false,
    campaignId: ensured.campaign.id,
    sourceExperimentId: ensured.campaign.sourceExperimentId,
    targetSendableLeads: ensured.targetSendableLeads,
    sender: ensured.sender,
    before,
    after,
    prep,
  };
}

function timestampMs(value: string) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function resolveDecisionRunId(input: {
  decision: ActivationDecision;
  status: OutreachBrandStatus;
  mission: Mission | null;
}) {
  return (
    input.decision.placementTest.runId.trim() ||
    input.decision.runTool.runId.trim() ||
    input.status.executionSummary.activeOutboundRunId.trim() ||
    input.mission?.currentRunId.trim() ||
    ""
  );
}

async function readRunToolState(runId: string) {
  const run = await getOutreachRun(runId);
  if (!run) {
    throw new Error("Run not found.");
  }
  const [leads, messages, jobs, anomalies] = await Promise.all([
    listRunLeads(run.id),
    listRunMessages(run.id),
    listRunJobs(run.id, 100),
    listRunAnomalies(run.id),
  ]);
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const activeJobTypes = new Set(activeJobs.map((job) => job.jobType));
  const activeAnomalies = anomalies.filter((anomaly) => anomaly.status === "active");
  const scheduledMessages = messages.filter((message) => message.status === "scheduled");
  const dueMessages = scheduledMessages.filter(
    (message) => timestampMs(message.scheduledAt) > 0 && timestampMs(message.scheduledAt) <= Date.now()
  );
  const nextScheduledAt =
    scheduledMessages
      .map((message) => message.scheduledAt)
      .filter(Boolean)
      .sort()[0] ?? "";

  return {
    run,
    leads,
    messages,
    jobs,
    anomalies,
    activeAnomalies,
    activeJobs,
    activeJobTypes,
    scheduledMessages,
    dueMessages,
    nextScheduledAt,
    summary: {
      runId: run.id,
      status: run.status,
      ownerType: run.ownerType,
      ownerId: run.ownerId,
      leadCount: leads.length,
      messageCount: messages.length,
      scheduledMessageCount: scheduledMessages.length,
      dueMessageCount: dueMessages.length,
      activeJobTypes: [...activeJobTypes],
      activeAnomalyTypes: activeAnomalies.map((anomaly) => anomaly.type),
      lastError: run.lastError,
      pauseReason: run.pauseReason,
      sourcingTraceSummary: run.sourcingTraceSummary,
    },
  };
}

function isTerminalRunStatus(status: string) {
  return status === "completed" || status === "canceled" || status === "failed" || status === "preflight_failed";
}

function planRunRepairJobs(state: Awaited<ReturnType<typeof readRunToolState>>) {
  const jobs: Array<{
    jobType: "source_leads" | "schedule_messages" | "dispatch_messages" | "analyze_run";
    executeAfter: string;
    payload: Record<string, unknown>;
  }> = [];
  if (isTerminalRunStatus(state.run.status)) return jobs;

  const hasSourceJob = state.activeJobTypes.has("source_leads");
  const hasScheduleJob = state.activeJobTypes.has("schedule_messages");
  const hasDispatchJob = state.activeJobTypes.has("dispatch_messages");
  const hasAnalyzeJob = state.activeJobTypes.has("analyze_run");
  const targetLeadCount = clampRunLeadTarget(
    Math.max(state.run.metrics.sourcedLeads || 0, state.leads.length, 10)
  );

  if ((state.run.status === "paused" || state.activeAnomalies.length > 0) && !hasAnalyzeJob) {
    jobs.push({
      jobType: "analyze_run",
      executeAfter: nowIso(),
      payload: {
        reason: "gpt_operator_run_repair_anomaly_recheck",
        activeAnomalyTypes: state.activeAnomalies.map((anomaly) => anomaly.type),
        pauseReason: state.run.pauseReason,
      },
    });
  }

  if (state.leads.length <= 0 && !hasSourceJob) {
    jobs.push({
      jobType: "source_leads",
      executeAfter: nowIso(),
      payload: {
        reason: "gpt_operator_run_repair_no_leads",
        targetLeadCount,
        currentLeadCount: state.leads.length,
        sourceTopUpAttempt: 0,
      },
    });
    return jobs;
  }

  if (state.leads.length > 0 && state.messages.length <= 0 && !hasScheduleJob) {
    jobs.push({
      jobType: "schedule_messages",
      executeAfter: nowIso(),
      payload: {
        reason: "gpt_operator_run_repair_unscheduled_leads",
        currentLeadCount: state.leads.length,
      },
    });
  }

  if (state.scheduledMessages.length > 0 && !hasDispatchJob) {
    jobs.push({
      jobType: "dispatch_messages",
      executeAfter: state.dueMessages.length > 0 ? nowIso() : state.nextScheduledAt || nowIso(),
      payload: {
        reason: "gpt_operator_run_repair_dispatch_coverage",
        dueMessageCount: state.dueMessages.length,
        scheduledMessageCount: state.scheduledMessages.length,
      },
    });
  }

  if (
    state.scheduledMessages.length <= 0 &&
    state.messages.length > 0 &&
    state.leads.length > state.messages.length &&
    !hasScheduleJob
  ) {
    jobs.push({
      jobType: "schedule_messages",
      executeAfter: nowIso(),
      payload: {
        reason: "gpt_operator_run_repair_partial_schedule",
        currentLeadCount: state.leads.length,
        currentMessageCount: state.messages.length,
      },
    });
  }

  return jobs;
}

async function repairOutreachRunForBrand(input: {
  brand: BrandRecord;
  mission: Mission | null;
  status: OutreachBrandStatus;
  decision: ActivationDecision;
  dryRun: boolean;
}) {
  const runId = resolveDecisionRunId({
    decision: input.decision,
    status: input.status,
    mission: input.mission,
  });
  if (!runId) {
    throw new Error("Run repair requires an active run ID.");
  }

  const invariantRepair = input.dryRun ? null : await reconcileOutreachStateInvariants(20);
  const state = await readRunToolState(runId);
  if (state.run.brandId !== input.brand.id) {
    throw new Error("Run does not belong to this brand.");
  }
  const plannedJobs = planRunRepairJobs(state);
  if (input.dryRun) {
    return {
      dryRun: true,
      invariantRepair,
      before: state.summary,
      plannedJobs,
    };
  }

  const enqueuedJobs = [];
  for (const job of plannedJobs) {
    enqueuedJobs.push(
      await enqueueOutreachJob({
        runId: state.run.id,
        jobType: job.jobType,
        executeAfter: job.executeAfter,
        payload: job.payload,
        maxAttempts: job.jobType === "source_leads" ? 8 : 5,
      })
    );
  }
  if (enqueuedJobs.length > 0 || state.run.lastError || state.run.pauseReason) {
    await updateOutreachRun(state.run.id, {
      lastError: "",
      pauseReason: "",
    });
  }
  await createOutreachEvent({
    runId: state.run.id,
    eventType: "gpt_operator_run_repair",
    payload: {
      rationale: input.decision.rationale,
      before: state.summary,
      invariantRepair,
      enqueuedJobs: enqueuedJobs.map((job) => ({
        id: job.id,
        jobType: job.jobType,
        executeAfter: job.executeAfter,
      })),
    },
  });
  const after = await readRunToolState(runId);
  return {
    dryRun: false,
    invariantRepair,
    before: state.summary,
    after: after.summary,
    enqueuedJobs: enqueuedJobs.map((job) => ({
      id: job.id,
      jobType: job.jobType,
      executeAfter: job.executeAfter,
      payload: job.payload,
    })),
  };
}

async function sourceMoreLeadsForRun(input: {
  brand: BrandRecord;
  mission: Mission | null;
  status: OutreachBrandStatus;
  decision: ActivationDecision;
  dryRun: boolean;
}) {
  const runId = resolveDecisionRunId({
    decision: input.decision,
    status: input.status,
    mission: input.mission,
  });
  if (!runId) {
    throw new Error("Lead sourcing requires an active run ID.");
  }
  const state = await readRunToolState(runId);
  if (state.run.brandId !== input.brand.id) {
    throw new Error("Run does not belong to this brand.");
  }
  if (isTerminalRunStatus(state.run.status)) {
    throw new Error(`Run is ${state.run.status}; source_more_leads only applies to open runs.`);
  }
  const requestedTarget = clampRunLeadTarget(
    input.decision.runTool.targetLeadCount,
    Math.max(state.leads.length + 10, state.run.metrics.sourcedLeads || 25)
  );
  const targetLeadCount = Math.max(requestedTarget, state.leads.length + 1);
  const payload = {
    reason: "gpt_operator_source_more_leads",
    targetLeadCount,
    currentLeadCount: state.leads.length,
    sourceTopUpAttempt: 0,
  };

  if (input.dryRun) {
    return {
      dryRun: true,
      before: state.summary,
      plannedJob: {
        jobType: "source_leads",
        executeAfter: nowIso(),
        payload,
      },
    };
  }

  const job = await enqueueOutreachJob({
    runId: state.run.id,
    jobType: "source_leads",
    executeAfter: nowIso(),
    payload,
    maxAttempts: 8,
  });
  await updateOutreachRun(state.run.id, {
    lastError: "",
    pauseReason: "",
  });
  await createOutreachEvent({
    runId: state.run.id,
    eventType: "gpt_operator_source_more_leads",
    payload: {
      rationale: input.decision.rationale,
      before: state.summary,
      enqueuedJobId: job.id,
      targetLeadCount,
    },
  });
  const after = await readRunToolState(runId);
  return {
    dryRun: false,
    before: state.summary,
    after: after.summary,
    enqueuedJob: {
      id: job.id,
      jobType: job.jobType,
      executeAfter: job.executeAfter,
      payload: job.payload,
    },
  };
}

function selectInboxPlacementSourceMessage(
  state: Awaited<ReturnType<typeof readRunToolState>>,
  requestedMessageId: string
) {
  const eligibleMessages = state.messages.filter(
    (message) =>
      (message.status === "scheduled" || message.status === "sent") &&
      message.subject.trim() &&
      message.body.trim()
  );
  if (requestedMessageId) {
    return eligibleMessages.find((message) => message.id === requestedMessageId) ?? null;
  }
  const scheduled = eligibleMessages
    .filter((message) => message.status === "scheduled")
    .sort(
      (left, right) =>
        timestampMs(left.scheduledAt || left.createdAt) - timestampMs(right.scheduledAt || right.createdAt)
    );
  const sent = eligibleMessages
    .filter((message) => message.status === "sent")
    .sort(
      (left, right) =>
        timestampMs(right.sentAt || right.updatedAt || right.createdAt) -
        timestampMs(left.sentAt || left.updatedAt || left.createdAt)
    );
  return scheduled[0] ?? sent[0] ?? null;
}

function findActiveInboxPlacementJob(
  state: Awaited<ReturnType<typeof readRunToolState>>,
  sourceMessageId: string
) {
  return (
    state.activeJobs.find((job) => {
      if (job.jobType !== "monitor_deliverability") return false;
      const payload = asRecord(job.payload);
      const stage = asString(payload.stage).toLowerCase();
      if (stage === "poll") return false;
      const probeVariant = asString(payload.probeVariant).toLowerCase() || "production";
      if (probeVariant !== "production") return false;
      const queuedSourceMessageId = asString(payload.sourceMessageId);
      return !queuedSourceMessageId || queuedSourceMessageId === sourceMessageId;
    }) ?? null
  );
}

async function findRecentInboxPlacementProbe(input: {
  runId: string;
  sourceMessageId: string;
  cooldownHours: number;
}) {
  const cutoff = Date.now() - input.cooldownHours * 60 * 60 * 1000;
  const staleQueuedCutoff = Date.now() - staleQueuedInboxPlacementProbeMinutes() * 60 * 1000;
  const probes = await listDeliverabilityProbeRuns({
    runId: input.runId,
    probeVariant: "production",
    statuses: ["queued", "sent", "waiting", "completed"],
    limit: 50,
  });
  return (
    probes.find((probe) => {
      if (probe.sourceMessageId !== input.sourceMessageId) return false;
      const referenceMs = Math.max(
        timestampMs(probe.completedAt),
        timestampMs(probe.updatedAt),
        timestampMs(probe.createdAt)
      );
      if (
        probe.status === "queued" &&
        !probe.completedAt.trim() &&
        referenceMs > 0 &&
        referenceMs < staleQueuedCutoff
      ) {
        return false;
      }
      return referenceMs >= cutoff;
    }) ?? null
  );
}

async function runInboxPlacementTestForRun(input: {
  brand: BrandRecord;
  mission: Mission | null;
  status: OutreachBrandStatus;
  decision: ActivationDecision;
  dryRun: boolean;
}) {
  const runId = resolveDecisionRunId({
    decision: input.decision,
    status: input.status,
    mission: input.mission,
  });
  if (!runId) {
    throw new Error("Inbox placement testing requires an active run ID.");
  }
  const state = await readRunToolState(runId);
  if (state.run.brandId !== input.brand.id) {
    throw new Error("Run does not belong to this brand.");
  }
  if (isTerminalRunStatus(state.run.status)) {
    throw new Error(`Run is ${state.run.status}; inbox placement tests only apply to open runs.`);
  }

  const sourceMessage = selectInboxPlacementSourceMessage(
    state,
    input.decision.placementTest.messageId.trim()
  );
  if (!sourceMessage) {
    throw new Error("No real scheduled or sent campaign message exists for inbox placement testing yet.");
  }

  const cooldownHours = clampPlacementCooldownHours(
    input.decision.placementTest.recentProbeCooldownHours,
    12
  );
  const activeJob = findActiveInboxPlacementJob(state, sourceMessage.id);
  const recentProbe = activeJob
    ? null
    : await findRecentInboxPlacementProbe({
        runId: state.run.id,
        sourceMessageId: sourceMessage.id,
        cooldownHours,
      });
  const messageSummary = {
    id: sourceMessage.id,
    status: sourceMessage.status,
    subject: sourceMessage.subject,
    scheduledAt: sourceMessage.scheduledAt,
    sentAt: sourceMessage.sentAt,
    sourceType: sourceMessage.sourceType,
    nodeId: sourceMessage.nodeId,
    leadId: sourceMessage.leadId,
  };

  if (activeJob || recentProbe) {
    return {
      dryRun: input.dryRun,
      skipped: true,
      reason: activeJob
        ? "A production inbox-placement monitor job is already queued or running for this message."
        : `A production inbox-placement probe already exists inside the ${cooldownHours}h cooldown.`,
      before: state.summary,
      sourceMessage: messageSummary,
      activeJob: activeJob
        ? {
            id: activeJob.id,
            jobType: activeJob.jobType,
            status: activeJob.status,
            executeAfter: activeJob.executeAfter,
            payload: activeJob.payload,
          }
        : null,
      recentProbe: recentProbe
        ? {
            id: recentProbe.id,
            status: recentProbe.status,
            placement: recentProbe.placement,
            summaryText: recentProbe.summaryText,
            createdAt: recentProbe.createdAt,
            updatedAt: recentProbe.updatedAt,
            completedAt: recentProbe.completedAt,
          }
        : null,
    };
  }

  const generationMeta = asRecord(sourceMessage.generationMeta);
  const senderHint =
    sourceMessage.status === "sent"
      ? {
          senderAccountId: asString(generationMeta.senderAccountId),
          senderAccountName: asString(generationMeta.senderAccountName),
          fromEmail: asString(generationMeta.senderFromEmail),
        }
      : {};
  const payload = {
    source: "gpt_operator",
    reason: input.decision.rationale,
    stage: "send",
    manual: true,
    triggerStage: "gpt_operator",
    probeVariant: "production",
    sourceMessageId: sourceMessage.id,
    sourceMessageStatus: sourceMessage.status,
    sourceType: sourceMessage.sourceType,
    nodeId: sourceMessage.nodeId,
    leadId: sourceMessage.leadId,
    ...senderHint,
  };

  if (input.dryRun) {
    return {
      dryRun: true,
      skipped: false,
      before: state.summary,
      sourceMessage: messageSummary,
      plannedJob: {
        jobType: "monitor_deliverability",
        executeAfter: nowIso(),
        payload,
      },
    };
  }

  const job = await enqueueOutreachJob({
    runId: state.run.id,
    jobType: "monitor_deliverability",
    executeAfter: nowIso(),
    payload,
    maxAttempts: 5,
  });
  await createOutreachEvent({
    runId: state.run.id,
    eventType: "deliverability_probe_requested",
    payload: {
      reason: input.decision.rationale || "GPT operator requested exact-content inbox placement test",
      source: "gpt_operator",
      sourceMessageId: sourceMessage.id,
      sourceMessageStatus: sourceMessage.status,
      sourceType: sourceMessage.sourceType,
      nodeId: sourceMessage.nodeId,
      leadId: sourceMessage.leadId,
      probeVariants: ["production"],
      jobId: job.id,
    },
  });
  return {
    dryRun: false,
    skipped: false,
    before: state.summary,
    sourceMessage: messageSummary,
    enqueuedJob: {
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      executeAfter: job.executeAfter,
      payload: job.payload,
    },
  };
}

async function currentMissionRunBlocksRetry(mission: Mission) {
  const runId = mission.currentRunId.trim();
  if (!runId) return { blocks: false, run: null, reason: "" };
  const run = await getOutreachRun(runId).catch(() => null);
  if (!run) {
    return { blocks: false, run: null, reason: "Current run was not found, so a retry can proceed." };
  }
  if (!OPEN_OUTREACH_RUN_STATUSES.has(run.status)) {
    return {
      blocks: false,
      run,
      reason: `Previous run ${run.id} is ${run.status}, so a retry can proceed.`,
    };
  }
  return {
    blocks: true,
    run,
    reason: `Mission already has an open run ${run.id} (${run.status}).`,
  };
}

async function continueReadyMission(input: {
  brand: BrandRecord;
  mission: Mission;
  decision: ActivationDecision;
  dryRun: boolean;
}) {
  if (input.mission.status !== "deliverability_blocked") {
    return {
      launched: false,
      reason: "Mission is not deliverability-blocked.",
      mission: input.mission,
    };
  }
  if (input.mission.currentRunId) {
    const retryGate = await currentMissionRunBlocksRetry(input.mission);
    if (!retryGate.blocks) {
      if (!input.dryRun) {
        await updateMission(input.brand.id, input.mission.id, {
          currentRunId: "",
          lastError: "",
        });
      }
      input.mission = {
        ...input.mission,
        currentRunId: "",
        lastError: "",
      };
    } else {
    return {
      launched: false,
      reason: retryGate.reason || "Mission already has an open run.",
      mission: input.mission,
    };
    }
  }
  if (!input.mission.currentRuntimeCampaignId || !input.mission.currentRuntimeExperimentId) {
    return {
      launched: false,
      reason: "Mission has no compiled runtime experiment yet.",
      mission: input.mission,
    };
  }

  const deliverabilityState = await inspectMissionDeliverability(input.brand.id);
  const refreshed =
    (await updateMission(input.brand.id, input.mission.id, { deliverabilityState })) ?? input.mission;
  if (deliverabilityState.stage !== "ready") {
    await createMissionAgentDecision({
      missionId: input.mission.id,
      brandId: input.brand.id,
      agent: "brand_activation_operator",
      action: "continue_ready_mission",
      rationale: "The operator checked whether the blocked mission can now continue.",
      riskLevel: "read",
      input: { missionId: input.mission.id },
      output: { deliverabilityState },
    });
    return {
      launched: false,
      reason: deliverabilityState.primaryBlocker || deliverabilityState.summary,
      mission: refreshed,
    };
  }
  if (input.dryRun) {
    return {
      launched: false,
      reason: "Dry run: mission is ready but launch was not executed.",
      mission: refreshed,
    };
  }

  const launchCampaign = await findMissionLaunchCampaign({
    brandId: input.brand.id,
    mission: input.mission,
  });
  const launch = launchCampaign
    ? await launchScaleCampaignRun({
        brandId: input.brand.id,
        scaleCampaignId: launchCampaign.id,
        trigger: "manual",
      })
    : await launchExperimentRun({
        brandId: input.brand.id,
        campaignId: input.mission.currentRuntimeCampaignId,
        experimentId: input.mission.currentRuntimeExperimentId,
        trigger: "manual",
        ownerType: "experiment",
        ownerId: input.mission.currentExperimentId,
        maxLeadsOverride: clampFirstBatch(input.mission.approvedPlan.firstBatchSize),
        trafficLane: "outbound",
      });
  await createMissionAgentDecision({
    missionId: input.mission.id,
    brandId: input.brand.id,
    agent: "brand_activation_operator",
    action: "launch_after_deliverability_ready",
    rationale: input.decision.rationale || "Deliverability is ready, so the previously blocked mission can launch.",
    riskLevel: launch.ok ? "guarded_write" : "blocked",
    input: {
      missionId: input.mission.id,
      runtimeCampaignId: input.mission.currentRuntimeCampaignId,
      runtimeExperimentId: input.mission.currentRuntimeExperimentId,
      launchOwnerType: launchCampaign ? "campaign" : "experiment",
      launchOwnerId: launchCampaign?.id ?? input.mission.currentExperimentId,
    },
    output: { deliverabilityState, launch },
  });
  const mission =
    (await updateMission(input.brand.id, input.mission.id, {
      currentRunId: launch.runId,
      status: launch.ok ? "running" : "deliverability_blocked",
      lastError: launch.ok ? "" : launch.reason,
      deliverabilityState: launch.ok
        ? deliverabilityState
        : {
            ...deliverabilityState,
            stage: "needs_attention",
            summary: launch.reason,
            primaryBlocker: launch.reason,
            lastCheckedAt: nowIso(),
          },
    })) ?? refreshed;
  await createMissionEvent({
    missionId: input.mission.id,
    brandId: input.brand.id,
    eventType: launch.ok ? "autonomous_first_batch_launched" : "autonomous_launch_blocked",
    summary: launch.ok
      ? `Autonomous operator launched the first batch for up to ${clampFirstBatch(input.mission.approvedPlan.firstBatchSize)} contacts.`
      : `Autonomous launch blocked: ${launch.reason}`,
    payload: {
      launch,
      deliverabilityState,
      launchOwnerType: launchCampaign ? "campaign" : "experiment",
      launchOwnerId: launchCampaign?.id ?? input.mission.currentExperimentId,
    },
  });
  return {
    launched: launch.ok,
    reason: launch.reason,
    mission,
    launch,
  };
}

async function ensureCompiledMission(input: {
  brand: BrandRecord;
  mission: Mission;
  dryRun: boolean;
}) {
  if (input.mission.currentRuntimeCampaignId && input.mission.currentRuntimeExperimentId) {
    return input.mission;
  }
  const plan = planIsComplete(input.mission.approvedPlan)
    ? input.mission.approvedPlan
    : input.mission.generatedPlan;
  if (!planIsComplete(plan)) return input.mission;
  if (input.dryRun) return input.mission;

  const experiment = await createExperimentRecord({
    brandId: input.brand.id,
    name: `${input.brand.name || "Brand"} Mission Test`,
    offer: plan.offerSummary,
    audience: plan.targetCustomers.join("; "),
  });
  const runtimeExperiment = await ensureRuntimeForExperiment(experiment);
  return (
    (await updateMission(input.brand.id, input.mission.id, {
      currentExperimentId: runtimeExperiment.id,
      currentRuntimeCampaignId: runtimeExperiment.runtime.campaignId,
      currentRuntimeExperimentId: runtimeExperiment.runtime.experimentId,
    })) ?? input.mission
  );
}

async function provisionMailpoolSenderForBrand(input: {
  brand: BrandRecord;
  mission: Mission | null;
  status: OutreachBrandStatus;
  config: ActivationConfig;
  decision: ActivationDecision;
}) {
  if (!canProvisionAnotherSender(input.status)) {
    return {
      skipped: true,
      reason: "Brand already has a ready, warming, or provisioning sender.",
    };
  }
  const recentFailure = await recentProvisioningFailure({
    mission: input.mission,
    cooldownMinutes: input.config.provisionFailureCooldownMinutes,
  });
  if (recentFailure) {
    if (canBypassRecentProvisioningFailure(recentFailure.payload)) {
      await createMissionEvent({
        missionId: input.mission!.id,
        brandId: input.brand.id,
        eventType: "autonomous_sender_provisioning_retry",
        summary: "Autonomous sender provisioning is retrying because registrar mode changed to Vercel.",
        payload: {
          previousFailureAt: recentFailure.createdAt,
          previousFailure: recentFailure.payload,
          registrarMode: "vercel",
        },
      });
    } else {
    return {
      skipped: true,
      reason: `Recent autonomous sender provisioning failed; waiting ${input.config.provisionFailureCooldownMinutes} minutes before retrying domain registration.`,
      lastFailureAt: recentFailure.createdAt,
      lastFailure: recentFailure.payload,
    };
    }
  }
  const sender = normalizeSenderDecision(input.brand, input.decision);
  if (!sender.domain || !sender.fromLocalPart) {
    throw new Error("The activation plan did not provide a usable sender email.");
  }
  if (!sender.senderFirstName || !sender.senderLastName) {
    throw new Error("The activation plan did not provide a real sender first and last name.");
  }
  if (sender.domainMode === "register" && !input.config.allowDomainRegistration) {
    throw new Error("Domain registration is not enabled for brand activation autopilot.");
  }
  if (sender.domainMode === "register" && !input.config.registrant) {
    throw new Error("Registrant details are required before autonomous domain registration can run.");
  }
  if (input.config.dryRun) {
    return {
      skipped: false,
      dryRun: true,
      sender,
    };
  }

  const domainsToTry =
    sender.domainMode === "register"
      ? uniqueStrings([sender.domain, ...sender.domainCandidates]).slice(0, 4)
      : [sender.domain];
  const attempts: Array<{ domain: string; ok: boolean; error: string }> = [];
  let result: Awaited<ReturnType<typeof provisionSender>> | null = null;
  let lastError: unknown = null;

  for (const domain of domainsToTry) {
    try {
      result = await provisionSender({
        brandId: input.brand.id,
        provider: "mailpool",
        accountName: sender.accountName,
        assignToBrand: true,
        domainMode: sender.domainMode || "register",
        domain,
        fromLocalPart: sender.fromLocalPart,
        senderFirstName: sender.senderFirstName,
        senderLastName: sender.senderLastName,
        autoPickCustomerIoAccount: false,
        customerIoSourceAccountId: "",
        forwardingTargetUrl: input.brand.website,
        customerIoSiteId: "",
        customerIoTrackingApiKey: "",
        customerIoAppApiKey: "",
        mailpoolApiKey: "",
        domainCandidates: sender.domainCandidates.filter((candidate) => candidate !== domain),
        allowAlternativeDomains: true,
        namecheapApiUser: "",
        namecheapUserName: "",
        namecheapApiKey: "",
        namecheapClientIp: "",
        registrant: input.config.registrant,
      });
      attempts.push({ domain, ok: true, error: "" });
      break;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "Sender provisioning failed.";
      attempts.push({ domain, ok: false, error: message });
      if (sender.domainMode !== "register" || !shouldRetryMailpoolDomainRegistration(error)) {
        break;
      }
    }
  }

  if (!result) {
    if (input.mission) {
      await createMissionAgentDecision({
        missionId: input.mission.id,
        brandId: input.brand.id,
        agent: "brand_activation_operator",
        action: "provision_mailpool_sender_failed",
        rationale: input.decision.rationale,
        riskLevel: "blocked",
        input: {
          sender,
          attempts,
          allowDomainRegistration: input.config.allowDomainRegistration,
        },
        output: {
          error: lastError instanceof Error ? lastError.message : "Sender provisioning failed.",
        },
      });
      await createMissionEvent({
        missionId: input.mission.id,
        brandId: input.brand.id,
        eventType: "autonomous_sender_provisioning_failed",
        summary: `Autonomous sender provisioning failed after ${attempts.length} domain registration attempt${attempts.length === 1 ? "" : "s"}.`,
        payload: { attempts },
      });
    }
    const attemptedDomains = attempts.map((attempt) => attempt.domain).filter(Boolean).join(", ");
    const suffix = attemptedDomains ? ` Attempted domains: ${attemptedDomains}.` : "";
    throw new Error(`${lastError instanceof Error ? lastError.message : "Sender provisioning failed."}${suffix}`);
  }
  if (input.mission) {
    await createMissionAgentDecision({
      missionId: input.mission.id,
      brandId: input.brand.id,
      agent: "brand_activation_operator",
      action: "provision_mailpool_sender",
      rationale: input.decision.rationale,
      riskLevel: "guarded_write",
      input: {
        sender,
        allowDomainRegistration: input.config.allowDomainRegistration,
      },
      output: {
        ok: result.ok,
        readyToSend: result.readyToSend,
        domain: result.domain,
        fromEmail: result.fromEmail,
        attempts,
        warnings: result.warnings,
        nextSteps: result.nextSteps,
        mailpool: result.mailpool,
        vercel: result.vercel,
      },
    });
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.brand.id,
      eventType: "autonomous_sender_provisioned",
      summary: result.readyToSend
        ? `Autonomous operator provisioned ${result.fromEmail}; sender is ready.`
        : `Autonomous operator provisioned ${result.fromEmail}; sender is settling before launch.`,
      payload: {
        domain: result.domain,
        fromEmail: result.fromEmail,
        readyToSend: result.readyToSend,
        attempts,
        warnings: result.warnings,
        nextSteps: result.nextSteps,
        mailpool: result.mailpool,
        vercel: result.vercel,
      },
    });
  }
  return result;
}

async function executeDecision(input: {
  snapshot: BrandActivationSnapshot;
  status: OutreachBrandStatus;
  config: ActivationConfig;
  decision: ActivationDecision;
}): Promise<BrandActivationResult> {
  const brand = await getBrandById(input.snapshot.brand.id, { includeEmbedded: true });
  if (!brand) {
    throw new Error("Brand not found.");
  }
  const missions = await listMissions(brand.id);
  let mission = latestActionableMission(missions);
  const details: Record<string, unknown> = {};

  if (!actionCanTouchOpenOutboundWork(input.decision.action) && hasOpenOutboundWork(input.status)) {
    return {
      brandId: brand.id,
      brandName: brand.name,
      action: input.decision.action,
      ok: true,
      dryRun: input.config.dryRun,
      summary: "Skipped because this brand already has open outbound work.",
      rationale: input.decision.rationale,
      details: { activeRun: input.status.executionSummary },
      error: "",
    };
  }

  if (input.decision.action === "refresh_mailpool_sender" && !input.decision.refreshAccountId) {
    details.refresh = {
      skipped: true,
      reason: "GPT chose refresh_mailpool_sender without a refreshAccountId.",
    };
    return {
      brandId: brand.id,
      brandName: brand.name,
      action: input.decision.action,
      ok: true,
      dryRun: input.config.dryRun,
      summary: "Skipped refresh because GPT did not provide a concrete Mailpool account ID.",
      rationale: input.decision.rationale,
      details,
      error: "",
    };
  }

  if (input.decision.refreshAccountId && input.decision.action === "refresh_mailpool_sender") {
    if (!input.config.dryRun) {
      details.refresh = await refreshMailpoolOutreachAccount(input.decision.refreshAccountId);
    } else {
      details.refresh = { dryRun: true, accountId: input.decision.refreshAccountId };
    }
  }

  if (input.decision.action === "repair_seed_pool") {
    if (!input.snapshot.seedPool.needsRepair) {
      details.seedPoolRepair = {
        skipped: true,
        reason:
          "Seed pool repair was not due. Historical failed monitors are recorded, but usable monitor capacity is currently healthy.",
        current: input.snapshot.seedPool,
      };
      return {
        brandId: brand.id,
        brandName: brand.name,
        action: input.decision.action,
        ok: true,
        dryRun: input.config.dryRun,
        summary: "Skipped deliverability seed-pool repair because the pool is currently healthy.",
        rationale: input.decision.rationale,
        details,
        error: "",
      };
    }
    details.seedPoolRepair = await repairDeliverabilitySeedPool(input.config.dryRun);
    return {
      brandId: brand.id,
      brandName: brand.name,
      action: input.decision.action,
      ok: true,
      dryRun: input.config.dryRun,
      summary: input.config.dryRun
        ? "Dry run completed for autonomous deliverability seed-pool repair."
        : "Autonomous deliverability seed-pool repair completed.",
      rationale: input.decision.rationale,
      details,
      error: "",
    };
  }

  if (input.decision.action === "use_growth_tool") {
    if (!input.config.allowGrowthTools) {
      details.growthTool = {
        skipped: true,
        reason: "Growth tool execution is disabled by BRAND_ACTIVATION_AUTOPILOT_ALLOW_GROWTH_TOOLS.",
        requestedTool: input.decision.growthTool.toolName,
      };
      return {
        brandId: brand.id,
        brandName: brand.name,
        action: input.decision.action,
        ok: true,
        dryRun: input.config.dryRun,
        summary: "Skipped growth tool because the generic tool registry is disabled.",
        rationale: input.decision.rationale,
        details,
        error: "",
      };
    }
    if (!input.decision.growthTool.toolName) {
      details.growthTool = {
        skipped: true,
        reason: "GPT chose use_growth_tool without a concrete toolName.",
      };
      return {
        brandId: brand.id,
        brandName: brand.name,
        action: input.decision.action,
        ok: true,
        dryRun: input.config.dryRun,
        summary: "Skipped growth tool because GPT did not provide a concrete tool name.",
        rationale: input.decision.rationale,
        details,
        error: "",
      };
    }
    const growthToolInput = input.decision.growthTool.input;
    const growthToolResult = await invokeGrowthTool({
      toolName: input.decision.growthTool.toolName,
      toolInput: growthToolInput,
      context: {
        brandId: brand.id,
        missionId: mission?.id || asString(growthToolInput.missionId),
        agent: "brand_activation_operator",
        rationale: input.decision.rationale,
        dryRun: input.config.dryRun,
        guardrails: {
          allowSafeWrite: input.config.allowGrowthTools,
          allowGuardedWrite: input.config.allowGrowthTools && input.config.allowGuardedGrowthTools,
          allowSpendRisk: input.config.allowGrowthTools && input.config.allowSpendGrowthTools,
          allowReputationRisk: input.config.allowGrowthTools && input.config.allowReputationGrowthTools,
        },
      },
    });
    details.growthTool = growthToolResult;
    return {
      brandId: brand.id,
      brandName: brand.name,
      action: input.decision.action,
      ok: true,
      dryRun: input.config.dryRun,
      summary:
        growthToolResult.status === "blocked"
          ? "Growth tool was blocked by runtime guardrails."
          : growthToolResult.status === "dry_run"
            ? "Dry run completed for autonomous growth tool step."
            : "Autonomous growth tool step completed.",
      rationale: input.decision.rationale,
      details,
      error: "",
    };
  }

  if (!mission && input.decision.shouldCreateMission) {
    const created = await createAndStartMission({
      brand,
      targetCustomerText: input.decision.targetCustomerText,
      decision: input.decision,
      dryRun: input.config.dryRun,
    });
    mission = created.mission;
    details.missionCreated = {
      dryRun: created.dryRun,
      reusedExisting: Boolean(created.reusedExisting),
      missionId: created.mission?.id ?? "",
      status: created.mission?.status ?? "",
      generatedPlan: created.generatedPlan,
    };
  } else if (
    mission &&
    (input.decision.shouldStartMission || input.decision.action === "start_existing_mission") &&
    (mission.status === "draft" || mission.status === "plan_ready")
  ) {
    mission = await startExistingMission({
      brand,
      mission,
      decision: input.decision,
      dryRun: input.config.dryRun,
    });
    details.missionStarted = {
      missionId: mission.id,
      status: mission.status,
      deliverabilityStage: mission.deliverabilityState.stage,
    };
  }

  if (mission && mission.status === "deliverability_blocked") {
    mission = await ensureCompiledMission({ brand, mission, dryRun: input.config.dryRun });
  }

  if (!mission && input.decision.action === "refill_campaign_leads") {
    throw new Error("Lead refill requires an existing or newly created mission.");
  }

  if (input.decision.action === "repair_outreach_run") {
    details.runRepair = await repairOutreachRunForBrand({
      brand,
      mission,
      status: input.status,
      decision: input.decision,
      dryRun: input.config.dryRun,
    });
  }

  if (input.decision.action === "source_more_leads") {
    details.leadSourcing = await sourceMoreLeadsForRun({
      brand,
      mission,
      status: input.status,
      decision: input.decision,
      dryRun: input.config.dryRun,
    });
  }

  if (input.decision.action === "run_inbox_placement_test") {
    details.inboxPlacementTest = await runInboxPlacementTestForRun({
      brand,
      mission,
      status: input.status,
      decision: input.decision,
      dryRun: input.config.dryRun,
    });
  }

  if (mission && input.decision.action === "refill_campaign_leads") {
    details.leadRefill = await refillCampaignLeadsForMission({
      brand,
      mission,
      status: input.status,
      decision: input.decision,
      dryRun: input.config.dryRun,
    });
  }

  if (input.decision.shouldProvisionSender || input.decision.action === "provision_mailpool_sender") {
    const provision = await provisionMailpoolSenderForBrand({
      brand,
      mission,
      status: input.status,
      config: input.config,
      decision: input.decision,
    });
    details.senderProvisioning = provision as Record<string, unknown>;
  }

  if (mission && (input.decision.action === "continue_ready_mission" || mission.status === "deliverability_blocked")) {
    const continued = await continueReadyMission({
      brand,
      mission,
      decision: input.decision,
      dryRun: input.config.dryRun,
    });
    details.missionContinuation = continued as Record<string, unknown>;
  }

  return {
    brandId: brand.id,
    brandName: brand.name,
    action: input.decision.action,
    ok: true,
    dryRun: input.config.dryRun,
    summary: input.config.dryRun
      ? "Dry run completed for autonomous brand activation."
      : "Autonomous brand activation step completed.",
    rationale: input.decision.rationale,
    details,
    error: "",
  };
}

export async function runBrandActivationAutopilot(limitOverride?: number) {
  const config = readConfig();
  if (typeof limitOverride === "number" && Number.isFinite(limitOverride)) {
    config.limitBrands = Math.max(1, Math.min(80, Math.round(limitOverride)));
  }
  if (!config.enabled) {
    return {
      enabled: false,
      dryRun: config.dryRun,
      planned: 0,
      executed: 0,
      summary: "Brand activation autopilot is disabled.",
      model: "",
      actions: [] as BrandActivationResult[],
    };
  }

  const snapshots = await buildSnapshots(config);
  if (!snapshots.length) {
    return {
      enabled: true,
      dryRun: config.dryRun,
      planned: 0,
      executed: 0,
      summary: "No brands are eligible for autonomous activation.",
      model: "",
      actions: [] as BrandActivationResult[],
    };
  }

  const planning = await filterSnapshotsDueForPlanning(snapshots, config);
  if (!planning.due.length) {
    return {
      enabled: true,
      dryRun: config.dryRun,
      planned: 0,
      executed: 0,
      summary:
        planning.eligible === 0
          ? "No brands currently need autonomous GPT planning."
          : `Skipped GPT planning for ${planning.skipped} eligible brand${
              planning.skipped === 1 ? "" : "s"
            }; each is still inside the ${config.planCooldownMinutes}-minute planning cooldown.`,
      model: "",
      actions: [] as BrandActivationResult[],
    };
  }

  const { plan, model } = await planActivationWithLlm({ snapshots: planning.due, config });
  const statusByBrandId = new Map(
    (await buildOutreachStatusResponse({ limitBrands: Math.max(config.limitBrands, 50) })).brands.map((status) => [
      status.brandId,
      status,
    ] as const)
  );
  const snapshotByBrandId = new Map(snapshots.map((snapshot) => [snapshot.brand.id, snapshot] as const));
  const results: BrandActivationResult[] = [];

  for (const decision of plan.actions.slice(0, config.maxActionsPerTick)) {
    const snapshot = snapshotByBrandId.get(decision.brandId);
    const status = statusByBrandId.get(decision.brandId);
    if (!snapshot || !status) {
      results.push({
        brandId: decision.brandId,
        brandName: "",
        action: decision.action,
        ok: false,
        dryRun: config.dryRun,
        summary: "Skipped unknown brand from activation plan.",
        rationale: decision.rationale,
        details: {},
        error: "Brand was not present in the activation snapshot.",
      });
      continue;
    }
    if (decision.action === "observe") {
      results.push({
        brandId: snapshot.brand.id,
        brandName: snapshot.brand.name,
        action: decision.action,
        ok: true,
        dryRun: config.dryRun,
        summary: "GPT chose to observe this brand for now.",
        rationale: decision.rationale,
        details: {},
        error: "",
      });
      continue;
    }
    try {
      results.push(await executeDecision({ snapshot, status, config, decision }));
    } catch (error) {
      results.push({
        brandId: snapshot.brand.id,
        brandName: snapshot.brand.name,
        action: decision.action,
        ok: false,
        dryRun: config.dryRun,
        summary: "Autonomous brand activation failed.",
        rationale: decision.rationale,
        details: {},
        error: error instanceof Error ? error.message : "Unknown activation error",
      });
    }
  }

  return {
    enabled: true,
    dryRun: config.dryRun,
    planned: plan.actions.length,
    executed: results.filter((result) => {
      if (!result.ok || result.action === "observe") return false;
      const senderProvisioning = asRecord(result.details.senderProvisioning);
      const refresh = asRecord(result.details.refresh);
      return senderProvisioning.skipped !== true && refresh.skipped !== true;
    }).length,
    summary: plan.summary,
    model,
    actions: results,
  };
}
