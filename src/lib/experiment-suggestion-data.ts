import {
  createExperimentRecord,
  ensureRuntimeForExperiment,
  getExperimentRecordById,
  isExperimentSuggestionRecord,
  listExperimentRecordsWithOptions,
  updateExperimentRecord,
} from "@/lib/experiment-data";
import type { ExperimentSuggestionRecord } from "@/lib/factory-types";

function suggestionKey(input: Pick<ExperimentSuggestionRecord, "name" | "offer" | "audience">) {
  return [input.name, input.offer, input.audience]
    .map((row) => row.trim().toLowerCase().replace(/\s+/g, " "))
    .join("::");
}

function mapToSuggestion(record: Awaited<ReturnType<typeof getExperimentRecordById>>): ExperimentSuggestionRecord | null {
  if (!record) return null;
  if (!isExperimentSuggestionRecord(record)) return null;
  return {
    id: record.id,
    brandId: record.brandId,
    name: record.name,
    offer: record.offer,
    audience: record.audience,
    rationale: "",
    status: record.status === "archived" ? "dismissed" : "suggested",
    source: "system",
    acceptedExperimentId: "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function listExperimentSuggestions(
  brandId: string,
  status?: ExperimentSuggestionRecord["status"]
): Promise<ExperimentSuggestionRecord[]> {
  const rows = await listExperimentRecordsWithOptions(brandId, { includeSuggestions: true });
  const suggestions = rows
    .filter((row) => isExperimentSuggestionRecord(row))
    .filter((row) => {
      if (status === "dismissed") return row.status === "archived";
      if (status === "suggested") return row.status !== "archived";
      return true;
    })
    .map((row) => mapToSuggestion(row))
    .filter((row): row is ExperimentSuggestionRecord => Boolean(row))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return suggestions;
}

export async function getExperimentSuggestionById(
  brandId: string,
  suggestionId: string
): Promise<ExperimentSuggestionRecord | null> {
  const record = await getExperimentRecordById(brandId, suggestionId, {
    includeSuggestions: true,
  });
  return mapToSuggestion(record);
}

export async function createExperimentSuggestions(input: {
  brandId: string;
  source: ExperimentSuggestionRecord["source"];
  suggestions: Array<Pick<ExperimentSuggestionRecord, "name" | "offer" | "audience" | "rationale">>;
}): Promise<ExperimentSuggestionRecord[]> {
  const existing = await listExperimentSuggestions(input.brandId, "suggested");
  const seen = new Set(existing.map((row) => suggestionKey(row)));
  const created: ExperimentSuggestionRecord[] = [];

  for (const item of input.suggestions) {
    const name = item.name.trim();
    const offer = item.offer.trim();
    const audience = item.audience.trim();
    if (!name || !offer || !audience) continue;
    const key = suggestionKey({ name, offer, audience });
    if (seen.has(key)) continue;
    seen.add(key);

    const record = await createExperimentRecord({
      brandId: input.brandId,
      name,
      offer,
      audience,
      createRuntime: false,
    });
    const mapped = mapToSuggestion(record);
    if (mapped) {
      created.push({
        ...mapped,
        source: input.source,
        rationale: item.rationale.trim(),
      });
    }
  }

  return created;
}

export async function updateExperimentSuggestion(
  brandId: string,
  suggestionId: string,
  patch: Partial<Pick<ExperimentSuggestionRecord, "status" | "acceptedExperimentId">>
): Promise<ExperimentSuggestionRecord | null> {
  const existing = await getExperimentRecordById(brandId, suggestionId, {
    includeSuggestions: true,
  });
  if (!existing || !isExperimentSuggestionRecord(existing)) {
    return null;
  }

  if (patch.status === "dismissed") {
    const updated = await updateExperimentRecord(
      brandId,
      suggestionId,
      { status: "archived" },
      { includeSuggestions: true }
    );
    return mapToSuggestion(updated);
  }

  if (patch.status === "accepted") {
    const accepted = await ensureRuntimeForExperiment(existing);
    return {
      id: accepted.id,
      brandId: accepted.brandId,
      name: accepted.name,
      offer: accepted.offer,
      audience: accepted.audience,
      rationale: "",
      status: "accepted",
      source: "system",
      acceptedExperimentId: accepted.id,
      createdAt: accepted.createdAt,
      updatedAt: accepted.updatedAt,
    };
  }

  return mapToSuggestion(existing);
}
