import { mkdir, readFile, writeFile } from "fs/promises";
import { getSupabaseAdmin } from "./supabase-admin";
import type {
  BrandRecord,
  CampaignRecord,
  CampaignStep,
  DomainRow,
  EvolutionSnapshot,
  Experiment,
  ExperimentExecutionStatus,
  ExperimentRunPolicy,
  Hypothesis,
  HypothesisSourceConfig,
  InboxRow,
  LeadRow,
  ObjectiveData,
} from "./factory-types";

export type {
  BrandRecord,
  CampaignRecord,
  CampaignStep,
  DomainRow,
  EvolutionSnapshot,
  Experiment,
  ExperimentExecutionStatus,
  ExperimentRunPolicy,
  Hypothesis,
  HypothesisSourceConfig,
  InboxRow,
  LeadRow,
  ObjectiveData,
};

const isVercel = Boolean(process.env.VERCEL);
const BUNDLED_BRANDS_PATH = `${process.cwd()}/data/brands.v2.json`;
const BRANDS_PATH = isVercel
  ? "/tmp/factory_brands.json"
  : BUNDLED_BRANDS_PATH;
const CAMPAIGNS_PATH = isVercel
  ? "/tmp/factory_campaigns.json"
  : `${process.cwd()}/data/campaigns.v2.json`;
const SUPABASE_QUERY_TIMEOUT_MS = 1_500;
const EMBEDDED_BRAND_FALLBACKS: BrandRecord[] = [
  {
    id: "brand_e8e92eeeba824a93",
    name: "SwarmTester",
    website: "https://swarmtester.com/",
    tone: "",
    notes: "QA/testing brand workspace.",
    product: "",
    socialDiscoveryCommentPrompt: "",
    socialDiscoveryPlatforms: [],
    socialDiscoveryQueries: [],
    socialDiscoveryYouTubeSubscriptions: [],
    operablePersonas: [],
    availableAssets: [],
    targetMarkets: [],
    idealCustomerProfiles: [],
    keyFeatures: [],
    keyBenefits: [],
    domains: [],
    leads: [],
    inbox: [],
    createdAt: "2026-03-25T12:47:36.255244+00:00",
    updatedAt: "2026-03-25T12:52:46.433368+00:00",
  },
  {
    id: "brand_7936be472e1247c7",
    name: "selffunded.dev",
    website: "https://selffunded.dev/",
    tone: "Direct, credible, operator-to-operator",
    notes:
      "Private collective for self-funded operators. Current outreach offer: AWS credits for founders with no institutional VC; angels and friends/family are acceptable. Use Marco Rosetti as the sender voice.",
    product: "Private operator collective with negotiated cloud and software deals for self-funded founders",
    socialDiscoveryCommentPrompt: "",
    socialDiscoveryPlatforms: [],
    socialDiscoveryQueries: [],
    socialDiscoveryYouTubeSubscriptions: [],
    operablePersonas: [],
    availableAssets: [],
    targetMarkets: ["Bootstrapped SaaS founders", "Self-funded operators"],
    idealCustomerProfiles: ["Founders with no institutional VC"],
    keyFeatures: [
      "AWS credits for selffunded brands",
      "Exclusive free access to business software",
    ],
    keyBenefits: [
      "AWS credits to offset cloud spend",
      "Access to negotiated software and cloud offers",
    ],
    domains: [],
    leads: [],
    inbox: [],
    createdAt: "2026-03-10T21:58:28.94428+00:00",
    updatedAt: "2026-03-25T12:49:25.04422+00:00",
  },
  {
    id: "brand_mlg68b9l",
    name: "BHuman | AI personalized videos at scale",
    website: "https://bhuman.ai/",
    tone: "Modern, confident, results-driven, B2B growth-focused",
    notes:
      "Claims: trusted by over 200,000 innovators; campaign metrics cited (2x opens, 7x click-throughs, 4x conversions) backed by customer campaign data; testimonials from Steve Anderson, Henry Reith, and Alasdair Sutherland praising ease of use and time savings.",
    product:
      "AI platform to create realistic personalized videos at scale (prompt-to-video generation and bulk personalization), with delivery and workflow automation via no-code tools and API.",
    socialDiscoveryCommentPrompt: "",
    socialDiscoveryPlatforms: [],
    socialDiscoveryQueries: [],
    socialDiscoveryYouTubeSubscriptions: [],
    operablePersonas: [
      "Journalist covering creator workflows and AI video",
      "Research lead interviewing creators about personalized video use",
      "Founder inviting selected creators to test personalized video generation",
    ],
    availableAssets: [
      "Article or interview series featuring creators",
      "Founder interview access",
      "Trial accounts for selected creators to test the product",
      "Published coverage and follow-up visibility around featured creators",
    ],
    targetMarkets: [
      "B2B sales/outbound teams",
      "Marketing and growth teams",
      "Customer success and support teams",
      "Founders and product teams",
    ],
    idealCustomerProfiles: [
      "Outbound sales teams that want warm intros and more meetings using personalized video",
      "Marketing teams creating social posts, ads, and product update videos quickly",
      "Customer success teams onboarding users and sending re-engagement/re-ordering videos",
      "Support teams that want FAQ/help content delivered with a human presenter",
      "Teams that need multilingual video personalization across global markets",
    ],
    keyFeatures: [
      "Speakeasy: generate full AI videos from a prompt (presenter, script, voice included)",
      "Personalized Video: create thousands of variants from one base video using CSV or API",
      "AI presenter with cloned voice",
      "Dynamic overlays for text, images, names, company, and links",
      "Batch/bulk rendering and templates in AI Studio",
      "Delivery and tracking via email/CRM with measurable opens/clicks/conversions",
      "LinkedIn + email workflows and campaign analytics (Leadr)",
      "Persona: upload face/voice/knowledge; handles video, audio, and text chats; embeddable concierge",
    ],
    keyBenefits: [
      "Higher reply rates and more booked meetings from 1:1-feeling outreach",
      "Stronger engagement across email, LinkedIn, and SMS",
      "Shorter sales cycles through warmer first touches",
      "Clearer CTAs that don’t feel like mass-blast messaging",
      "Saves time by automating what used to be manual personalized video recording",
      "Scales personalized video creation to hundreds or thousands of recipients",
      "Fast production (render in minutes) with no editing required",
    ],
    domains: [],
    leads: [],
    inbox: [],
    createdAt: "2026-02-15T04:12:14.053479+00:00",
    updatedAt: "2026-03-25T12:47:57.643156+00:00",
  },
  {
    id: "brand_729885c92b1242e1",
    name: "Don Bosco Art",
    website: "",
    tone: "",
    notes: "This is the user's art account. They want to do outreach to get new painting commissions.",
    product: "Painting commissions",
    socialDiscoveryCommentPrompt: "",
    socialDiscoveryPlatforms: [],
    socialDiscoveryQueries: [],
    socialDiscoveryYouTubeSubscriptions: [],
    operablePersonas: [],
    availableAssets: [],
    targetMarkets: [],
    idealCustomerProfiles: [],
    keyFeatures: [],
    keyBenefits: [],
    domains: [],
    leads: [],
    inbox: [],
    createdAt: "2026-03-24T13:28:33.080909+00:00",
    updatedAt: "2026-03-25T12:47:37.817523+00:00",
  },
  {
    id: "brand_7bfdb4d1686b4afc",
    name: "EnrichAnything",
    website: "https://www.enrichanything.com/",
    tone: "Direct, operator-to-operator, research-led",
    notes:
      "Primary job: publish source-backed market notes and underlying prospect lists, then ask relevant agencies and operators for comment, corrections, and reactions.",
    product:
      "Source-backed prospect discovery and market-note generation for overlooked B2B and e-commerce slices.",
    socialDiscoveryCommentPrompt: "",
    socialDiscoveryPlatforms: [],
    socialDiscoveryQueries: [],
    socialDiscoveryYouTubeSubscriptions: [],
    operablePersonas: [],
    availableAssets: [],
    targetMarkets: [
      "EU TikTok and paid-social agencies",
      "Email and SMS retention agencies",
      "RevOps and GTM systems consultants",
      "AI automation consultants for SMB professional services",
    ],
    idealCustomerProfiles: [
      "Agencies that make money by acting on narrow, source-backed market lists",
      "Operators who can comment on report findings and use the source list commercially",
      "Teams willing to react to a public market note and discuss whether the pattern is real",
    ],
    keyFeatures: [
      "Public market notes tied to source-backed prospect lists",
      "Representative samples with signal, gap, and timing fields",
      "Narrow market discovery for agencies and consultants",
    ],
    keyBenefits: [
      "Give agencies a list they can actually work from",
      "Turn market research into outreach-ready targeting",
      "Use public notes as a reason to start conversations",
    ],
    domains: [],
    leads: [],
    inbox: [],
    createdAt: "2026-03-24T09:47:46.349685+00:00",
    updatedAt: "2026-03-25T12:40:13.045069+00:00",
  },
];

const BRAND_TABLE = "demanddev_brands";
const CAMPAIGN_TABLE = "demanddev_campaigns";
const BRAND_SELECT_COLUMNS = [
  "id",
  "name",
  "website",
  "tone",
  "notes",
  "product",
  "social_discovery_comment_prompt",
  "social_discovery_platforms",
  "social_discovery_queries",
  "social_discovery_youtube_subscriptions",
  "operable_personas",
  "available_assets",
  "target_markets",
  "ideal_customer_profiles",
  "key_features",
  "key_benefits",
  "domains",
  "created_at",
  "updated_at",
] as const;
const OPTIONAL_BRAND_COLUMNS = [
  "social_discovery_comment_prompt",
  "social_discovery_platforms",
  "social_discovery_queries",
  "social_discovery_youtube_subscriptions",
  "operable_personas",
  "available_assets",
] as const;
const LEGACY_BRAND_SELECT_COLUMNS = BRAND_SELECT_COLUMNS.filter(
  (column) => !OPTIONAL_BRAND_COLUMNS.includes(column as (typeof OPTIONAL_BRAND_COLUMNS)[number])
);
const BRAND_BASE_SELECT = [
  ...BRAND_SELECT_COLUMNS,
].join(",");
const LEGACY_BRAND_BASE_SELECT = [...LEGACY_BRAND_SELECT_COLUMNS].join(",");
const BRAND_EMBEDDED_SELECT = `${BRAND_BASE_SELECT},leads,inbox`;
const LEGACY_BRAND_EMBEDDED_SELECT = `${LEGACY_BRAND_BASE_SELECT},leads,inbox`;

const nowIso = () => new Date().toISOString();

export const createId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
};

const defaultObjective = (): ObjectiveData => ({
  goal: "",
  constraints: "",
  scoring: {
    conversionWeight: 0.6,
    qualityWeight: 0.2,
    replyWeight: 0.2,
  },
});

export const defaultHypothesisSourceConfig = (): HypothesisSourceConfig => ({
  actorId: "",
  actorInput: {},
  maxLeads: 100,
});

export const defaultExperimentRunPolicy = (): ExperimentRunPolicy => ({
  cadence: "3_step_7_day",
  dailyCap: 30,
  hourlyCap: 6,
  timezone: "America/Los_Angeles",
  minSpacingMinutes: 8,
});

const defaultExperimentExecutionStatus = (): ExperimentExecutionStatus => "idle";

const defaultStepState = (): CampaignRecord["stepState"] => ({
  objectiveCompleted: false,
  hypothesesCompleted: false,
  experimentsCompleted: false,
  evolutionCompleted: false,
  currentStep: "objective",
});

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const normalizeStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? "").trim())
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/\n|,/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
};

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSocialDiscoveryYouTubeSubscriptions(value: unknown): BrandRecord["socialDiscoveryYouTubeSubscriptions"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      const row = asRecord(entry);
      const channelId = String(row.channelId ?? row.channel_id ?? "").trim();
      if (!channelId) return null;
      const status = String(row.status ?? "").trim().toLowerCase();
      return {
        id: String(row.id ?? `ytsub_${channelId || index}`),
        channelId,
        channelTitle: String(row.channelTitle ?? row.channel_title ?? "").trim(),
        accountId: String(row.accountId ?? row.account_id ?? "").trim(),
        accountName: String(row.accountName ?? row.account_name ?? "").trim(),
        autoComment: normalizeBoolean(row.autoComment ?? row.auto_comment, true),
        leaseSeconds: Math.max(0, Math.round(normalizeNumber(row.leaseSeconds ?? row.lease_seconds, 0))),
        leaseExpiresAt: String(row.leaseExpiresAt ?? row.lease_expires_at ?? "").trim(),
        status: ["pending", "active", "error"].includes(status)
          ? (status as BrandRecord["socialDiscoveryYouTubeSubscriptions"][number]["status"])
          : "pending",
        callbackUrl: String(row.callbackUrl ?? row.callback_url ?? "").trim(),
        topicUrl: String(row.topicUrl ?? row.topic_url ?? "").trim(),
        lastSubscribeRequestedAt: String(row.lastSubscribeRequestedAt ?? row.last_subscribe_requested_at ?? "").trim(),
        lastVerifiedAt: String(row.lastVerifiedAt ?? row.last_verified_at ?? "").trim(),
        lastNotificationAt: String(row.lastNotificationAt ?? row.last_notification_at ?? "").trim(),
        lastVideoId: String(row.lastVideoId ?? row.last_video_id ?? "").trim(),
        lastVideoUrl: String(row.lastVideoUrl ?? row.last_video_url ?? "").trim(),
        lastCommentId: String(row.lastCommentId ?? row.last_comment_id ?? "").trim(),
        lastCommentUrl: String(row.lastCommentUrl ?? row.last_comment_url ?? "").trim(),
        lastError: String(row.lastError ?? row.last_error ?? "").trim(),
      };
    })
    .filter((entry): entry is BrandRecord["socialDiscoveryYouTubeSubscriptions"][number] => Boolean(entry));
}

const SOCIAL_DISCOVERY_COMMENT_PROMPT_NOTE_MARKER = "LASTB2B_SOCIAL_DISCOVERY_COMMENT_PROMPT:";
const SOCIAL_DISCOVERY_QUERIES_NOTE_MARKER = "LASTB2B_SOCIAL_DISCOVERY_QUERIES:";

function extractSocialDiscoveryCommentPromptFromNotes(notesRaw: string) {
  const match = notesRaw.match(
    new RegExp(`<!--\\s*${SOCIAL_DISCOVERY_COMMENT_PROMPT_NOTE_MARKER}([A-Za-z0-9+/=]+)\\s*-->`)
  );
  if (!match?.[1]) return "";
  try {
    return Buffer.from(match[1], "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

function extractSocialDiscoveryQueriesFromNotes(notesRaw: string) {
  const match = notesRaw.match(
    new RegExp(`<!--\\s*${SOCIAL_DISCOVERY_QUERIES_NOTE_MARKER}([A-Za-z0-9+/=]+)\\s*-->`)
  );
  if (!match?.[1]) return [];
  try {
    const parsed = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    return normalizeStringArray(parsed);
  } catch {
    return [];
  }
}

function stripSocialDiscoveryMetadataFromNotes(notesRaw: string) {
  return notesRaw
    .replace(
      new RegExp(`\\n*<!--\\s*${SOCIAL_DISCOVERY_COMMENT_PROMPT_NOTE_MARKER}[A-Za-z0-9+/=]+\\s*-->\\n*`, "g"),
      "\n\n"
    )
    .replace(
      new RegExp(`\\n*<!--\\s*${SOCIAL_DISCOVERY_QUERIES_NOTE_MARKER}[A-Za-z0-9+/=]+\\s*-->\\n*`, "g"),
      "\n\n"
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mergeNotesWithSocialDiscoveryMetadata(input: {
  notes: string;
  prompt: string;
  queries: string[];
}) {
  const visibleNotes = stripSocialDiscoveryMetadataFromNotes(String(input.notes ?? "").trim());
  const trimmedPrompt = String(input.prompt ?? "").trim();
  const normalizedQueries = normalizeStringArray(input.queries);
  const markers: string[] = [];
  if (trimmedPrompt) {
    const encodedPrompt = Buffer.from(trimmedPrompt, "utf8").toString("base64");
    markers.push(`<!-- ${SOCIAL_DISCOVERY_COMMENT_PROMPT_NOTE_MARKER}${encodedPrompt} -->`);
  }
  if (normalizedQueries.length) {
    const encodedQueries = Buffer.from(JSON.stringify(normalizedQueries), "utf8").toString("base64");
    markers.push(`<!-- ${SOCIAL_DISCOVERY_QUERIES_NOTE_MARKER}${encodedQueries} -->`);
  }
  return [visibleNotes, ...markers].filter(Boolean).join("\n\n").trim();
}

function supabaseErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "";
  return String((error as { message?: unknown }).message ?? "").trim();
}

function isMissingSupabaseColumn(error: unknown, column: string) {
  const message = supabaseErrorMessage(error).toLowerCase();
  const normalizedColumn = column.toLowerCase();
  return (
    message.includes(`could not find the '${normalizedColumn}' column`) ||
    message.includes(`.${normalizedColumn} does not exist`) ||
    message.includes(`column ${normalizedColumn} does not exist`)
  );
}

const mapBrandRow = (input: unknown): BrandRecord => {
  const row = asRecord(input);
  const notesRaw = String(row.notes ?? "");
  const promptFromNotes = extractSocialDiscoveryCommentPromptFromNotes(notesRaw);
  const queriesFromNotes = extractSocialDiscoveryQueriesFromNotes(notesRaw);
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? "Untitled Brand"),
    website: String(row.website ?? ""),
    tone: String(row.tone ?? ""),
    notes: stripSocialDiscoveryMetadataFromNotes(notesRaw),
    product: String(row.product ?? ""),
    socialDiscoveryCommentPrompt: String(
      row.social_discovery_comment_prompt ?? row.socialDiscoveryCommentPrompt ?? promptFromNotes
    ),
    socialDiscoveryPlatforms: normalizeStringArray(
      row.social_discovery_platforms ?? row.socialDiscoveryPlatforms ?? []
    ),
    socialDiscoveryQueries: normalizeStringArray(
      row.social_discovery_queries ?? row.socialDiscoveryQueries ?? queriesFromNotes
    ),
    socialDiscoveryYouTubeSubscriptions: normalizeSocialDiscoveryYouTubeSubscriptions(
      row.social_discovery_youtube_subscriptions ?? row.socialDiscoveryYouTubeSubscriptions ?? []
    ),
    operablePersonas: normalizeStringArray(
      row.operable_personas ?? row.operablePersonas ?? row.real_personas ?? row.realPersonas
    ),
    availableAssets: normalizeStringArray(
      row.available_assets ?? row.availableAssets ?? row.real_assets ?? row.realAssets
    ),
    targetMarkets: normalizeStringArray(row.target_markets ?? row.targetMarkets),
    idealCustomerProfiles: normalizeStringArray(
      row.ideal_customer_profiles ?? row.idealCustomerProfiles ?? row.target_buyers
    ),
    keyFeatures: normalizeStringArray(row.key_features ?? row.keyFeatures),
    keyBenefits: normalizeStringArray(row.key_benefits ?? row.keyBenefits ?? row.offers),
    domains: Array.isArray(row.domains) ? (row.domains as DomainRow[]) : [],
    leads: Array.isArray(row.leads) ? (row.leads as LeadRow[]) : [],
    inbox: Array.isArray(row.inbox) ? (row.inbox as InboxRow[]) : [],
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
};

const mapCampaignRow = (input: unknown): CampaignRecord => {
  const row = asRecord(input);
  const hypotheses = Array.isArray(row.hypotheses)
    ? (row.hypotheses as Hypothesis[]).map((item) => ({
        ...item,
        actorQuery: String(item.actorQuery ?? ""),
        sourceConfig: {
          ...defaultHypothesisSourceConfig(),
          ...(item.sourceConfig && typeof item.sourceConfig === "object"
            ? (item.sourceConfig as HypothesisSourceConfig)
            : {}),
        },
      }))
    : [];
  const experiments = Array.isArray(row.experiments)
    ? (row.experiments as Experiment[]).map((item) => ({
        ...item,
        runPolicy: {
          ...defaultExperimentRunPolicy(),
          ...(item.runPolicy && typeof item.runPolicy === "object"
            ? (item.runPolicy as ExperimentRunPolicy)
            : {}),
        },
        executionStatus:
          [
            "idle",
            "queued",
            "sourcing",
            "scheduled",
            "sending",
            "monitoring",
            "paused",
            "completed",
            "failed",
          ].includes(String(item.executionStatus ?? ""))
            ? (String(item.executionStatus) as ExperimentExecutionStatus)
            : defaultExperimentExecutionStatus(),
      }))
    : [];
  return {
    id: String(row.id ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    name: String(row.name ?? "Untitled Campaign"),
    status: (row.status as CampaignRecord["status"]) ?? "draft",
    objective: (row.objective as ObjectiveData | undefined) ?? defaultObjective(),
    hypotheses,
    experiments,
    evolution: Array.isArray(row.evolution) ? (row.evolution as EvolutionSnapshot[]) : [],
    stepState: (row.step_state as CampaignRecord["stepState"] | undefined) ?? (row.stepState as CampaignRecord["stepState"] | undefined) ?? defaultStepState(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
};

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeJsonArray<T>(filePath: string, rows: T[]) {
  if (!isVercel) {
    await mkdir(`${process.cwd()}/data`, { recursive: true });
  }
  await writeFile(filePath, JSON.stringify(rows, null, 2));
}

async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), ms);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function mergeBrandStores(primary: BrandRecord[], fallback: BrandRecord[]) {
  const rows = new Map<string, BrandRecord>();

  for (const row of fallback) {
    rows.set(row.id, row);
  }

  for (const row of primary) {
    rows.set(row.id, row);
  }

  return [...rows.values()].sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
}

async function readBrandRowsFromStore(): Promise<BrandRecord[]> {
  const mutable = (await readJsonArray<BrandRecord>(BRANDS_PATH)).map((row) => mapBrandRow(row));
  const embedded = EMBEDDED_BRAND_FALLBACKS.map((row) => mapBrandRow(row));
  if (!isVercel || BUNDLED_BRANDS_PATH === BRANDS_PATH) {
    return mergeBrandStores(mutable, embedded);
  }

  const bundled = (await readJsonArray<BrandRecord>(BUNDLED_BRANDS_PATH)).map((row) => mapBrandRow(row));
  return mergeBrandStores(mergeBrandStores(mutable, bundled), embedded);
}

export async function listBrands(): Promise<BrandRecord[]> {
  return listBrandsWithOptions();
}

export async function listBrandsWithOptions(options?: {
  includeEmbedded?: boolean;
}): Promise<BrandRecord[]> {
  const selectColumns = options?.includeEmbedded ? BRAND_EMBEDDED_SELECT : BRAND_BASE_SELECT;
  const legacySelectColumns = options?.includeEmbedded ? LEGACY_BRAND_EMBEDDED_SELECT : LEGACY_BRAND_BASE_SELECT;
  const local = await readBrandRowsFromStore();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    let response = (await withTimeout(
      supabase
        .from(BRAND_TABLE)
        .select(selectColumns)
        .order("updated_at", { ascending: false }),
      SUPABASE_QUERY_TIMEOUT_MS
    )) as { data: unknown[] | null; error: unknown | null } | null;
    const responseError = response?.error;
    if (responseError && OPTIONAL_BRAND_COLUMNS.some((column) => isMissingSupabaseColumn(responseError, column))) {
      response = (await withTimeout(
        supabase
          .from(BRAND_TABLE)
          .select(legacySelectColumns)
          .order("updated_at", { ascending: false }),
        SUPABASE_QUERY_TIMEOUT_MS
      )) as { data: unknown[] | null; error: unknown | null } | null;
    }
    if (response && !response.error) {
      return mergeBrandStores(
        (response.data ?? []).map((row) => mapBrandRow(row)),
        local
      );
    }
  }
  return local;
}

export async function getBrandById(
  brandId: string,
  options?: {
    includeEmbedded?: boolean;
  }
): Promise<BrandRecord | null> {
  const selectColumns = options?.includeEmbedded ? BRAND_EMBEDDED_SELECT : BRAND_BASE_SELECT;
  const legacySelectColumns = options?.includeEmbedded ? LEGACY_BRAND_EMBEDDED_SELECT : LEGACY_BRAND_BASE_SELECT;
  const local = await readBrandRowsFromStore();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    let response = (await withTimeout(
      supabase
        .from(BRAND_TABLE)
        .select(selectColumns)
        .eq("id", brandId)
        .maybeSingle(),
      SUPABASE_QUERY_TIMEOUT_MS
    )) as { data: unknown | null; error: unknown | null } | null;
    const responseError = response?.error;
    if (responseError && OPTIONAL_BRAND_COLUMNS.some((column) => isMissingSupabaseColumn(responseError, column))) {
      response = (await withTimeout(
        supabase
          .from(BRAND_TABLE)
          .select(legacySelectColumns)
          .eq("id", brandId)
          .maybeSingle(),
        SUPABASE_QUERY_TIMEOUT_MS
      )) as { data: unknown | null; error: unknown | null } | null;
    }
    if (response && !response.error && response.data) {
      return mapBrandRow(response.data);
    }
  }
  return local.find((row) => row.id === brandId) ?? null;
}

export async function createBrand(input: {
  name: string;
  website: string;
  tone?: string;
  notes?: string;
  product?: string;
  socialDiscoveryPlatforms?: string[];
  socialDiscoveryQueries?: string[];
  socialDiscoveryCommentPrompt?: string;
  socialDiscoveryYouTubeSubscriptions?: BrandRecord["socialDiscoveryYouTubeSubscriptions"];
  operablePersonas?: string[];
  availableAssets?: string[];
  targetMarkets?: string[];
  idealCustomerProfiles?: string[];
  keyFeatures?: string[];
  keyBenefits?: string[];
}): Promise<BrandRecord> {
  const now = nowIso();
  const brand: BrandRecord = {
    id: createId("brand"),
    name: input.name.trim(),
    website: input.website.trim(),
    tone: String(input.tone ?? "").trim(),
    notes: String(input.notes ?? "").trim(),
    product: String(input.product ?? "").trim(),
    socialDiscoveryCommentPrompt: String(input.socialDiscoveryCommentPrompt ?? "").trim(),
    socialDiscoveryPlatforms: normalizeStringArray(input.socialDiscoveryPlatforms ?? []),
    socialDiscoveryQueries: normalizeStringArray(input.socialDiscoveryQueries ?? []),
    socialDiscoveryYouTubeSubscriptions: normalizeSocialDiscoveryYouTubeSubscriptions(
      input.socialDiscoveryYouTubeSubscriptions ?? []
    ),
    operablePersonas: normalizeStringArray(input.operablePersonas),
    availableAssets: normalizeStringArray(input.availableAssets),
    targetMarkets: normalizeStringArray(input.targetMarkets),
    idealCustomerProfiles: normalizeStringArray(input.idealCustomerProfiles),
    keyFeatures: normalizeStringArray(input.keyFeatures),
    keyBenefits: normalizeStringArray(input.keyBenefits),
    domains: [],
    leads: [],
    inbox: [],
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const insertPayload = {
      id: brand.id,
      name: brand.name,
      website: brand.website,
      tone: brand.tone,
      notes: mergeNotesWithSocialDiscoveryMetadata({
        notes: brand.notes,
        prompt: brand.socialDiscoveryCommentPrompt,
        queries: brand.socialDiscoveryQueries,
      }),
      product: brand.product,
      social_discovery_comment_prompt: brand.socialDiscoveryCommentPrompt,
      social_discovery_platforms: brand.socialDiscoveryPlatforms,
      social_discovery_queries: brand.socialDiscoveryQueries,
      social_discovery_youtube_subscriptions: brand.socialDiscoveryYouTubeSubscriptions,
      operable_personas: brand.operablePersonas,
      available_assets: brand.availableAssets,
      target_markets: brand.targetMarkets,
      ideal_customer_profiles: brand.idealCustomerProfiles,
      key_features: brand.keyFeatures,
      key_benefits: brand.keyBenefits,
      domains: brand.domains,
      leads: brand.leads,
      inbox: brand.inbox,
    };
    let { data, error } = await supabase
      .from(BRAND_TABLE)
      .insert(insertPayload)
      .select("*")
      .single();
    if (OPTIONAL_BRAND_COLUMNS.some((column) => isMissingSupabaseColumn(error, column))) {
      const legacyInsertPayload: Record<string, unknown> = { ...insertPayload };
      delete legacyInsertPayload.social_discovery_comment_prompt;
      delete legacyInsertPayload.social_discovery_platforms;
      delete legacyInsertPayload.social_discovery_queries;
      delete legacyInsertPayload.social_discovery_youtube_subscriptions;
      delete legacyInsertPayload.operable_personas;
      delete legacyInsertPayload.available_assets;
      const retried = await supabase
        .from(BRAND_TABLE)
        .insert(legacyInsertPayload)
        .select(LEGACY_BRAND_EMBEDDED_SELECT)
        .single();
      data = retried.data;
      error = retried.error;
    }
    if (!error && data) {
      return mapBrandRow(data);
    }
    if (isVercel) {
      const detail = supabaseErrorMessage(error);
      throw new Error(detail ? `Failed to persist brand in Supabase: ${detail}` : "Failed to persist brand in Supabase.");
    }
  }

  const rows = await readJsonArray<BrandRecord>(BRANDS_PATH);
  rows.unshift(brand);
  await writeJsonArray(BRANDS_PATH, rows);
  return brand;
}

export async function updateBrand(
  brandId: string,
  patch: Partial<
    Pick<
      BrandRecord,
      | "name"
      | "website"
      | "tone"
      | "notes"
      | "product"
      | "socialDiscoveryCommentPrompt"
      | "socialDiscoveryPlatforms"
      | "socialDiscoveryQueries"
      | "socialDiscoveryYouTubeSubscriptions"
      | "operablePersonas"
      | "availableAssets"
      | "targetMarkets"
      | "idealCustomerProfiles"
      | "keyFeatures"
      | "keyBenefits"
      | "domains"
      | "leads"
      | "inbox"
    >
  >
): Promise<BrandRecord | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const existingBrand =
      typeof patch.notes === "string" ||
      typeof patch.socialDiscoveryCommentPrompt === "string" ||
      Array.isArray(patch.socialDiscoveryQueries)
        ? await getBrandById(brandId, { includeEmbedded: true })
        : null;
    const update: Record<string, unknown> = {};
    if (typeof patch.name === "string") update.name = patch.name;
    if (typeof patch.website === "string") update.website = patch.website;
    if (typeof patch.tone === "string") update.tone = patch.tone;
    if (typeof patch.product === "string") update.product = patch.product;
    if (
      typeof patch.notes === "string" ||
      typeof patch.socialDiscoveryCommentPrompt === "string" ||
      Array.isArray(patch.socialDiscoveryQueries)
    ) {
      const nextNotes = typeof patch.notes === "string" ? patch.notes : existingBrand?.notes ?? "";
      const nextPrompt =
        typeof patch.socialDiscoveryCommentPrompt === "string"
          ? patch.socialDiscoveryCommentPrompt
          : existingBrand?.socialDiscoveryCommentPrompt ?? "";
      const nextQueries = Array.isArray(patch.socialDiscoveryQueries)
        ? patch.socialDiscoveryQueries
        : existingBrand?.socialDiscoveryQueries ?? [];
      update.notes = mergeNotesWithSocialDiscoveryMetadata({
        notes: nextNotes,
        prompt: nextPrompt,
        queries: nextQueries,
      });
    }
    if (typeof patch.socialDiscoveryCommentPrompt === "string") {
      update.social_discovery_comment_prompt = patch.socialDiscoveryCommentPrompt;
    }
    if (Array.isArray(patch.socialDiscoveryPlatforms)) {
      update.social_discovery_platforms = patch.socialDiscoveryPlatforms;
    }
    if (Array.isArray(patch.socialDiscoveryQueries)) {
      update.social_discovery_queries = patch.socialDiscoveryQueries;
    }
    if (Array.isArray(patch.socialDiscoveryYouTubeSubscriptions)) {
      update.social_discovery_youtube_subscriptions = normalizeSocialDiscoveryYouTubeSubscriptions(
        patch.socialDiscoveryYouTubeSubscriptions
      );
    }
    if (Array.isArray(patch.operablePersonas)) update.operable_personas = patch.operablePersonas;
    if (Array.isArray(patch.availableAssets)) update.available_assets = patch.availableAssets;
    if (Array.isArray(patch.targetMarkets)) update.target_markets = patch.targetMarkets;
    if (Array.isArray(patch.idealCustomerProfiles)) {
      update.ideal_customer_profiles = patch.idealCustomerProfiles;
    }
    if (Array.isArray(patch.keyFeatures)) update.key_features = patch.keyFeatures;
    if (Array.isArray(patch.keyBenefits)) update.key_benefits = patch.keyBenefits;
    if (Array.isArray(patch.domains)) update.domains = patch.domains;
    if (Array.isArray(patch.leads)) update.leads = patch.leads;
    if (Array.isArray(patch.inbox)) update.inbox = patch.inbox;

    let { data, error } = await supabase
      .from(BRAND_TABLE)
      .update(update)
      .eq("id", brandId)
      .select("*")
      .maybeSingle();
    if (OPTIONAL_BRAND_COLUMNS.some((column) => isMissingSupabaseColumn(error, column))) {
      delete update.social_discovery_comment_prompt;
      delete update.social_discovery_platforms;
      delete update.social_discovery_queries;
      delete update.social_discovery_youtube_subscriptions;
      delete update.operable_personas;
      delete update.available_assets;
      const retried = await supabase
        .from(BRAND_TABLE)
        .update(update)
        .eq("id", brandId)
        .select(LEGACY_BRAND_EMBEDDED_SELECT)
        .maybeSingle();
      data = retried.data;
      error = retried.error;
    }

    if (!error && data) {
      return mapBrandRow(data);
    }
  }

  const rows = await readJsonArray<BrandRecord>(BRANDS_PATH);
  const existing = (await getBrandById(brandId, { includeEmbedded: true })) ?? rows.find((row) => row.id === brandId);
  if (!existing) return null;

  const index = rows.findIndex((row) => row.id === brandId);
  const next: BrandRecord = {
    ...mapBrandRow(existing),
    ...patch,
    socialDiscoveryYouTubeSubscriptions: Array.isArray(patch.socialDiscoveryYouTubeSubscriptions)
      ? normalizeSocialDiscoveryYouTubeSubscriptions(patch.socialDiscoveryYouTubeSubscriptions)
      : mapBrandRow(existing).socialDiscoveryYouTubeSubscriptions,
    updatedAt: nowIso(),
  };
  if (index < 0) {
    rows.unshift(next);
  } else {
    rows[index] = next;
  }
  await writeJsonArray(BRANDS_PATH, rows);
  return next;
}

export async function deleteBrand(brandId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase.from(CAMPAIGN_TABLE).delete().eq("brand_id", brandId);
    const { error } = await supabase.from(BRAND_TABLE).delete().eq("id", brandId);
    if (!error) {
      return true;
    }
  }

  const brands = await readJsonArray<BrandRecord>(BRANDS_PATH);
  const nextBrands = brands.filter((row) => row.id !== brandId);
  if (nextBrands.length === brands.length) return false;
  await writeJsonArray(BRANDS_PATH, nextBrands);

  const campaigns = await readJsonArray<CampaignRecord>(CAMPAIGNS_PATH);
  const nextCampaigns = campaigns.filter((row) => row.brandId !== brandId);
  await writeJsonArray(CAMPAIGNS_PATH, nextCampaigns);

  return true;
}

export async function listCampaigns(brandId: string): Promise<CampaignRecord[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(CAMPAIGN_TABLE)
      .select("*")
      .eq("brand_id", brandId)
      .order("updated_at", { ascending: false });
    if (!error) {
      return (data ?? []).map(mapCampaignRow);
    }
  }

  const rows = await readJsonArray<CampaignRecord>(CAMPAIGNS_PATH);
  return rows
    .map((row) => mapCampaignRow(row))
    .filter((row) => row.brandId === brandId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getCampaignById(brandId: string, campaignId: string): Promise<CampaignRecord | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(CAMPAIGN_TABLE)
      .select("*")
      .eq("brand_id", brandId)
      .eq("id", campaignId)
      .maybeSingle();
    if (!error && data) {
      return mapCampaignRow(data);
    }
  }

  const rows = await readJsonArray<CampaignRecord>(CAMPAIGNS_PATH);
  const hit = rows.find((row) => row.brandId === brandId && row.id === campaignId);
  return hit ? mapCampaignRow(hit) : null;
}

export async function createCampaign(input: {
  brandId: string;
  name: string;
}): Promise<CampaignRecord> {
  const now = nowIso();
  const campaign: CampaignRecord = {
    id: createId("camp"),
    brandId: input.brandId,
    name: input.name.trim() || "Untitled Campaign",
    status: "draft",
    objective: defaultObjective(),
    hypotheses: [],
    experiments: [],
    evolution: [],
    stepState: defaultStepState(),
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(CAMPAIGN_TABLE)
      .insert({
        id: campaign.id,
        brand_id: campaign.brandId,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        hypotheses: campaign.hypotheses,
        experiments: campaign.experiments,
        evolution: campaign.evolution,
        step_state: campaign.stepState,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapCampaignRow(data);
    }
  }

  const rows = await readJsonArray<CampaignRecord>(CAMPAIGNS_PATH);
  rows.unshift(campaign);
  await writeJsonArray(CAMPAIGNS_PATH, rows);
  return campaign;
}

export async function updateCampaign(
  brandId: string,
  campaignId: string,
  patch: Partial<
    Pick<
      CampaignRecord,
      "name" | "status" | "objective" | "hypotheses" | "experiments" | "evolution" | "stepState"
    >
  >
): Promise<CampaignRecord | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = {};
    if (typeof patch.name === "string") update.name = patch.name;
    if (typeof patch.status === "string") update.status = patch.status;
    if (patch.objective && typeof patch.objective === "object") update.objective = patch.objective;
    if (Array.isArray(patch.hypotheses)) update.hypotheses = patch.hypotheses;
    if (Array.isArray(patch.experiments)) update.experiments = patch.experiments;
    if (Array.isArray(patch.evolution)) update.evolution = patch.evolution;
    if (patch.stepState && typeof patch.stepState === "object") update.step_state = patch.stepState;

    const { data, error } = await supabase
      .from(CAMPAIGN_TABLE)
      .update(update)
      .eq("brand_id", brandId)
      .eq("id", campaignId)
      .select("*")
      .maybeSingle();

    if (!error && data) {
      return mapCampaignRow(data);
    }
  }

  const rows = await readJsonArray<CampaignRecord>(CAMPAIGNS_PATH);
  const index = rows.findIndex((row) => row.brandId === brandId && row.id === campaignId);
  if (index < 0) return null;
  const next: CampaignRecord = {
    ...mapCampaignRow(rows[index]),
    ...patch,
    updatedAt: nowIso(),
  };
  rows[index] = next;
  await writeJsonArray(CAMPAIGNS_PATH, rows);
  return next;
}

export async function deleteCampaign(brandId: string, campaignId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error } = await supabase
      .from(CAMPAIGN_TABLE)
      .delete()
      .eq("brand_id", brandId)
      .eq("id", campaignId);
    if (!error) {
      return true;
    }
  }

  const rows = await readJsonArray<CampaignRecord>(CAMPAIGNS_PATH);
  const next = rows.filter((row) => !(row.brandId === brandId && row.id === campaignId));
  if (next.length === rows.length) return false;
  await writeJsonArray(CAMPAIGNS_PATH, next);
  return true;
}

export function nextCampaignStep(campaign: CampaignRecord): CampaignStep {
  if (!campaign.stepState.objectiveCompleted) return "objective";
  if (!campaign.stepState.hypothesesCompleted) return "hypotheses";
  if (!campaign.stepState.experimentsCompleted) return "experiments";
  if (!campaign.stepState.evolutionCompleted) return "evolution";
  return "evolution";
}
