import { listOperatorMemory, upsertOperatorMemory } from "@/lib/operator-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

export type OperatorBrandMemory = {
  senderDefaults: {
    domainMode: string;
    domain: string;
    fromLocalPart: string;
    senderEmail: string;
  };
  registrantDefaults: {
    firstName: string;
    lastName: string;
    organizationName: string;
    emailAddress: string;
    phone: string;
    address1: string;
    city: string;
    stateProvince: string;
    postalCode: string;
    country: string;
  };
  recentSelection: {
    experimentId: string;
    campaignId: string;
    leadId: string;
    draftId: string;
    senderAccountId: string;
  };
};

const EMPTY_BRAND_MEMORY: OperatorBrandMemory = {
  senderDefaults: {
    domainMode: "",
    domain: "",
    fromLocalPart: "",
    senderEmail: "",
  },
  registrantDefaults: {
    firstName: "",
    lastName: "",
    organizationName: "",
    emailAddress: "",
    phone: "",
    address1: "",
    city: "",
    stateProvince: "",
    postalCode: "",
    country: "",
  },
  recentSelection: {
    experimentId: "",
    campaignId: "",
    leadId: "",
    draftId: "",
    senderAccountId: "",
  },
};

export async function getOperatorBrandMemory(brandId: string): Promise<OperatorBrandMemory> {
  const scopeId = brandId.trim();
  if (!scopeId) return EMPTY_BRAND_MEMORY;
  const rows = await listOperatorMemory({ scopeType: "brand", scopeId });
  const senderDefaults = asRecord(rows.find((row) => row.memoryKey === "sender_defaults")?.value);
  const registrantDefaults = asRecord(rows.find((row) => row.memoryKey === "registrant_defaults")?.value);
  const recentSelection = asRecord(rows.find((row) => row.memoryKey === "recent_selection")?.value);

  return {
    senderDefaults: {
      domainMode: asString(senderDefaults.domainMode),
      domain: asString(senderDefaults.domain),
      fromLocalPart: asString(senderDefaults.fromLocalPart),
      senderEmail: asString(senderDefaults.senderEmail),
    },
    registrantDefaults: {
      firstName: asString(registrantDefaults.firstName),
      lastName: asString(registrantDefaults.lastName),
      organizationName: asString(registrantDefaults.organizationName),
      emailAddress: asString(registrantDefaults.emailAddress),
      phone: asString(registrantDefaults.phone),
      address1: asString(registrantDefaults.address1),
      city: asString(registrantDefaults.city),
      stateProvince: asString(registrantDefaults.stateProvince),
      postalCode: asString(registrantDefaults.postalCode),
      country: asString(registrantDefaults.country),
    },
    recentSelection: {
      experimentId: asString(recentSelection.experimentId),
      campaignId: asString(recentSelection.campaignId),
      leadId: asString(recentSelection.leadId),
      draftId: asString(recentSelection.draftId),
      senderAccountId: asString(recentSelection.senderAccountId),
    },
  };
}

export async function rememberProvisionMailpoolSenderInput(
  brandId: string,
  input: Record<string, unknown>
) {
  const scopeId = brandId.trim();
  if (!scopeId) return;

  const fromLocalPart = asString(input.fromLocalPart);
  const domain = asString(input.domain).toLowerCase();
  const domainMode = asString(input.domainMode);
  const senderEmail = fromLocalPart && domain ? `${fromLocalPart}@${domain}` : "";
  if (fromLocalPart || domain || domainMode || senderEmail) {
    await upsertOperatorMemory({
      scopeType: "brand",
      scopeId,
      memoryKey: "sender_defaults",
      value: {
        domainMode,
        domain,
        fromLocalPart,
        senderEmail,
      },
      source: "operator",
      confidence: 0.9,
    });
  }

  const registrant = asRecord(input.registrant);
  const registrantValue = {
    firstName: asString(registrant.firstName),
    lastName: asString(registrant.lastName),
    organizationName: asString(registrant.organizationName),
    emailAddress: asString(registrant.emailAddress),
    phone: asString(registrant.phone),
    address1: asString(registrant.address1),
    city: asString(registrant.city),
    stateProvince: asString(registrant.stateProvince),
    postalCode: asString(registrant.postalCode),
    country: asString(registrant.country),
  };
  if (Object.values(registrantValue).some(Boolean)) {
    await upsertOperatorMemory({
      scopeType: "brand",
      scopeId,
      memoryKey: "registrant_defaults",
      value: registrantValue,
      source: "operator",
      confidence: 0.85,
    });
  }
}

export async function rememberOperatorRecentSelection(
  brandId: string,
  input: Partial<OperatorBrandMemory["recentSelection"]>
) {
  const scopeId = brandId.trim();
  if (!scopeId) return;
  const current = await getOperatorBrandMemory(scopeId);
  const next = {
    ...current.recentSelection,
    ...Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, asString(value)])
    ),
  };
  if (!Object.values(next).some(Boolean)) return;
  await upsertOperatorMemory({
    scopeType: "brand",
    scopeId,
    memoryKey: "recent_selection",
    value: next,
    source: "operator",
    confidence: 0.75,
  });
}
