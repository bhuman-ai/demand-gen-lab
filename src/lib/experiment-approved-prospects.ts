import type { OutreachRun } from "@/lib/factory-types";

export const ENRICHANYTHING_SELECTION_ACTOR_ID = "enrichanything_embed_selection";
export const ENRICHANYTHING_CAMPAIGN_SELECTION_ACTOR_ID = "enrichanything_live_table_campaign";

function selectedActorIdsForRun(run: Pick<OutreachRun, "sourcingTraceSummary"> | null | undefined) {
  return Array.isArray(run?.sourcingTraceSummary?.selectedActorIds)
    ? run.sourcingTraceSummary.selectedActorIds
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    : [];
}

export function approvedProspectActorIdsForOwnerType(ownerType: OutreachRun["ownerType"]) {
  return ownerType === "campaign"
    ? [ENRICHANYTHING_CAMPAIGN_SELECTION_ACTOR_ID]
    : [ENRICHANYTHING_SELECTION_ACTOR_ID];
}

export function isApprovedOwnerProspectRun(
  ownerType: OutreachRun["ownerType"],
  run: Pick<OutreachRun, "sourcingTraceSummary"> | null | undefined
) {
  const selectedActorIds = selectedActorIdsForRun(run);
  return approvedProspectActorIdsForOwnerType(ownerType).some((actorId) =>
    selectedActorIds.includes(actorId)
  );
}

export function isApprovedExperimentProspectRun(
  run: Pick<OutreachRun, "sourcingTraceSummary"> | null | undefined
) {
  return isApprovedOwnerProspectRun("experiment", run);
}

export function isApprovedCampaignProspectRun(
  run: Pick<OutreachRun, "sourcingTraceSummary"> | null | undefined
) {
  return isApprovedOwnerProspectRun("campaign", run);
}
