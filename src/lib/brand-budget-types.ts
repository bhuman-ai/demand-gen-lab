export type BrandBudgetCategory =
  | "ai"
  | "ads"
  | "domains"
  | "mailboxes"
  | "email_verification"
  | "data_enrichment"
  | "linkedin"
  | "other";

export type BrandBudgetStatus = "active" | "paused";

export type BrandBudget = {
  brandId: string;
  currency: "USD";
  totalBudgetUsd: number;
  spentUsd: number;
  reservedUsd: number;
  status: BrandBudgetStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type BrandBudgetLedgerStatus = "reserved" | "spent" | "released" | "refunded" | "cancelled";

export type BrandBudgetLedgerEntry = {
  id: string;
  brandId: string;
  category: BrandBudgetCategory;
  amountUsd: number;
  status: BrandBudgetLedgerStatus;
  sourceType: string;
  sourceId: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BrandBudgetSummary = BrandBudget & {
  availableUsd: number;
  ledger: BrandBudgetLedgerEntry[];
};
