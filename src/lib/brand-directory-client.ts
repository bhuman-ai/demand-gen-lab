"use client";

type BrandDirectoryEntry = {
  id: string;
  name: string;
};

let cachedBrandDirectory: BrandDirectoryEntry[] = [];
let brandDirectoryPromise: Promise<BrandDirectoryEntry[]> | null = null;

function normalizeBrandDirectory(input: unknown): BrandDirectoryEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }

      const row = value as Record<string, unknown>;
      const id = String(row.id ?? "").trim();
      if (!id) {
        return null;
      }

      return {
        id,
        name: String(row.name ?? "Untitled brand"),
      };
    })
    .filter((row): row is BrandDirectoryEntry => Boolean(row));
}

async function fetchBrandDirectoryOverNetwork(): Promise<BrandDirectoryEntry[]> {
  const response = await fetch("/api/brands", { cache: "no-store" });
  let payload: unknown = {};

  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error("Failed to load brands");
  }

  const rows = normalizeBrandDirectory(
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { brands?: unknown }).brands
      : []
  );

  cachedBrandDirectory = rows;
  return rows;
}

export function readCachedBrandDirectory() {
  return cachedBrandDirectory;
}

export function hydrateCachedBrandDirectory(rows: BrandDirectoryEntry[]) {
  cachedBrandDirectory = normalizeBrandDirectory(rows);
}

export function upsertCachedBrandDirectoryEntry(row: BrandDirectoryEntry) {
  const normalized = normalizeBrandDirectory([row]);
  const next = normalized[0];
  if (!next) return;

  const existingIndex = cachedBrandDirectory.findIndex((entry) => entry.id === next.id);
  if (existingIndex >= 0) {
    cachedBrandDirectory = cachedBrandDirectory.map((entry, index) => (index === existingIndex ? next : entry));
    return;
  }

  cachedBrandDirectory = [next, ...cachedBrandDirectory];
}

export async function fetchBrandDirectory(options?: { force?: boolean }) {
  const force = options?.force ?? false;

  if (!force && cachedBrandDirectory.length) {
    return cachedBrandDirectory;
  }

  if (!force && brandDirectoryPromise) {
    return brandDirectoryPromise;
  }

  brandDirectoryPromise = fetchBrandDirectoryOverNetwork()
    .catch((error) => {
      if (cachedBrandDirectory.length) {
        return cachedBrandDirectory;
      }
      throw error;
    })
    .finally(() => {
      brandDirectoryPromise = null;
    });

  return brandDirectoryPromise;
}
