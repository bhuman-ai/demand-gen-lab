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
const BRANDS_PATH = isVercel
  ? "/tmp/factory_brands.json"
  : `${process.cwd()}/data/brands.v2.json`;
const CAMPAIGNS_PATH = isVercel
  ? "/tmp/factory_campaigns.json"
  : `${process.cwd()}/data/campaigns.v2.json`;

const BRAND_TABLE = "demanddev_brands";
const CAMPAIGN_TABLE = "demanddev_campaigns";

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

const mapBrandRow = (input: unknown): BrandRecord => {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? "Untitled Brand"),
    website: String(row.website ?? ""),
    tone: String(row.tone ?? ""),
    notes: String(row.notes ?? ""),
    product: String(row.product ?? ""),
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

export async function listBrands(): Promise<BrandRecord[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(BRAND_TABLE)
      .select("*")
      .order("updated_at", { ascending: false });
    if (!error) {
      return (data ?? []).map(mapBrandRow);
    }
  }
  const rows = await readJsonArray<BrandRecord>(BRANDS_PATH);
  return rows
    .map((row) => mapBrandRow(row))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getBrandById(brandId: string): Promise<BrandRecord | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(BRAND_TABLE)
      .select("*")
      .eq("id", brandId)
      .maybeSingle();
    if (!error && data) {
      return mapBrandRow(data);
    }
  }
  const rows = await readJsonArray<BrandRecord>(BRANDS_PATH);
  const hit = rows.find((row) => row.id === brandId);
  return hit ? mapBrandRow(hit) : null;
}

export async function createBrand(input: {
  name: string;
  website: string;
  tone?: string;
  notes?: string;
  product?: string;
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
    const { data, error } = await supabase
      .from(BRAND_TABLE)
      .insert({
        id: brand.id,
        name: brand.name,
        website: brand.website,
        tone: brand.tone,
        notes: brand.notes,
        product: brand.product,
        target_markets: brand.targetMarkets,
        ideal_customer_profiles: brand.idealCustomerProfiles,
        key_features: brand.keyFeatures,
        key_benefits: brand.keyBenefits,
        domains: brand.domains,
        leads: brand.leads,
        inbox: brand.inbox,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapBrandRow(data);
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
    const update: Record<string, unknown> = {};
    if (typeof patch.name === "string") update.name = patch.name;
    if (typeof patch.website === "string") update.website = patch.website;
    if (typeof patch.tone === "string") update.tone = patch.tone;
    if (typeof patch.notes === "string") update.notes = patch.notes;
    if (typeof patch.product === "string") update.product = patch.product;
    if (Array.isArray(patch.targetMarkets)) update.target_markets = patch.targetMarkets;
    if (Array.isArray(patch.idealCustomerProfiles)) {
      update.ideal_customer_profiles = patch.idealCustomerProfiles;
    }
    if (Array.isArray(patch.keyFeatures)) update.key_features = patch.keyFeatures;
    if (Array.isArray(patch.keyBenefits)) update.key_benefits = patch.keyBenefits;
    if (Array.isArray(patch.domains)) update.domains = patch.domains;
    if (Array.isArray(patch.leads)) update.leads = patch.leads;
    if (Array.isArray(patch.inbox)) update.inbox = patch.inbox;

    const { data, error } = await supabase
      .from(BRAND_TABLE)
      .update(update)
      .eq("id", brandId)
      .select("*")
      .maybeSingle();

    if (!error && data) {
      return mapBrandRow(data);
    }
  }

  const rows = await readJsonArray<BrandRecord>(BRANDS_PATH);
  const index = rows.findIndex((row) => row.id === brandId);
  if (index < 0) return null;
  const next: BrandRecord = {
    ...mapBrandRow(rows[index]),
    ...patch,
    updatedAt: nowIso(),
  };
  rows[index] = next;
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
