import { readFile, writeFile, mkdir } from "fs/promises";
import { getSupabaseAdmin } from "./supabase-admin";

export type Brand = {
  id?: string;
  brandName?: string;
  website?: string;
  tone?: string;
  targetBuyers?: string;
  offers?: string;
  proof?: string;
  modules?: Record<string, unknown>;
  ideas?: unknown[];
  sequences?: unknown[];
  leads?: unknown[];
  inbox?: unknown[];
  domains?: unknown[];
  createdAt?: string;
  updatedAt?: string;
};

const isVercel = Boolean(process.env.VERCEL);

const BRAND_DATA_PATH = isVercel
  ? "/tmp/brands.json"
  : `${process.cwd()}/data/brands.json`;

const LEGACY_DATA_PATH = `${process.cwd()}/data/projects.json`;

const TABLE_NAME = "demanddev_brands";

const mapRowToBrand = (row: any): Brand => ({
  id: row?.id,
  brandName: row?.brand_name ?? "",
  website: row?.website ?? "",
  tone: row?.tone ?? "",
  targetBuyers: row?.target_buyers ?? "",
  offers: row?.offers ?? "",
  proof: row?.proof ?? "",
  modules: row?.modules ?? {},
  ideas: row?.ideas ?? [],
  sequences: row?.sequences ?? [],
  leads: row?.leads ?? [],
  inbox: row?.inbox ?? [],
  domains: row?.domains ?? [],
  createdAt: row?.created_at ?? "",
  updatedAt: row?.updated_at ?? "",
});

export async function readBrands(): Promise<Brand[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase.from(TABLE_NAME).select("*").order("created_at", { ascending: false });
    if (error) {
      return [];
    }
    return (data ?? []).map(mapRowToBrand);
  }

  try {
    const raw = await readFile(BRAND_DATA_PATH, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as Brand[]) : [];
  } catch {
    if (isVercel) {
      return [] as Brand[];
    }
    try {
      const legacyRaw = await readFile(LEGACY_DATA_PATH, "utf-8");
      const legacyData = JSON.parse(legacyRaw);
      if (Array.isArray(legacyData)) {
        await writeBrands(legacyData as Brand[]);
        return legacyData as Brand[];
      }
    } catch {
        return [] as Brand[];
    }
    return [] as Brand[];
  }
}

export async function writeBrands(brands: Brand[]) {
  if (!isVercel) {
    await mkdir(`${process.cwd()}/data`, { recursive: true });
  }
  await writeFile(BRAND_DATA_PATH, JSON.stringify(brands, null, 2));
}
