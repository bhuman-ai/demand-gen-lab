import { createId, getBrandById, updateBrand } from "@/lib/factory-data";
import type {
  BrandOutreachAssignment,
  BrandRecord,
  DomainRow,
  OutreachAccount,
} from "@/lib/factory-types";
import {
  createOutreachAccount,
  getBrandOutreachAssignment,
  getOutreachAccount,
  listOutreachAccounts,
  setBrandOutreachAssignment,
  updateOutreachAccount,
  type OutreachAccountSecrets,
} from "@/lib/outreach-data";
import {
  getOutreachProvisioningSettings,
  getOutreachProvisioningSettingsSecrets,
} from "@/lib/outreach-provider-settings";
import { testOutreachProviders } from "@/lib/outreach-providers";

type NamecheapHostRecord = {
  type: "A" | "AAAA" | "ALIAS" | "CNAME" | "FRAME" | "MX" | "MXE" | "NS" | "TXT" | "URL" | "URL301";
  name: string;
  value: string;
  ttl: number;
  mxPref: number;
};

type DnsRecord = {
  type: "CNAME" | "MX" | "TXT";
  name: string;
  value: string;
  ttl?: number;
  mxPref?: number;
};

type CustomerIoSenderIdentityStatus = "existing" | "created" | "manual_required" | "error";

export type ProvisionSenderInput = {
  brandId: string;
  accountName: string;
  assignToBrand?: boolean;
  selectedMailboxAccountId?: string;
  domainMode: "existing" | "register";
  domain: string;
  fromLocalPart: string;
  customerIoSiteId: string;
  customerIoTrackingApiKey: string;
  customerIoAppApiKey?: string;
  namecheapApiUser: string;
  namecheapUserName?: string;
  namecheapApiKey: string;
  namecheapClientIp: string;
  registrant?: {
    firstName: string;
    lastName: string;
    organizationName?: string;
    emailAddress: string;
    phone: string;
    address1: string;
    city: string;
    stateProvince: string;
    postalCode: string;
    country: string;
  };
};

export type ProvisionSenderResult = {
  ok: boolean;
  readyToSend: boolean;
  domain: string;
  fromEmail: string;
  brand: BrandRecord;
  account: OutreachAccount;
  assignment: BrandOutreachAssignment | null;
  namecheap: {
    mode: "existing" | "register";
    domainStatus: "existing" | "registered";
    existingRecordCount: number;
    appliedRecordCount: number;
  };
  customerIo: {
    senderIdentityStatus: CustomerIoSenderIdentityStatus;
    dnsRecordCount: number;
  };
  warnings: string[];
  nextSteps: string[];
};

export type ProvisioningProviderTestResult = {
  provider: "customerio" | "namecheap";
  ok: boolean;
  message: string;
  details: Record<string, unknown>;
};

const NAMECHEAP_BASE_URL = "https://api.namecheap.com/xml.response";
const CUSTOMER_IO_API_BASE_URL = "https://api.customer.io/v1";
const CUSTOMER_IO_EU_API_BASE_URL = "https://api-eu.customer.io/v1";
const DEFAULT_NAMECHEAP_TTL = 1800;

function nowIso() {
  return new Date().toISOString();
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function normalizeEmailLocalPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, "")
    .replace(/^\.+|\.+$/g, "");
}

function splitDomain(domain: string) {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("Domain must include a TLD");
  }
  return {
    sld: parts[0],
    tld: parts.slice(1).join("."),
  };
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlResponseStatus(xml: string) {
  const match = xml.match(/<ApiResponse\b[^>]*Status="([^"]+)"/i);
  return String(match?.[1] ?? "").trim().toUpperCase();
}

function xmlErrors(xml: string) {
  return [...xml.matchAll(/<Error\b[^>]*Number="([^"]*)"[^>]*>([\s\S]*?)<\/Error>/gi)].map((match) =>
    `${match[1] ? `#${match[1]} ` : ""}${decodeXmlEntities(String(match[2] ?? "")).trim()}`
  );
}

function parseXmlAttributes(blob: string) {
  const out: Record<string, string> = {};
  for (const match of blob.matchAll(/([A-Za-z0-9_:-]+)="([^"]*)"/g)) {
    out[match[1]] = decodeXmlEntities(match[2]);
  }
  return out;
}

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function namecheapRequest(command: string, params: Record<string, string>) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${NAMECHEAP_BASE_URL}?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  const xml = await response.text();
  const status = xmlResponseStatus(xml);
  const errors = xmlErrors(xml);
  if (!response.ok || status !== "OK") {
    throw new Error(
      errors.join(" · ") || `Namecheap ${command} failed (${response.status || "unknown status"})`
    );
  }
  return xml;
}

function namecheapBaseParams(input: {
  apiUser: string;
  userName?: string;
  apiKey: string;
  clientIp: string;
  command: string;
}) {
  return {
    ApiUser: input.apiUser.trim(),
    ApiKey: input.apiKey.trim(),
    UserName: (input.userName || input.apiUser).trim(),
    ClientIp: input.clientIp.trim(),
    Command: input.command,
  };
}

async function namecheapGetHosts(input: {
  apiUser: string;
  userName?: string;
  apiKey: string;
  clientIp: string;
  domain: string;
}) {
  const { sld, tld } = splitDomain(input.domain);
  const xml = await namecheapRequest(
    "namecheap.domains.dns.getHosts",
    {
      ...namecheapBaseParams({
        apiUser: input.apiUser,
        userName: input.userName,
        apiKey: input.apiKey,
        clientIp: input.clientIp,
        command: "namecheap.domains.dns.getHosts",
      }),
      SLD: sld,
      TLD: tld,
    }
  );

  const hosts = [...xml.matchAll(/<host\b([^>]+?)\/>/gi)].map((match) => {
    const attrs = parseXmlAttributes(match[1]);
    return {
      type: (String(attrs.Type ?? "TXT").toUpperCase() as NamecheapHostRecord["type"]),
      name: String(attrs.Name ?? "@").trim(),
      value: String(attrs.Address ?? "").trim(),
      ttl: toNumber(String(attrs.TTL ?? ""), DEFAULT_NAMECHEAP_TTL),
      mxPref: toNumber(String(attrs.MXPref ?? ""), 10),
    } satisfies NamecheapHostRecord;
  });

  return hosts;
}

async function namecheapRegisterDomain(input: {
  apiUser: string;
  userName?: string;
  apiKey: string;
  clientIp: string;
  domain: string;
  registrant: NonNullable<ProvisionSenderInput["registrant"]>;
}) {
  const { sld, tld } = splitDomain(input.domain);
  const contact = {
    FirstName: input.registrant.firstName.trim(),
    LastName: input.registrant.lastName.trim(),
    OrganizationName: String(input.registrant.organizationName ?? "").trim(),
    Address1: input.registrant.address1.trim(),
    City: input.registrant.city.trim(),
    StateProvince: input.registrant.stateProvince.trim(),
    PostalCode: input.registrant.postalCode.trim(),
    Country: input.registrant.country.trim().toUpperCase(),
    Phone: input.registrant.phone.trim(),
    EmailAddress: input.registrant.emailAddress.trim(),
  };

  const params: Record<string, string> = {
    ...namecheapBaseParams({
      apiUser: input.apiUser,
      userName: input.userName,
      apiKey: input.apiKey,
      clientIp: input.clientIp,
      command: "namecheap.domains.create",
    }),
    DomainName: input.domain,
    Years: "1",
    AddFreeWhoisguard: "yes",
    WGEnabled: "yes",
    SLD: sld,
    TLD: tld,
  };

  for (const prefix of ["Registrant", "Tech", "Admin", "AuxBilling"]) {
    for (const [key, value] of Object.entries(contact)) {
      params[`${prefix}${key}`] = value;
    }
  }

  await namecheapRequest("namecheap.domains.create", params);
}

function normalizeHostLabelForNamecheap(domain: string, rawName: string) {
  const normalizedDomain = normalizeDomain(domain);
  const name = rawName.trim().replace(/\.$/, "").toLowerCase();
  if (!name || name === normalizedDomain) return "@";
  if (name === "@") return "@";
  if (name.endsWith(`.${normalizedDomain}`)) {
    const relative = name.slice(0, -(normalizedDomain.length + 1)).trim();
    return relative || "@";
  }
  return name;
}

function normalizeAddressValue(value: string) {
  return value.trim().replace(/\.$/, "");
}

function recordSignature(record: NamecheapHostRecord) {
  return `${record.type}:${record.name}:${record.value}:${record.mxPref}`;
}

function isSpfTxt(record: NamecheapHostRecord | DnsRecord) {
  return record.type === "TXT" && /\bv=spf1\b/i.test(record.value);
}

function isDmarcTxt(record: NamecheapHostRecord | DnsRecord) {
  return record.type === "TXT" && record.name.trim().toLowerCase() === "_dmarc";
}

function mergeNamecheapHosts(existing: NamecheapHostRecord[], desired: DnsRecord[], domain: string) {
  let merged = [...existing];
  for (const desiredRecord of desired) {
    const normalized: NamecheapHostRecord = {
      type: desiredRecord.type,
      name: normalizeHostLabelForNamecheap(domain, desiredRecord.name),
      value: normalizeAddressValue(desiredRecord.value),
      ttl: toNumber(String(desiredRecord.ttl ?? DEFAULT_NAMECHEAP_TTL), DEFAULT_NAMECHEAP_TTL),
      mxPref: toNumber(String(desiredRecord.mxPref ?? 10), 10),
    };

    if (normalized.type === "CNAME") {
      merged = merged.filter(
        (item) => !(item.type === "CNAME" && item.name.toLowerCase() === normalized.name.toLowerCase())
      );
      merged.push(normalized);
      continue;
    }

    if (isDmarcTxt(normalized)) {
      merged = merged.filter((item) => !(item.type === "TXT" && isDmarcTxt(item)));
      merged.push(normalized);
      continue;
    }

    if (isSpfTxt(normalized)) {
      merged = merged.filter(
        (item) =>
          !(
            item.type === "TXT" &&
            item.name.toLowerCase() === normalized.name.toLowerCase() &&
            isSpfTxt(item)
          )
      );
      merged.push(normalized);
      continue;
    }

    if (normalized.type === "MX") {
      const alreadyExists = merged.some((item) => recordSignature(item) === recordSignature(normalized));
      if (!alreadyExists) merged.push(normalized);
      continue;
    }

    const alreadyExists = merged.some((item) => recordSignature(item) === recordSignature(normalized));
    if (!alreadyExists) merged.push(normalized);
  }

  return merged;
}

async function namecheapSetHosts(input: {
  apiUser: string;
  userName?: string;
  apiKey: string;
  clientIp: string;
  domain: string;
  hosts: NamecheapHostRecord[];
}) {
  const { sld, tld } = splitDomain(input.domain);
  const params: Record<string, string> = {
    ...namecheapBaseParams({
      apiUser: input.apiUser,
      userName: input.userName,
      apiKey: input.apiKey,
      clientIp: input.clientIp,
      command: "namecheap.domains.dns.setHosts",
    }),
    SLD: sld,
    TLD: tld,
  };

  input.hosts.forEach((record, index) => {
    const slot = String(index + 1);
    params[`HostName${slot}`] = record.name || "@";
    params[`RecordType${slot}`] = record.type;
    params[`Address${slot}`] = record.value;
    params[`MXPref${slot}`] = String(record.mxPref || 10);
    params[`TTL${slot}`] = String(record.ttl || DEFAULT_NAMECHEAP_TTL);
  });

  await namecheapRequest("namecheap.domains.dns.setHosts", params);
}

export async function testNamecheapProvisioningConnection(input: {
  apiUser: string;
  userName?: string;
  apiKey: string;
  clientIp: string;
}): Promise<ProvisioningProviderTestResult> {
  await namecheapRequest("namecheap.domains.getList", {
    ...namecheapBaseParams({
      apiUser: input.apiUser,
      userName: input.userName,
      apiKey: input.apiKey,
      clientIp: input.clientIp,
      command: "namecheap.domains.getList",
    }),
    Page: "1",
    PageSize: "1",
    SortBy: "NAME",
  });

  return {
    provider: "namecheap",
    ok: true,
    message: "Namecheap API credentials are working.",
    details: {
      apiUser: input.apiUser.trim(),
      clientIp: input.clientIp.trim(),
    },
  };
}

function customerIoTrackHeaders(siteId: string, trackingApiKey: string) {
  return {
    Authorization: `Basic ${Buffer.from(`${siteId.trim()}:${trackingApiKey.trim()}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

function customerIoAppHeaders(appApiKey: string) {
  return {
    Authorization: `Bearer ${appApiKey.trim()}`,
    "Content-Type": "application/json",
  };
}

async function detectCustomerIoRegion(input: { siteId: string; trackingApiKey: string }) {
  const response = await fetch("https://track.customer.io/api/v1/accounts/region", {
    method: "GET",
    headers: customerIoTrackHeaders(input.siteId, input.trackingApiKey),
    cache: "no-store",
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Customer.io region lookup failed (HTTP ${response.status}): ${raw.slice(0, 200)}`);
  }
  const payload: unknown = raw ? JSON.parse(raw) : {};
  const row = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const region = String(row.region ?? "").trim().toLowerCase();
  return region === "eu" ? "eu" : "us";
}

function customerIoAppBaseUrls(region: "eu" | "us") {
  return region === "eu"
    ? [CUSTOMER_IO_EU_API_BASE_URL, CUSTOMER_IO_API_BASE_URL]
    : [CUSTOMER_IO_API_BASE_URL, CUSTOMER_IO_EU_API_BASE_URL];
}

export async function testCustomerIoProvisioningConnection(input: {
  siteId: string;
  trackingApiKey: string;
  appApiKey?: string;
}): Promise<ProvisioningProviderTestResult> {
  const region = await detectCustomerIoRegion({
    siteId: input.siteId,
    trackingApiKey: input.trackingApiKey,
  });
  const details: Record<string, unknown> = {
    siteId: input.siteId.trim(),
    region,
  };

  if (!input.appApiKey?.trim()) {
    return {
      provider: "customerio",
      ok: true,
      message: "Customer.io tracking credentials are working. App API key is not saved yet.",
      details,
    };
  }

  const resolvedAppConnection = await resolveCustomerIoAppConnection({
    region,
    appApiKey: input.appApiKey,
  });

  return {
    provider: "customerio",
    ok: true,
    message: "Customer.io tracking and App API credentials are working.",
    details: {
      ...details,
      appBaseUrl: resolvedAppConnection.baseUrl,
      senderIdentityCount: resolvedAppConnection.listed.identities.length,
    },
  };
}

function collectRecordsFromUnknown(value: unknown, sink: DnsRecord[], seen: Set<string>) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectRecordsFromUnknown(item, sink, seen);
    return;
  }
  if (typeof value !== "object") return;

  const row = value as Record<string, unknown>;
  const type = String(
    row.type ??
      row.recordType ??
      row.record_type ??
      row.dnsType ??
      row.dns_type ??
      ""
  )
    .trim()
    .toUpperCase();
  const name = String(
    row.name ?? row.host ?? row.hostname ?? row.hostName ?? row.host_name ?? row.key ?? ""
  ).trim();
  const valueText = String(
    row.value ??
      row.content ??
      row.address ??
      row.target ??
      row.pointsTo ??
      row.points_to ??
      row.answer ??
      ""
  ).trim();

  if ((type === "TXT" || type === "CNAME" || type === "MX") && name && valueText) {
    const normalized: DnsRecord = {
      type,
      name,
      value: valueText.replace(/^"(.*)"$/, "$1"),
      ttl: toNumber(String(row.ttl ?? row.TTL ?? ""), DEFAULT_NAMECHEAP_TTL),
      mxPref: toNumber(String(row.mxPref ?? row.mx_pref ?? row.preference ?? ""), 10),
    };
    const signature = `${normalized.type}:${normalized.name}:${normalized.value}:${normalized.mxPref ?? 10}`;
    if (!seen.has(signature)) {
      seen.add(signature);
      sink.push(normalized);
    }
  }

  for (const nested of Object.values(row)) {
    if (nested && typeof nested === "object") {
      collectRecordsFromUnknown(nested, sink, seen);
    }
  }
}

function extractDnsRecords(value: unknown) {
  const records: DnsRecord[] = [];
  collectRecordsFromUnknown(value, records, new Set());
  return records;
}

function collectSenderIdentities(value: unknown, sink: Array<Record<string, unknown>>) {
  if (Array.isArray(value)) {
    for (const item of value) collectSenderIdentities(item, sink);
    return;
  }
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  const email = String(row.email ?? row.from_email ?? row.fromEmail ?? "").trim().toLowerCase();
  const domain = String(row.domain ?? row.sending_domain ?? row.sendingDomain ?? "").trim().toLowerCase();
  if (email || domain) {
    sink.push(row);
  }
  for (const nested of Object.values(row)) {
    if (nested && typeof nested === "object") {
      collectSenderIdentities(nested, sink);
    }
  }
}

async function listCustomerIoSenderIdentities(input: { baseUrl: string; appApiKey: string }) {
  const response = await fetch(`${input.baseUrl}/sender_identities`, {
    method: "GET",
    headers: customerIoAppHeaders(input.appApiKey),
    cache: "no-store",
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Customer.io sender identity lookup failed (HTTP ${response.status}): ${raw.slice(0, 300)}`);
  }
  const payload: unknown = raw ? JSON.parse(raw) : {};
  const identities: Array<Record<string, unknown>> = [];
  collectSenderIdentities(payload, identities);
  return { payload, identities };
}

async function resolveCustomerIoAppConnection(input: { region: "eu" | "us"; appApiKey: string }) {
  let lastError: unknown = null;
  for (const baseUrl of customerIoAppBaseUrls(input.region)) {
    try {
      const listed = await listCustomerIoSenderIdentities({
        baseUrl,
        appApiKey: input.appApiKey,
      });
      return {
        baseUrl,
        listed,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Customer.io sender identity lookup failed");
}

function matchingSenderIdentity(
  identities: Array<Record<string, unknown>>,
  fromEmail: string,
  domain: string
) {
  const normalizedEmail = fromEmail.trim().toLowerCase();
  const normalizedDomain = normalizeDomain(domain);
  return (
    identities.find((identity) => {
      const email = String(identity.email ?? identity.from_email ?? identity.fromEmail ?? "")
        .trim()
        .toLowerCase();
      const senderDomain = String(identity.domain ?? identity.sending_domain ?? identity.sendingDomain ?? "")
        .trim()
        .toLowerCase();
      return email === normalizedEmail || senderDomain === normalizedDomain;
    }) ?? null
  );
}

async function createCustomerIoSenderIdentity(input: {
  baseUrl: string;
  appApiKey: string;
  fromEmail: string;
  senderName: string;
}) {
  const attempts = [
    { email: input.fromEmail, name: input.senderName },
    { sender_identity: { email: input.fromEmail, name: input.senderName } },
    { from_email: input.fromEmail, name: input.senderName },
    { senderIdentity: { email: input.fromEmail, name: input.senderName } },
  ];

  let lastError = "";
  for (const body of attempts) {
    const response = await fetch(`${input.baseUrl}/sender_identities`, {
      method: "POST",
      headers: customerIoAppHeaders(input.appApiKey),
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const raw = await response.text();
    if (response.ok) {
      return raw ? JSON.parse(raw) : {};
    }
    lastError = `HTTP ${response.status}: ${raw.slice(0, 300)}`;
    if (response.status === 401 || response.status === 403) {
      break;
    }
  }

  throw new Error(`Customer.io sender identity create failed (${lastError || "unknown error"})`);
}

async function bootstrapCustomerIoSender(input: {
  siteId: string;
  trackingApiKey: string;
  appApiKey?: string;
  fromEmail: string;
  senderName: string;
  domain: string;
}) {
  if (!input.appApiKey?.trim()) {
    return {
      status: "manual_required" as const,
      dnsRecords: [] as DnsRecord[],
      warnings: ["Customer.io App API key missing, so sender identity bootstrap was skipped."],
    };
  }

  try {
    const region = await detectCustomerIoRegion({
      siteId: input.siteId,
      trackingApiKey: input.trackingApiKey,
    });
    const resolvedAppConnection = await resolveCustomerIoAppConnection({
      region,
      appApiKey: input.appApiKey,
    });
    const existing = matchingSenderIdentity(
      resolvedAppConnection.listed.identities,
      input.fromEmail,
      input.domain
    );
    if (existing) {
      return {
        status: "existing" as const,
        dnsRecords:
          extractDnsRecords(existing).length
            ? extractDnsRecords(existing)
            : extractDnsRecords(resolvedAppConnection.listed.payload),
        warnings: [] as string[],
      };
    }

    const created = await createCustomerIoSenderIdentity({
      baseUrl: resolvedAppConnection.baseUrl,
      appApiKey: input.appApiKey,
      fromEmail: input.fromEmail,
      senderName: input.senderName,
    });
    const dnsRecords = extractDnsRecords(created);
    if (!dnsRecords.length) {
      return {
        status: "manual_required" as const,
        dnsRecords,
        warnings: [
          "Customer.io sender identity was created, but the API response did not include DNS records we could apply automatically.",
        ],
      };
    }
    return {
      status: "created" as const,
      dnsRecords,
      warnings: [] as string[],
    };
  } catch (error) {
    return {
      status: "error" as const,
      dnsRecords: [] as DnsRecord[],
      warnings: [error instanceof Error ? error.message : "Customer.io sender identity bootstrap failed"],
    };
  }
}

async function ensureCustomerIoDeliveryAccount(input: {
  accountName: string;
  siteId: string;
  trackingApiKey: string;
  appApiKey?: string;
  fromEmail: string;
  replyToEmail: string;
}) {
  const allAccounts = await listOutreachAccounts();
  const existing =
    allAccounts.find(
      (account) =>
        account.accountType !== "mailbox" &&
        account.config.customerIo.siteId.trim() === input.siteId.trim() &&
        account.config.customerIo.fromEmail.trim().toLowerCase() === input.fromEmail.trim().toLowerCase()
    ) ?? null;

  const payload = {
    name: input.accountName.trim(),
    accountType: "delivery" as const,
    status: "active" as const,
    config: {
      customerIo: {
        siteId: input.siteId.trim(),
        workspaceId: "",
        fromEmail: input.fromEmail.trim(),
        replyToEmail: input.replyToEmail.trim(),
      },
      apify: {
        defaultActorId: "",
      },
      mailbox: {
        provider: "imap",
        email: "",
        host: "",
        port: 993,
        secure: true,
        status: "disconnected",
      },
    },
    credentials: {
      customerIoApiKey: input.trackingApiKey.trim(),
      customerIoTrackApiKey: input.trackingApiKey.trim(),
      customerIoAppApiKey: String(input.appApiKey ?? "").trim(),
    } satisfies Partial<OutreachAccountSecrets>,
  };

  if (existing) {
    const updated = await updateOutreachAccount(existing.id, payload);
    return updated ?? existing;
  }

  return createOutreachAccount(payload);
}

function updateBrandDomainRow(input: {
  brand: BrandRecord;
  domain: string;
  fromEmail: string;
  replyMailboxEmail: string;
  dnsStatus: DomainRow["dnsStatus"];
  notes: string;
}) {
  const now = nowIso();
  const existingIndex = input.brand.domains.findIndex(
    (row) => normalizeDomain(row.domain) === normalizeDomain(input.domain)
  );
  const row: DomainRow = {
    id: existingIndex >= 0 ? input.brand.domains[existingIndex].id : createId("domain"),
    domain: input.domain,
    status: "warming",
    warmupStage: input.dnsStatus === "verified" ? "Day 1 · ready" : "Day 1 · provisioning",
    reputation: "new",
    registrar: "namecheap",
    provider: "customerio",
    dnsStatus: input.dnsStatus,
    fromEmail: input.fromEmail,
    replyMailboxEmail: input.replyMailboxEmail,
    notes: input.notes,
    lastProvisionedAt: now,
  };

  const nextDomains = [...input.brand.domains];
  if (existingIndex >= 0) {
    nextDomains[existingIndex] = {
      ...nextDomains[existingIndex],
      ...row,
    };
  } else {
    nextDomains.unshift(row);
  }
  return nextDomains;
}

async function resolveProvisioningCredentials(input: ProvisionSenderInput) {
  const [savedSettings, savedSecrets] = await Promise.all([
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
  ]);

  const customerIoSiteId = input.customerIoSiteId.trim() || savedSettings.customerIo.siteId.trim();
  const customerIoTrackingApiKey =
    input.customerIoTrackingApiKey.trim() || savedSecrets.customerIoTrackingApiKey.trim();
  const customerIoAppApiKey = String(input.customerIoAppApiKey ?? "").trim() || savedSecrets.customerIoAppApiKey.trim();
  const namecheapApiUser = input.namecheapApiUser.trim() || savedSettings.namecheap.apiUser.trim();
  const namecheapUserName =
    input.namecheapUserName?.trim() || savedSettings.namecheap.userName.trim() || namecheapApiUser;
  const namecheapApiKey = input.namecheapApiKey.trim() || savedSecrets.namecheapApiKey.trim();
  const namecheapClientIp = input.namecheapClientIp.trim() || savedSettings.namecheap.clientIp.trim();

  if (!customerIoSiteId) {
    throw new Error("Customer.io Site ID is required. Save provider defaults in outreach settings or enter it here.");
  }
  if (!customerIoTrackingApiKey) {
    throw new Error(
      "Customer.io Tracking API key is required. Save provider defaults in outreach settings or enter it here."
    );
  }
  if (!namecheapApiUser) {
    throw new Error("Namecheap API user is required. Save provider defaults in outreach settings or enter it here.");
  }
  if (!namecheapApiKey) {
    throw new Error("Namecheap API key is required. Save provider defaults in outreach settings or enter it here.");
  }
  if (!namecheapClientIp) {
    throw new Error("Namecheap client IP is required. Save provider defaults in outreach settings or enter it here.");
  }

  return {
    customerIoSiteId,
    customerIoTrackingApiKey,
    customerIoAppApiKey,
    namecheapApiUser,
    namecheapUserName,
    namecheapApiKey,
    namecheapClientIp,
  };
}

export async function provisionCustomerIoSender(
  input: ProvisionSenderInput
): Promise<ProvisionSenderResult> {
  const brand = await getBrandById(input.brandId);
  if (!brand) {
    throw new Error("Brand not found");
  }

  const domain = normalizeDomain(input.domain);
  if (!domain || !domain.includes(".")) {
    throw new Error("A valid domain is required");
  }

  const fromLocalPart = normalizeEmailLocalPart(input.fromLocalPart);
  if (!fromLocalPart) {
    throw new Error("Sender local-part is required");
  }
  const fromEmail = `${fromLocalPart}@${domain}`;
  const resolvedCredentials = await resolveProvisioningCredentials(input);

  const mailboxSelection =
    input.selectedMailboxAccountId?.trim() || (await getBrandOutreachAssignment(brand.id))?.mailboxAccountId || "";
  const mailboxAccount = mailboxSelection ? await getOutreachAccount(mailboxSelection) : null;
  const replyMailboxEmail = mailboxAccount?.config.mailbox.email.trim() || "";

  const connectivityAccount: OutreachAccount = {
    id: "provision_check",
    name: input.accountName.trim() || `Customer.io ${domain}`,
    provider: "customerio",
    accountType: "delivery",
    status: "active",
    config: {
      customerIo: {
        siteId: resolvedCredentials.customerIoSiteId,
        workspaceId: "",
        fromEmail,
        replyToEmail: replyMailboxEmail,
      },
      apify: {
        defaultActorId: "",
      },
      mailbox: {
        provider: "imap",
        email: "",
        status: "disconnected",
        host: "",
        port: 993,
        secure: true,
      },
    },
    hasCredentials: true,
    lastTestAt: "",
    lastTestStatus: "unknown",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const connectivityCheck = await testOutreachProviders(
    connectivityAccount,
    {
      customerIoApiKey: resolvedCredentials.customerIoTrackingApiKey,
      customerIoTrackApiKey: resolvedCredentials.customerIoTrackingApiKey,
      customerIoAppApiKey: resolvedCredentials.customerIoAppApiKey,
      apifyToken: "",
      mailboxAccessToken: "",
      mailboxRefreshToken: "",
      mailboxPassword: "",
    },
    "customerio"
  );
  if (!connectivityCheck.ok) {
    throw new Error(connectivityCheck.message || "Customer.io connectivity test failed");
  }

  if (input.domainMode === "register") {
    if (!input.registrant) {
      throw new Error("Registrant contact information is required to buy a new domain");
    }
    await namecheapRegisterDomain({
      apiUser: resolvedCredentials.namecheapApiUser,
      userName: resolvedCredentials.namecheapUserName,
      apiKey: resolvedCredentials.namecheapApiKey,
      clientIp: resolvedCredentials.namecheapClientIp,
      domain,
      registrant: input.registrant,
    });
  }

  const existingHosts = await namecheapGetHosts({
    apiUser: resolvedCredentials.namecheapApiUser,
    userName: resolvedCredentials.namecheapUserName,
    apiKey: resolvedCredentials.namecheapApiKey,
    clientIp: resolvedCredentials.namecheapClientIp,
    domain,
  });

  const senderBootstrap = await bootstrapCustomerIoSender({
    siteId: resolvedCredentials.customerIoSiteId,
    trackingApiKey: resolvedCredentials.customerIoTrackingApiKey,
    appApiKey: resolvedCredentials.customerIoAppApiKey,
    fromEmail,
    senderName: brand.name || input.accountName || domain,
    domain,
  });

  const desiredDnsRecords = senderBootstrap.dnsRecords;
  if (desiredDnsRecords.length) {
    const nextHosts = mergeNamecheapHosts(existingHosts, desiredDnsRecords, domain);
    await namecheapSetHosts({
      apiUser: resolvedCredentials.namecheapApiUser,
      userName: resolvedCredentials.namecheapUserName,
      apiKey: resolvedCredentials.namecheapApiKey,
      clientIp: resolvedCredentials.namecheapClientIp,
      domain,
      hosts: nextHosts,
    });
  }

  const account = await ensureCustomerIoDeliveryAccount({
    accountName: input.accountName.trim() || `${brand.name} ${domain}`,
    siteId: resolvedCredentials.customerIoSiteId,
    trackingApiKey: resolvedCredentials.customerIoTrackingApiKey,
    appApiKey: resolvedCredentials.customerIoAppApiKey,
    fromEmail,
    replyToEmail: replyMailboxEmail,
  });

  const assignment =
    input.assignToBrand === false
      ? null
      : await setBrandOutreachAssignment(brand.id, {
          accountId: account.id,
          mailboxAccountId: mailboxSelection,
        });

  const warnings = [...senderBootstrap.warnings];
  const dnsStatus: DomainRow["dnsStatus"] = desiredDnsRecords.length
    ? senderBootstrap.status === "error"
      ? "error"
      : "configured"
    : senderBootstrap.status === "error"
      ? "error"
      : "pending";

  if (!replyMailboxEmail) {
    warnings.push("No reply mailbox is assigned to this brand yet. Sending will still fail preflight until you assign one.");
  }
  if (!desiredDnsRecords.length) {
    warnings.push("No Customer.io DNS records were applied automatically. Verify the sender identity in Customer.io before sending.");
  }

  const updatedBrand = await updateBrand(brand.id, {
    domains: updateBrandDomainRow({
      brand,
      domain,
      fromEmail,
      replyMailboxEmail,
      dnsStatus,
      notes:
        desiredDnsRecords.length > 0
          ? "Provisioned through outreach settings."
          : "Provisioned partially. Customer.io sender verification still needs attention.",
    }),
  });

  const nextSteps: string[] = [];
  if (!desiredDnsRecords.length) {
    nextSteps.push("Open Customer.io sender identities and finish verification for this domain.");
  }
  if (!replyMailboxEmail) {
    nextSteps.push("Assign a reply mailbox to the brand before launching outreach.");
  }
  nextSteps.push("Run a Customer.io account test again after DNS propagates.");

  return {
    ok: true,
    readyToSend: Boolean(replyMailboxEmail && desiredDnsRecords.length && senderBootstrap.status !== "error"),
    domain,
    fromEmail,
    brand: updatedBrand ?? brand,
    account,
    assignment,
    namecheap: {
      mode: input.domainMode,
      domainStatus: input.domainMode === "register" ? "registered" : "existing",
      existingRecordCount: existingHosts.length,
      appliedRecordCount: desiredDnsRecords.length,
    },
    customerIo: {
      senderIdentityStatus: senderBootstrap.status,
      dnsRecordCount: desiredDnsRecords.length,
    },
    warnings,
    nextSteps,
  };
}
