import {
  createExperimentRecord,
  ensureRuntimeForExperiment,
  getExperimentRecordById,
  isExperimentSuggestionRecord,
  listExperimentRecordsWithOptions,
  updateExperimentRecord,
} from "@/lib/experiment-data";
import {
  isConcreteSuggestion as isConcreteSuggestionFields,
  validateConcreteSuggestion,
} from "@/lib/experiment-suggestion-quality";
import type { ExperimentSuggestionRecord } from "@/lib/factory-types";

function suggestionKey(input: Pick<ExperimentSuggestionRecord, "name" | "offer" | "audience">) {
  return [input.name, input.offer, input.audience]
    .map((row) => row.trim().toLowerCase().replace(/\s+/g, " "))
    .join("::");
}

function readLabeledLine(value: string, label: string) {
  const regex = new RegExp(`^${label}:\\s*(.+)$`, "im");
  const match = value.match(regex);
  return match ? match[1].trim() : "";
}

function buildOfferBlob(input: {
  offer: string;
  cta?: string;
  emailPreview?: string;
  successTarget?: string;
  rationale?: string;
}) {
  return [
    `Offer: ${input.offer.trim()}`,
    input.cta?.trim() ? `CTA: ${input.cta.trim()}` : "",
    input.emailPreview?.trim() ? `EmailPreview: ${input.emailPreview.trim()}` : "",
    input.successTarget?.trim() ? `SuccessTarget: ${input.successTarget.trim()}` : "",
    input.rationale?.trim() ? `Why: ${input.rationale.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildAudienceBlob(input: { audience: string; trigger?: string }) {
  return [
    `Who: ${input.audience.trim()}`,
    input.trigger?.trim() ? `Trigger: ${input.trigger.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function mapToSuggestion(record: Awaited<ReturnType<typeof getExperimentRecordById>>): ExperimentSuggestionRecord | null {
  if (!record) return null;
  if (!isExperimentSuggestionRecord(record)) return null;

  const parsedOffer = readLabeledLine(record.offer, "Offer") || record.offer.trim();
  const cta = readLabeledLine(record.offer, "CTA");
  const emailPreview = readLabeledLine(record.offer, "EmailPreview");
  const successTarget = readLabeledLine(record.offer, "SuccessTarget");
  const rationale = readLabeledLine(record.offer, "Why");
  const parsedAudience = readLabeledLine(record.audience, "Who") || record.audience.trim();
  const trigger = readLabeledLine(record.audience, "Trigger");

  return {
    id: record.id,
    brandId: record.brandId,
    name: record.name,
    offer: parsedOffer,
    audience: parsedAudience,
    cta,
    trigger,
    emailPreview,
    successTarget,
    rationale,
    status: record.status === "archived" ? "dismissed" : "suggested",
    source: "system",
    acceptedExperimentId: "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function isConcreteSuggestion(suggestion: ExperimentSuggestionRecord) {
  return isConcreteSuggestionFields({
    name: suggestion.name.trim(),
    audience: suggestion.audience.trim(),
    offer: suggestion.offer.trim(),
    cta: suggestion.cta?.trim() || "",
    emailPreview: suggestion.emailPreview?.trim() || "",
    successTarget: suggestion.successTarget?.trim() || "",
    rationale: suggestion.rationale?.trim() || "",
  });
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
    .filter((row) => isConcreteSuggestion(row))
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
  const mapped = mapToSuggestion(record);
  if (!mapped) return null;
  return isConcreteSuggestion(mapped) ? mapped : null;
}

export async function createExperimentSuggestions(input: {
  brandId: string;
  source: ExperimentSuggestionRecord["source"];
  suggestions: Array<
    Pick<
      ExperimentSuggestionRecord,
      "name" | "offer" | "audience" | "rationale" | "cta" | "trigger" | "emailPreview" | "successTarget"
    >
  >;
}): Promise<ExperimentSuggestionRecord[]> {
  const existing = await listExperimentSuggestions(input.brandId, "suggested");
  const seen = new Set(existing.map((row) => suggestionKey(row)));
  const created: ExperimentSuggestionRecord[] = [];

  for (const item of input.suggestions) {
    const name = item.name.trim();
    const offer = item.offer.trim();
    const audience = item.audience.trim();
    const cta = item.cta?.trim() || "";
    const emailPreview = item.emailPreview?.trim() || "";
    const successTarget = item.successTarget?.trim() || "";
    const rationale = item.rationale?.trim() || "";
    const qualityErrors = validateConcreteSuggestion({
      name,
      audience,
      offer,
      cta,
      emailPreview,
      successTarget,
      rationale,
    });
    if (qualityErrors.length) continue;
    const key = suggestionKey({ name, offer, audience });
    if (seen.has(key)) continue;
    seen.add(key);

    const record = await createExperimentRecord({
      brandId: input.brandId,
      name,
      offer: buildOfferBlob({
        offer,
        cta,
        emailPreview,
        successTarget,
        rationale,
      }),
      audience: buildAudienceBlob({
        audience,
        trigger: item.trigger,
      }),
      createRuntime: false,
    });
    const mapped = mapToSuggestion(record);
    if (mapped) {
      if (!isConcreteSuggestion(mapped)) continue;
      created.push({
        ...mapped,
        source: input.source,
        rationale,
        cta: cta || mapped.cta,
        trigger: item.trigger?.trim() || mapped.trigger,
        emailPreview: emailPreview || mapped.emailPreview,
        successTarget: successTarget || mapped.successTarget,
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
    const mapped = mapToSuggestion(existing);
    if (!mapped || !isConcreteSuggestion(mapped)) return null;
    const cleanOffer = [mapped.offer, mapped.cta ? `CTA: ${mapped.cta}` : ""]
      .filter(Boolean)
      .join(" ");
    const cleanAudience = [mapped.audience, mapped.trigger ? `Trigger: ${mapped.trigger}` : ""]
      .filter(Boolean)
      .join(" ");

    const normalized =
      (await updateExperimentRecord(
        brandId,
        suggestionId,
        {
          offer: cleanOffer,
          audience: cleanAudience,
          status: "draft",
        },
        { includeSuggestions: true }
      )) ?? existing;

    const accepted = await ensureRuntimeForExperiment(normalized);
    return {
      id: accepted.id,
      brandId: accepted.brandId,
      name: accepted.name,
      offer: mapped.offer,
      audience: mapped.audience,
      cta: mapped.cta,
      trigger: mapped.trigger,
      emailPreview: mapped.emailPreview,
      successTarget: mapped.successTarget,
      rationale: mapped.rationale,
      status: "accepted",
      source: "system",
      acceptedExperimentId: accepted.id,
      createdAt: accepted.createdAt,
      updatedAt: accepted.updatedAt,
    };
  }

  return mapToSuggestion(existing);
}
