import { readFile, writeFile, mkdir } from "fs/promises";

export type Brand = {
  id?: string;
  brandName?: string;
  website?: string;
  tone?: string;
  proof?: string;
  modules?: Record<string, unknown>;
  ideas?: unknown[];
  sequences?: unknown[];
  leads?: unknown[];
  inbox?: unknown[];
  domains?: unknown[];
};

const isVercel = Boolean(process.env.VERCEL);

const BRAND_DATA_PATH = isVercel
  ? "/tmp/brands.json"
  : `${process.cwd()}/data/brands.json`;

const LEGACY_DATA_PATH = `${process.cwd()}/data/projects.json`;

export async function readBrands(): Promise<Brand[]> {
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
