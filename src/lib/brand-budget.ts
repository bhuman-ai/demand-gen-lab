import { mkdir, readFile, writeFile } from "fs/promises";
import { createId } from "@/lib/factory-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  BrandBudget,
  BrandBudgetCategory,
  BrandBudgetLedgerEntry,
  BrandBudgetLedgerStatus,
  BrandBudgetStatus,
  BrandBudgetSummary,
} from "@/lib/brand-budget-types";

const isVercel = Boolean(process.env.VERCEL);
const BRAND_BUDGET_STORE_PATH = isVercel
  ? "/tmp/factory_brand_budgets.v1.json"
  : `${process.cwd()}/data/brand-budgets.v1.json`;

const TABLE_BUDGET = "demanddev_brand_budgets";
const TABLE_LEDGER = "demanddev_brand_budget_ledger";

type BrandBudgetStore = {
  budgets: BrandBudget[];
  ledger: BrandBudgetLedgerEntry[];
};

function nowIso() {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: unknown) {
  return Math.max(0, Math.round(asNumber(value, 0) * 10000) / 10000);
}

function normalizeBudgetStatus(value: unknown): BrandBudgetStatus {
  return asString(value) === "paused" ? "paused" : "active";
}

function normalizeLedgerStatus(value: unknown): BrandBudgetLedgerStatus {
  const normalized = asString(value);
  return ["reserved", "spent", "released", "refunded", "cancelled"].includes(normalized)
    ? (normalized as BrandBudgetLedgerStatus)
    : "spent";
}

function normalizeCategory(value: unknown): BrandBudgetCategory {
  const normalized = asString(value);
  return [
    "ai",
    "ads",
    "domains",
    "mailboxes",
    "email_verification",
    "data_enrichment",
    "linkedin",
    "other",
  ].includes(normalized)
    ? (normalized as BrandBudgetCategory)
    : "other";
}

function mapBudgetRow(input: unknown): BrandBudget {
  const row = asRecord(input);
  return {
    brandId: asString(row.brand_id ?? row.brandId),
    currency: "USD",
    totalBudgetUsd: money(row.total_budget_usd ?? row.totalBudgetUsd),
    spentUsd: money(row.spent_usd ?? row.spentUsd),
    reservedUsd: money(row.reserved_usd ?? row.reservedUsd),
    status: normalizeBudgetStatus(row.status),
    notes: asString(row.notes),
    createdAt: asString(row.created_at ?? row.createdAt) || nowIso(),
    updatedAt: asString(row.updated_at ?? row.updatedAt) || nowIso(),
  };
}

function mapLedgerRow(input: unknown): BrandBudgetLedgerEntry {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    brandId: asString(row.brand_id ?? row.brandId),
    category: normalizeCategory(row.category),
    amountUsd: money(row.amount_usd ?? row.amountUsd),
    status: normalizeLedgerStatus(row.status),
    sourceType: asString(row.source_type ?? row.sourceType),
    sourceId: asString(row.source_id ?? row.sourceId),
    description: asString(row.description),
    metadata: asRecord(row.metadata),
    createdAt: asString(row.created_at ?? row.createdAt) || nowIso(),
    updatedAt: asString(row.updated_at ?? row.updatedAt) || nowIso(),
  };
}

function budgetToDb(row: BrandBudget) {
  return {
    brand_id: row.brandId,
    currency: row.currency,
    total_budget_usd: row.totalBudgetUsd,
    spent_usd: row.spentUsd,
    reserved_usd: row.reservedUsd,
    status: row.status,
    notes: row.notes,
  };
}

function ledgerToDb(row: BrandBudgetLedgerEntry) {
  return {
    id: row.id,
    brand_id: row.brandId,
    category: row.category,
    amount_usd: row.amountUsd,
    status: row.status,
    source_type: row.sourceType,
    source_id: row.sourceId,
    description: row.description,
    metadata: row.metadata,
  };
}

function availableBudget(budget: BrandBudget) {
  return Math.max(0, money(budget.totalBudgetUsd - budget.spentUsd - budget.reservedUsd));
}

function defaultBudget(brandId: string): BrandBudget {
  const now = nowIso();
  return {
    brandId,
    currency: "USD",
    totalBudgetUsd: 0,
    spentUsd: 0,
    reservedUsd: 0,
    status: "paused",
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
}

async function readLocalStore(): Promise<BrandBudgetStore> {
  try {
    const raw = await readFile(BRAND_BUDGET_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<BrandBudgetStore>;
    return {
      budgets: Array.isArray(parsed.budgets) ? parsed.budgets.map(mapBudgetRow) : [],
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger.map(mapLedgerRow) : [],
    };
  } catch {
    return { budgets: [], ledger: [] };
  }
}

async function writeLocalStore(store: BrandBudgetStore) {
  await mkdir(BRAND_BUDGET_STORE_PATH.replace(/\/[^/]+$/, ""), { recursive: true });
  await writeFile(BRAND_BUDGET_STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function readBudget(brandId: string) {
  const normalizedBrandId = asString(brandId);
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase.from(TABLE_BUDGET).select("*").eq("brand_id", normalizedBrandId).maybeSingle();
    if (!error && data) return mapBudgetRow(data);
  }
  const store = await readLocalStore();
  return store.budgets.find((row) => row.brandId === normalizedBrandId) ?? defaultBudget(normalizedBrandId);
}

async function listLedger(brandId: string, limit = 100) {
  const normalizedBrandId = asString(brandId);
  const normalizedLimit = Math.max(1, Math.min(250, Math.round(limit)));
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_LEDGER)
      .select("*")
      .eq("brand_id", normalizedBrandId)
      .order("created_at", { ascending: false })
      .limit(normalizedLimit);
    if (!error) return (data ?? []).map((row: unknown) => mapLedgerRow(row));
  }
  const store = await readLocalStore();
  return store.ledger
    .filter((row) => row.brandId === normalizedBrandId)
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
    .slice(0, normalizedLimit);
}

export async function getBrandBudgetSummary(brandId: string, options: { limit?: number } = {}): Promise<BrandBudgetSummary> {
  const budget = await readBudget(brandId);
  const ledger = await listLedger(brandId, options.limit ?? 100);
  return {
    ...budget,
    availableUsd: availableBudget(budget),
    ledger,
  };
}

export async function setBrandBudget(input: {
  brandId: string;
  totalBudgetUsd: number;
  status?: BrandBudgetStatus;
  notes?: string;
}) {
  const existing = await readBudget(input.brandId);
  const next: BrandBudget = {
    ...existing,
    brandId: asString(input.brandId),
    totalBudgetUsd: money(input.totalBudgetUsd),
    status: input.status ?? existing.status,
    notes: typeof input.notes === "string" ? input.notes.trim() : existing.notes,
    updatedAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_BUDGET)
      .upsert(budgetToDb(next), { onConflict: "brand_id" })
      .select("*")
      .single();
    if (!error && data) return mapBudgetRow(data);
  }

  const store = await readLocalStore();
  const index = store.budgets.findIndex((row) => row.brandId === next.brandId);
  if (index >= 0) {
    store.budgets[index] = next;
  } else {
    store.budgets.unshift(next);
  }
  await writeLocalStore(store);
  return next;
}

export async function reserveBrandBudget(input: {
  brandId: string;
  amountUsd: number;
  category: BrandBudgetCategory;
  sourceType: string;
  sourceId: string;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  const amountUsd = money(input.amountUsd);
  if (amountUsd <= 0) return null;
  const budget = await readBudget(input.brandId);
  if (budget.status !== "active") {
    throw new Error("Brand budget is not active.");
  }
  if (availableBudget(budget) < amountUsd) {
    throw new Error(
      `Brand budget exceeded: $${availableBudget(budget).toFixed(2)} available, $${amountUsd.toFixed(2)} requested.`
    );
  }

  const entry: BrandBudgetLedgerEntry = {
    id: createId("budget"),
    brandId: input.brandId,
    category: input.category,
    amountUsd,
    status: "reserved",
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    description: input.description,
    metadata: input.metadata ?? {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const nextBudget = {
    ...budget,
    reservedUsd: money(budget.reservedUsd + amountUsd),
    updatedAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error: budgetError } = await supabase
      .from(TABLE_BUDGET)
      .upsert(budgetToDb(nextBudget), { onConflict: "brand_id" });
    const { data, error } = await supabase.from(TABLE_LEDGER).insert(ledgerToDb(entry)).select("*").single();
    if (!budgetError && !error && data) return mapLedgerRow(data);
  }

  const store = await readLocalStore();
  const index = store.budgets.findIndex((row) => row.brandId === input.brandId);
  if (index >= 0) {
    store.budgets[index] = nextBudget;
  } else {
    store.budgets.unshift(nextBudget);
  }
  store.ledger.unshift(entry);
  await writeLocalStore(store);
  return entry;
}

export async function settleBrandBudgetReservation(input: {
  reservationId: string;
  status: Extract<BrandBudgetLedgerStatus, "spent" | "released" | "cancelled">;
  finalAmountUsd?: number;
  metadata?: Record<string, unknown>;
}) {
  const reservationId = asString(input.reservationId);
  if (!reservationId) return null;
  const store = await readLocalStore();
  let existing = store.ledger.find((entry) => entry.id === reservationId) ?? null;
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data } = await supabase.from(TABLE_LEDGER).select("*").eq("id", reservationId).maybeSingle();
    existing = data ? mapLedgerRow(data) : existing;
  }
  if (!existing || existing.status !== "reserved") return existing;

  const budget = await readBudget(existing.brandId);
  const finalAmountUsd = input.status === "spent" ? money(input.finalAmountUsd ?? existing.amountUsd) : 0;
  const nextBudget: BrandBudget = {
    ...budget,
    reservedUsd: money(Math.max(0, budget.reservedUsd - existing.amountUsd)),
    spentUsd: money(budget.spentUsd + finalAmountUsd),
    updatedAt: nowIso(),
  };
  const nextEntry: BrandBudgetLedgerEntry = {
    ...existing,
    amountUsd: input.status === "spent" ? finalAmountUsd : existing.amountUsd,
    status: input.status,
    metadata: { ...existing.metadata, ...(input.metadata ?? {}) },
    updatedAt: nowIso(),
  };

  if (supabase) {
    await supabase.from(TABLE_BUDGET).upsert(budgetToDb(nextBudget), { onConflict: "brand_id" });
    const { data, error } = await supabase.from(TABLE_LEDGER).update(ledgerToDb(nextEntry)).eq("id", reservationId).select("*").single();
    if (!error && data) return mapLedgerRow(data);
  }

  const budgetIndex = store.budgets.findIndex((row) => row.brandId === existing?.brandId);
  if (budgetIndex >= 0) store.budgets[budgetIndex] = nextBudget;
  const ledgerIndex = store.ledger.findIndex((entry) => entry.id === reservationId);
  if (ledgerIndex >= 0) store.ledger[ledgerIndex] = nextEntry;
  await writeLocalStore(store);
  return nextEntry;
}
