import { createId, getBrandById, updateBrand } from "@/lib/factory-data";
import type {
  BrandOutreachAssignment,
  BrandRecord,
  DomainRow,
  MailpoolInboxPlacementProvider,
  OutreachAccount,
  OutreachProvider,
} from "@/lib/factory-types";
import {
  DEFAULT_MAILPOOL_INBOX_PROVIDERS,
  getOutreachMailboxEmail,
  getOutreachAccountFromEmail,
  getOutreachSenderBackingIssue,
  supportsMailpoolDelivery,
} from "@/lib/outreach-account-helpers";
import {
  buildCustomerIoCapacityPools,
  findBestCustomerIoCapacityPool,
  type CustomerIoCapacityPool,
} from "@/lib/outreach-customerio-capacity";
import {
  createOutreachAccount,
  getBrandOutreachAssignment,
  getOutreachAccount,
  getOutreachAccountSecrets,
  listOutreachAccounts,
  setBrandOutreachAssignment,
  updateOutreachAccount,
  type OutreachAccountSecrets,
} from "@/lib/outreach-data";
import {
  getOutreachProvisioningSettings,
  getOutreachProvisioningSettingsSecrets,
  updateOutreachProvisioningSettings,
} from "@/lib/outreach-provider-settings";
import {
  createMailpoolInboxPlacement,
  createMailpoolMailbox,
  createMailpoolSpamCheck,
  getMailpoolDomainInfo,
  getMailpoolInboxPlacement,
  getMailpoolSubscriptionSlots,
  getMailpoolSpamCheck,
  listMailpoolDomains,
  listMailpoolDomainSuggestions,
  listMailpoolMailboxes,
  registerMailpoolDomain,
  runMailpoolInboxPlacement,
  testMailpoolConnection,
  updateMailpoolSubscriptionSlots,
  type MailpoolDomain,
  type MailpoolDomainOwner,
  type MailpoolInboxPlacement,
  type MailpoolMailbox,
  type MailpoolSpamCheck,
  type MailpoolSubscriptionSlots,
} from "@/lib/mailpool-client";
import { sanitizeCustomerIoBillingConfig } from "@/lib/outreach-customerio-billing";
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
  provider?: OutreachProvider;
  accountName: string;
  assignToBrand?: boolean;
  selectedMailboxAccountId?: string;
  domainMode: "existing" | "register";
  domain: string;
  fromLocalPart: string;
  autoPickCustomerIoAccount?: boolean;
  customerIoSourceAccountId?: string;
  forwardingTargetUrl?: string;
  customerIoSiteId: string;
  customerIoTrackingApiKey: string;
  customerIoAppApiKey?: string;
  mailpoolApiKey?: string;
  domainCandidates?: string[];
  allowAlternativeDomains?: boolean;
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
  provider: OutreachProvider;
  readyToSend: boolean;
  domain: string;
  fromEmail: string;
  brand: BrandRecord;
  account: OutreachAccount;
  assignment: BrandOutreachAssignment | null;
  namecheap?: {
    mode: "existing" | "register";
    domainStatus: "existing" | "registered";
    existingRecordCount: number;
    appliedRecordCount: number;
    forwardingEnabled: boolean;
    forwardingTargetUrl: string;
  };
  customerIo?: {
    senderIdentityStatus: CustomerIoSenderIdentityStatus;
    dnsRecordCount: number;
    sourceAccountId: string;
    sourceAccountName: string;
  };
  mailpool?: {
    domainId: string;
    domainStatus: string;
    mailboxId: string;
    mailboxStatus: string;
    spamCheckId: string;
    spamCheckStatus: string;
    inboxPlacementId: string;
    inboxPlacementStatus: string;
  };
  warnings: string[];
  nextSteps: string[];
};

export type MailpoolDomainSelection = {
  domain: string;
  available: boolean;
  price: number;
  source: "requested" | "candidate" | "suggestion";
  checkedDomains: string[];
  suggestions: string[];
};

export type NamecheapDomainInventoryItem = {
  domain: string;
  createdAt: string;
  expiresAt: string;
  isExpired: boolean;
  autoRenew: boolean;
  isOurDns: boolean;
  whoisGuardEnabled: boolean;
};

export type NamecheapDomainAvailabilityItem = {
  domain: string;
  available: boolean;
  premium: boolean;
  premiumRegistrationPrice: number;
  description: string;
};

export type ProvisioningProviderTestResult = {
  provider: "customerio" | "namecheap" | "mailpool" | "deliverability";
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

function looksLikeNamecheapIpAllowlistError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("whitelist") ||
    normalized.includes("allowlist") ||
    normalized.includes("request ip") ||
    normalized.includes("clientip") ||
    (normalized.includes("ip") && normalized.includes("allow")) ||
    (normalized.includes("ip") && normalized.includes("valid"))
  );
}

function withNamecheapIpHint(message: string) {
  if (!looksLikeNamecheapIpAllowlistError(message)) {
    return message;
  }
  return `${message} Use the stable public IPv4 of the server making the request. If this app runs on Vercel, default outbound IPs change; use Vercel Static IPs or route Namecheap through a relay with a fixed IPv4.`;
}

function resolveNamecheapRelayUrl() {
  return String(process.env.NAMECHEAP_RELAY_URL ?? "").trim();
}

function namecheapRelayHeaders() {
  const token = String(process.env.NAMECHEAP_RELAY_TOKEN ?? "").trim();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function looksLikeNamecheapXmlApiResponse(body: string) {
  return /<ApiResponse\b/i.test(body);
}

function compactErrorMessage(body: string) {
  const trimmed = body.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    const candidate = String(parsed.error ?? parsed.message ?? "").trim();
    if (candidate) {
      return candidate;
    }
  } catch {
    // Fall through to plain-text cleanup.
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 300);
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

function parseXmlText(xml: string, tagName: string) {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return decodeXmlEntities(String(match?.[1] ?? "")).trim();
}

async function namecheapRequest(command: string, params: Record<string, string>) {
  const query = new URLSearchParams(params);
  const relayUrl = resolveNamecheapRelayUrl();
  const response = relayUrl
    ? await fetch(relayUrl, {
        method: "POST",
        cache: "no-store",
        headers: namecheapRelayHeaders(),
        body: JSON.stringify({ command, params }),
      })
    : await fetch(`${NAMECHEAP_BASE_URL}?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
  const xml = await response.text();
  if (!looksLikeNamecheapXmlApiResponse(xml)) {
    const detail = compactErrorMessage(xml);
    const source = relayUrl ? "Namecheap relay" : "Namecheap";
    throw new Error(
      detail
        ? `${source} ${command} failed: ${detail}`
        : `${source} ${command} returned a non-XML response (${response.status || "unknown status"})`
    );
  }
  const status = xmlResponseStatus(xml);
  const errors = xmlErrors(xml);
  if (!response.ok || status !== "OK") {
    const message =
      errors.join(" · ") || `Namecheap ${command} failed (${response.status || "unknown status"})`;
    throw new Error(withNamecheapIpHint(message));
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

async function namecheapListDomains(input: {
  apiUser: string;
  userName?: string;
  apiKey: string;
  clientIp: string;
}) {
  const pageSize = 100;
  const domains: NamecheapDomainInventoryItem[] = [];
  let page = 1;
  let totalItems = Number.POSITIVE_INFINITY;

  while (domains.length < totalItems) {
    const xml = await namecheapRequest("namecheap.domains.getList", {
      ...namecheapBaseParams({
        apiUser: input.apiUser,
        userName: input.userName,
        apiKey: input.apiKey,
        clientIp: input.clientIp,
        command: "namecheap.domains.getList",
      }),
      Page: String(page),
      PageSize: String(pageSize),
      SortBy: "NAME",
    });

    const rows = [...xml.matchAll(/<Domain\b([^>]+?)\/>/gi)].map((match) => {
      const attrs = parseXmlAttributes(match[1]);
      return {
        domain: String(attrs.Name ?? "").trim().toLowerCase(),
        createdAt: String(attrs.Created ?? "").trim(),
        expiresAt: String(attrs.Expires ?? "").trim(),
        isExpired: String(attrs.IsExpired ?? "").trim().toLowerCase() === "true",
        autoRenew: String(attrs.AutoRenew ?? "").trim().toLowerCase() === "true",
        isOurDns: String(attrs.IsOurDNS ?? "").trim().toLowerCase() === "true",
        whoisGuardEnabled: String(attrs.WhoisGuard ?? "").trim().toUpperCase() === "ENABLED",
      } satisfies NamecheapDomainInventoryItem;
    });
    const parsedTotalItems = toNumber(parseXmlText(xml, "TotalItems"), -1);
    totalItems =
      parsedTotalItems > 0
        ? parsedTotalItems
        : domains.length + rows.length + (rows.length === pageSize ? 1 : 0);

    domains.push(...rows.filter((row) => row.domain));
    if (!rows.length || rows.length < pageSize) {
      break;
    }
    page += 1;
  }

  return domains.sort((left, right) => left.domain.localeCompare(right.domain));
}

async function namecheapCheckDomains(input: {
  apiUser: string;
  userName?: string;
  apiKey: string;
  clientIp: string;
  domains: string[];
}) {
  const normalizedDomains = Array.from(
    new Set(
      input.domains
        .map((domain) => normalizeDomain(domain))
        .filter((domain) => domain && domain.includes("."))
    )
  ).slice(0, 50);

  if (!normalizedDomains.length) {
    return [] as NamecheapDomainAvailabilityItem[];
  }

  const xml = await namecheapRequest("namecheap.domains.check", {
    ...namecheapBaseParams({
      apiUser: input.apiUser,
      userName: input.userName,
      apiKey: input.apiKey,
      clientIp: input.clientIp,
      command: "namecheap.domains.check",
    }),
    DomainList: normalizedDomains.join(","),
  });

  return [...xml.matchAll(/<DomainCheckResult\b([^>]+?)\/>/gi)]
    .map((match) => {
      const attrs = parseXmlAttributes(match[1]);
      return {
        domain: String(attrs.Domain ?? "").trim().toLowerCase(),
        available: String(attrs.Available ?? "").trim().toLowerCase() === "true",
        premium: String(attrs.IsPremiumName ?? "").trim().toLowerCase() === "true",
        premiumRegistrationPrice: toNumber(String(attrs.PremiumRegistrationPrice ?? ""), 0),
        description: String(attrs.Description ?? "").trim(),
      } satisfies NamecheapDomainAvailabilityItem;
    })
    .filter((row) => row.domain);
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

function normalizeForwardingTargetUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    throw new Error("Forwarding target must be a valid URL or hostname");
  }
}

function mergeNamecheapForwardingHosts(
  existing: NamecheapHostRecord[],
  targetUrl: string
) {
  const normalizedTarget = normalizeForwardingTargetUrl(targetUrl);
  if (!normalizedTarget) return existing;

  const shouldReplace = (record: NamecheapHostRecord) => {
    const label = record.name.trim().toLowerCase();
    if (label === "@") {
      return record.type === "URL" || record.type === "URL301";
    }
    if (label === "www") {
      return record.type === "URL" || record.type === "URL301" || record.type === "CNAME" || record.type === "A";
    }
    return false;
  };

  const merged = existing.filter((record) => !shouldReplace(record));
  merged.push(
    {
      type: "URL301",
      name: "@",
      value: normalizedTarget,
      ttl: DEFAULT_NAMECHEAP_TTL,
      mxPref: 10,
    },
    {
      type: "URL301",
      name: "www",
      value: normalizedTarget,
      ttl: DEFAULT_NAMECHEAP_TTL,
      mxPref: 10,
    }
  );
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
    PageSize: "20",
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

export async function listSavedNamecheapDomains(): Promise<NamecheapDomainInventoryItem[]> {
  const [savedSettings, savedSecrets] = await Promise.all([
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
  ]);
  const apiUser = savedSettings.namecheap.apiUser.trim();
  const userName = savedSettings.namecheap.userName.trim() || apiUser;
  const apiKey = savedSecrets.namecheapApiKey.trim();
  const clientIp = savedSettings.namecheap.clientIp.trim();

  if (!apiUser || !apiKey || !clientIp) {
    return [];
  }

  return namecheapListDomains({
    apiUser,
    userName,
    apiKey,
    clientIp,
  });
}

export async function checkSavedNamecheapDomainAvailability(
  domains: string[]
): Promise<NamecheapDomainAvailabilityItem[]> {
  const [savedSettings, savedSecrets] = await Promise.all([
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
  ]);
  const apiUser = savedSettings.namecheap.apiUser.trim();
  const userName = savedSettings.namecheap.userName.trim() || apiUser;
  const apiKey = savedSecrets.namecheapApiKey.trim();
  const clientIp = savedSettings.namecheap.clientIp.trim();

  if (!apiUser || !apiKey || !clientIp) {
    return [];
  }

  return namecheapCheckDomains({
    apiUser,
    userName,
    apiKey,
    clientIp,
    domains,
  });
}

export async function testMailpoolProvisioningConnection(input: {
  apiKey: string;
}): Promise<ProvisioningProviderTestResult> {
  await testMailpoolConnection(input.apiKey);
  return {
    provider: "mailpool",
    ok: true,
    message: "Mailpool API credentials are working.",
    details: {},
  };
}

export async function listSavedMailpoolDomains(): Promise<MailpoolDomain[]> {
  const [savedSettings, savedSecrets] = await Promise.all([
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
  ]);
  const apiKey = savedSecrets.mailpoolApiKey.trim();
  if (!apiKey || !savedSettings.mailpool.hasApiKey) {
    return [];
  }
  return listMailpoolDomains(apiKey);
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
  workspaceId?: string;
  billing?: unknown;
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
    provider: "customerio" as const,
    accountType: "delivery" as const,
    status: "active" as const,
    config: {
      customerIo: {
        siteId: input.siteId.trim(),
        workspaceId: String(input.workspaceId ?? "").trim(),
        fromEmail: input.fromEmail.trim(),
        replyToEmail: input.replyToEmail.trim(),
        billing: sanitizeCustomerIoBillingConfig(input.billing),
      },
      mailpool: {
        domainId: "",
        mailboxId: "",
        mailboxType: "google",
        spamCheckId: "",
        inboxPlacementId: "",
        status: "pending",
        lastSpamCheckAt: "",
        lastSpamCheckScore: 0,
        lastSpamCheckSummary: "",
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
        smtpHost: "",
        smtpPort: 587,
        smtpSecure: false,
        smtpUsername: "",
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

async function ensureMailpoolHybridAccount(input: {
  accountName: string;
  mailbox: MailpoolMailbox;
  spamCheck?: MailpoolSpamCheck | null;
  inboxPlacement?: MailpoolInboxPlacement | null;
  replyToEmail: string;
}) {
  const allAccounts = await listOutreachAccounts();
  const fromEmail = input.mailbox.email.trim().toLowerCase();
  const existing =
    allAccounts.find(
      (account) =>
        account.provider === "mailpool" &&
        getOutreachAccountFromEmail(account).trim().toLowerCase() === fromEmail
    ) ?? null;

  const payload = {
    name: input.accountName.trim(),
    provider: "mailpool" as const,
    accountType: "hybrid" as const,
    status: input.mailbox.status === "deleted" ? ("inactive" as const) : ("active" as const),
    config: {
      customerIo: {
        siteId: "",
        workspaceId: "",
        fromEmail,
        replyToEmail: input.replyToEmail.trim() || fromEmail,
        billing: sanitizeCustomerIoBillingConfig({}),
      },
      mailpool: {
        domainId: String(input.mailbox.domain?.id ?? "").trim(),
        mailboxId: input.mailbox.id,
        mailboxType: input.mailbox.type,
        spamCheckId: String(input.spamCheck?.id ?? "").trim(),
        inboxPlacementId: String(input.inboxPlacement?.id ?? "").trim(),
        status:
          input.mailbox.status === "active"
            ? "active"
            : input.mailbox.status === "deleted"
              ? "deleted"
              : "pending",
        lastSpamCheckAt:
          input.spamCheck?.state === "completed" ? input.spamCheck.createdAt : "",
        lastSpamCheckScore: Number(input.spamCheck?.result?.score ?? 0) || 0,
        lastSpamCheckSummary:
          input.spamCheck?.state === "completed"
            ? `Spam score ${Number(input.spamCheck?.result?.score ?? 0) || 0}/100`
            : "",
      },
      apify: {
        defaultActorId: "",
      },
      mailbox: {
        provider: "imap",
        email: fromEmail,
        status: input.mailbox.imapHost ? "connected" : "disconnected",
        host: String(input.mailbox.imapHost ?? "").trim(),
        port: Number(input.mailbox.imapPort ?? 993) || 993,
        secure: Boolean(input.mailbox.imapTLS ?? true),
        smtpHost: String(input.mailbox.smtpHost ?? "").trim(),
        smtpPort: Number(input.mailbox.smtpPort ?? 587) || 587,
        smtpSecure: Boolean(input.mailbox.smtpTLS ?? false),
        smtpUsername:
          String(input.mailbox.smtpUsername ?? "").trim() || fromEmail,
      },
    },
    credentials: {
      mailboxPassword:
        String(input.mailbox.imapPassword ?? input.mailbox.password ?? "").trim(),
      mailboxSmtpPassword:
        String(input.mailbox.smtpPassword ?? input.mailbox.password ?? "").trim(),
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
  forwardingTargetUrl: string;
  registrar: NonNullable<DomainRow["registrar"]>;
  provider: NonNullable<Exclude<DomainRow["provider"], "manual">>;
  deliveryAccountId: string;
  deliveryAccountName: string;
  mailpoolDomainId?: string;
  notes: string;
}) {
  const now = nowIso();
  const existingIndex = input.brand.domains.findIndex(
    (row) => normalizeDomain(row.domain) === normalizeDomain(input.domain)
  );
  const automationStatus: DomainRow["automationStatus"] =
    input.dnsStatus === "verified" ? "warming" : input.dnsStatus === "error" ? "attention" : "testing";
  const automationSummary =
    input.dnsStatus === "verified"
      ? "DNS verified. Warmup started and seed checks now rotate by sender mailbox."
      : input.dnsStatus === "error"
        ? "DNS verification failed. Warmup is blocked until the sender records are fixed."
        : "DNS checks are in flight. Warmup and isolated seed probes start after verification.";
  const row: DomainRow = {
    id: existingIndex >= 0 ? input.brand.domains[existingIndex].id : createId("domain"),
    domain: input.domain,
    status: input.dnsStatus === "error" ? "risky" : "warming",
    warmupStage:
      input.dnsStatus === "verified"
        ? "Day 1 · warmup active"
        : input.dnsStatus === "error"
          ? "Warmup blocked"
          : "Queued for DNS + warmup",
    reputation:
      input.dnsStatus === "verified" ? "building" : input.dnsStatus === "error" ? "attention" : "queued",
    automationStatus,
    automationSummary,
    domainHealth:
      input.dnsStatus === "verified" ? "watch" : input.dnsStatus === "error" ? "risky" : "queued",
    emailHealth: input.fromEmail ? "queued" : "unknown",
    ipHealth: input.dnsStatus === "verified" ? "queued" : "unknown",
    messagingHealth: "queued",
    seedPolicy: "fresh_pool",
    role: "sender",
    registrar: input.registrar,
    provider: input.provider,
    dnsStatus: input.dnsStatus,
    fromEmail: input.fromEmail,
    replyMailboxEmail: input.replyMailboxEmail,
    forwardingTargetUrl: input.forwardingTargetUrl,
    deliveryAccountId: input.deliveryAccountId,
    deliveryAccountName: input.deliveryAccountName,
    customerIoAccountId:
      input.provider === "customerio" ? input.deliveryAccountId : undefined,
    customerIoAccountName:
      input.provider === "customerio" ? input.deliveryAccountName : undefined,
    mailpoolDomainId: input.mailpoolDomainId,
    notes: input.notes,
    lastProvisionedAt: now,
    nextHealthCheckAt: now,
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

function upsertProtectedBrandDomainRow(input: {
  domains: DomainRow[];
  protectedDomain: string;
  protectedUrl: string;
}) {
  const protectedDomain = normalizeDomain(input.protectedDomain);
  if (!protectedDomain) {
    return input.domains;
  }

  const existingIndex = input.domains.findIndex(
    (row) => normalizeDomain(row.domain) === protectedDomain
  );
  const nextRow: DomainRow = {
    id: existingIndex >= 0 ? input.domains[existingIndex].id : createId("domain"),
    domain: protectedDomain,
    status: "active",
    warmupStage: "Protected destination",
    reputation: "protected",
    automationStatus: "ready",
    automationSummary: "Protected destination only. Warmup and spam-test probes stay on satellite sender mailboxes.",
    domainHealth: "healthy",
    emailHealth: "unknown",
    ipHealth: "unknown",
    messagingHealth: "unknown",
    role: "brand",
    registrar: existingIndex >= 0 ? input.domains[existingIndex].registrar : "manual",
    provider: existingIndex >= 0 ? input.domains[existingIndex].provider : "manual",
    forwardingTargetUrl: input.protectedUrl,
    notes: "Protected brand domain. Satellite sender domains forward here.",
    lastProvisionedAt: nowIso(),
  };

  const nextDomains = [...input.domains];
  if (existingIndex >= 0) {
    nextDomains[existingIndex] = {
      ...nextDomains[existingIndex],
      ...nextRow,
    };
  } else {
    nextDomains.unshift(nextRow);
  }
  return nextDomains;
}

function effectiveCustomerIoTrackingApiKey(secrets: OutreachAccountSecrets) {
  return secrets.customerIoTrackApiKey.trim() || secrets.customerIoApiKey.trim();
}

async function resolveNamecheapCredentials(input: ProvisionSenderInput) {
  const [savedSettings, savedSecrets] = await Promise.all([
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
  ]);

  const namecheapApiUser = input.namecheapApiUser.trim() || savedSettings.namecheap.apiUser.trim();
  const namecheapUserName =
    input.namecheapUserName?.trim() || savedSettings.namecheap.userName.trim() || namecheapApiUser;
  const namecheapApiKey = input.namecheapApiKey.trim() || savedSecrets.namecheapApiKey.trim();
  const namecheapClientIp = input.namecheapClientIp.trim() || savedSettings.namecheap.clientIp.trim();

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
    namecheapApiUser,
    namecheapUserName,
    namecheapApiKey,
    namecheapClientIp,
  };
}

async function resolveMailpoolApiKey(input: ProvisionSenderInput) {
  const [savedSettings, savedSecrets] = await Promise.all([
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
  ]);
  const apiKey = String(input.mailpoolApiKey ?? "").trim() || savedSecrets.mailpoolApiKey.trim();
  if (!apiKey || !savedSettings.mailpool.hasApiKey && !String(input.mailpoolApiKey ?? "").trim()) {
    throw new Error("Mailpool API key is required. Save it in outreach settings first.");
  }
  return apiKey;
}

function uniqueNormalizedDomains(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeDomain(value))
        .filter((value) => value && value.includes("."))
    )
  );
}

async function getFirstAvailableMailpoolDomain(input: {
  apiKey: string;
  domains: string[];
  checkedDomains: string[];
}) {
  for (const domain of uniqueNormalizedDomains(input.domains)) {
    if (!domain || input.checkedDomains.includes(domain)) continue;
    input.checkedDomains.push(domain);
    const info = await getMailpoolDomainInfo(input.apiKey, domain);
    if (info.available) {
      return { domain, info };
    }
  }
  return null;
}

async function getFirstSuggestedAvailableMailpoolDomain(input: {
  apiKey: string;
  seeds: string[];
  checkedDomains: string[];
}) {
  for (const seed of uniqueNormalizedDomains(input.seeds)) {
    const suggestions = await listMailpoolDomainSuggestions({
      apiKey: input.apiKey,
      domain: seed,
      limit: 5,
    });
    for (const suggestion of suggestions) {
      if (!suggestion.domain || input.checkedDomains.includes(suggestion.domain)) continue;
      input.checkedDomains.push(suggestion.domain);
      if (suggestion.available) {
        return { seed, suggestion };
      }
    }
  }
  return null;
}

export async function selectAvailableMailpoolDomain(input: {
  preferredDomain: string;
  domainCandidates?: string[];
  allowAlternativeDomains?: boolean;
  mailpoolApiKey?: string;
}): Promise<MailpoolDomainSelection> {
  const apiKey =
    String(input.mailpoolApiKey ?? "").trim() ||
    (await getOutreachProvisioningSettingsSecrets()).mailpoolApiKey.trim();
  if (!apiKey) {
    throw new Error("Mailpool API key is required. Save it in outreach settings first.");
  }

  const preferredDomain = normalizeDomain(input.preferredDomain);
  const candidateDomains = uniqueNormalizedDomains(input.domainCandidates ?? []);
  const checkedDomains: string[] = [];
  const requested =
    preferredDomain
      ? await getFirstAvailableMailpoolDomain({
          apiKey,
          domains: [preferredDomain],
          checkedDomains,
        })
      : null;
  if (requested) {
    return {
      domain: requested.domain,
      available: true,
      price: requested.info.price,
      source: "requested",
      checkedDomains,
      suggestions: [],
    };
  }

  if (!input.allowAlternativeDomains) {
    return {
      domain: preferredDomain,
      available: false,
      price: 0,
      source: "requested",
      checkedDomains,
      suggestions: [],
    };
  }

  const alternate = await getFirstAvailableMailpoolDomain({
    apiKey,
    domains: candidateDomains.filter((domain) => domain !== preferredDomain),
    checkedDomains,
  });
  if (alternate) {
    return {
      domain: alternate.domain,
      available: true,
      price: alternate.info.price,
      source: "candidate",
      checkedDomains,
      suggestions: [],
    };
  }

  const suggestion = await getFirstSuggestedAvailableMailpoolDomain({
    apiKey,
    seeds: [preferredDomain, ...candidateDomains],
    checkedDomains,
  });
  if (suggestion) {
    return {
      domain: suggestion.suggestion.domain,
      available: true,
      price: suggestion.suggestion.price,
      source: "suggestion",
      checkedDomains,
      suggestions: [suggestion.suggestion.domain],
    };
  }

  return {
    domain: preferredDomain || candidateDomains[0] || "",
    available: false,
    price: 0,
    source: "requested",
    checkedDomains,
    suggestions: [],
  };
}

function buildMailpoolDomainOwner(input: {
  brand: BrandRecord;
  registrant?: ProvisionSenderInput["registrant"];
}): MailpoolDomainOwner {
  const registrant = input.registrant;
  if (!registrant) {
    throw new Error("Registrant contact information is required to buy a new domain");
  }
  const company = String(registrant.organizationName ?? "").trim() || input.brand.name.trim() || registrant.lastName.trim();
  return {
    company,
    firstName: registrant.firstName.trim(),
    lastName: registrant.lastName.trim(),
    email: registrant.emailAddress.trim(),
    streetAddress1: registrant.address1.trim(),
    streetAddress2: "",
    city: registrant.city.trim(),
    state: registrant.stateProvince.trim(),
    postalCode: registrant.postalCode.trim(),
    country: registrant.country.trim().toUpperCase(),
  };
}

function mailpoolStatusToDnsStatus(status: string): DomainRow["dnsStatus"] {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "active") return "verified";
  if (normalized === "pending") return "configured";
  return "error";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deriveMailboxNameParts(input: { brand: BrandRecord; accountName: string; emailLocalPart: string }) {
  const raw = input.accountName.trim() || input.brand.name.trim() || input.emailLocalPart.replace(/[._+-]+/g, " ");
  const tokens = raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const firstName = tokens[0] || "Sales";
  const lastName = tokens.slice(1).join(" ") || input.brand.name.trim() || "Team";
  return { firstName, lastName };
}

async function waitForMailpoolSpamCheck(apiKey: string, spamCheckId: string) {
  let current = await getMailpoolSpamCheck(apiKey, spamCheckId);
  for (let attempt = 0; attempt < 10 && current.state !== "completed"; attempt += 1) {
    await sleep(1500);
    current = await getMailpoolSpamCheck(apiKey, spamCheckId);
  }
  return current;
}

async function waitForMailpoolInboxPlacement(apiKey: string, inboxPlacementId: string) {
  let current = await getMailpoolInboxPlacement(apiKey, inboxPlacementId);
  for (let attempt = 0; attempt < 6 && current.state !== "completed"; attempt += 1) {
    await sleep(2000);
    current = await getMailpoolInboxPlacement(apiKey, inboxPlacementId);
  }
  return current;
}

function availableMailpoolGoogleSlots(slots: MailpoolSubscriptionSlots) {
  return Math.max(0, slots.slots.google - slots.mailboxes.google);
}

function isMailpoolMailboxLimitError(error: unknown) {
  return error instanceof Error && /mailboxes count limit exceeded/i.test(error.message);
}

function isMailpoolGoogleCredentialsPendingError(error: unknown) {
  return error instanceof Error && /google workspace credentials not found/i.test(error.message);
}

async function ensureMailpoolGoogleSlots(apiKey: string, requiredAvailable = 1) {
  let current = await getMailpoolSubscriptionSlots(apiKey);
  if (availableMailpoolGoogleSlots(current) >= requiredAvailable) {
    return current;
  }

  const targetQuantity = Math.max(
    current.slots.google,
    current.mailboxes.google + requiredAvailable
  );
  current = await updateMailpoolSubscriptionSlots({
    apiKey,
    type: "google",
    quantity: targetQuantity,
  });

  for (let attempt = 0; attempt < 4 && availableMailpoolGoogleSlots(current) < requiredAvailable; attempt += 1) {
    await sleep(1500);
    current = await getMailpoolSubscriptionSlots(apiKey);
  }

  if (availableMailpoolGoogleSlots(current) < requiredAvailable) {
    throw new Error(
      `Mailpool Google inbox slots are exhausted after auto-scaling. Current slots: ${current.slots.google}, mailboxes: ${current.mailboxes.google}.`
    );
  }

  return current;
}

type ResolvedCustomerIoProvisioningConnection = {
  siteId: string;
  workspaceId: string;
  trackingApiKey: string;
  appApiKey: string;
  billing: NonNullable<OutreachAccount["config"]["customerIo"]["billing"]>;
  sourceAccountId: string;
  sourceAccountName: string;
  sourcePool: CustomerIoCapacityPool | null;
};

async function resolveManualCustomerIoConnection(
  input: ProvisionSenderInput
): Promise<ResolvedCustomerIoProvisioningConnection> {
  const [savedSettings, savedSecrets] = await Promise.all([
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
  ]);

  const siteId = input.customerIoSiteId.trim() || savedSettings.customerIo.siteId.trim();
  const trackingApiKey =
    input.customerIoTrackingApiKey.trim() || savedSecrets.customerIoTrackingApiKey.trim();
  const appApiKey = String(input.customerIoAppApiKey ?? "").trim() || savedSecrets.customerIoAppApiKey.trim();

  if (!siteId) {
    throw new Error("Customer.io Site ID is required. Save provider defaults or select an existing Customer.io account.");
  }
  if (!trackingApiKey) {
    throw new Error(
      "Customer.io Tracking API key is required. Save provider defaults or select an existing Customer.io account."
    );
  }

  return {
    siteId,
    workspaceId: "",
    trackingApiKey,
    appApiKey,
    billing: sanitizeCustomerIoBillingConfig({}),
    sourceAccountId: "",
    sourceAccountName: "Saved defaults",
    sourcePool: null,
  };
}

async function resolveCustomerIoProvisioningConnection(
  input: ProvisionSenderInput
): Promise<ResolvedCustomerIoProvisioningConnection> {
  const selectedAccountId = input.customerIoSourceAccountId?.trim() || "";
  if (!selectedAccountId && !input.autoPickCustomerIoAccount) {
    return resolveManualCustomerIoConnection(input);
  }

  const accounts = await listOutreachAccounts();
  const pools = buildCustomerIoCapacityPools(accounts);
  const selectedPool = selectedAccountId
    ? pools.find((pool) => pool.sourceAccountId === selectedAccountId) ?? null
    : findBestCustomerIoCapacityPool(pools);

  if (!selectedPool) {
    if (selectedAccountId) {
      throw new Error("Selected Customer.io account could not be found.");
    }
    if (pools.length) {
      throw new Error("No Customer.io account has monthly profile capacity left right now.");
    }
    return resolveManualCustomerIoConnection(input);
  }
  if (!selectedPool.canProvision) {
    throw new Error(selectedPool.warning || "Selected Customer.io account has no monthly profile capacity left.");
  }

  const sourceAccount = await getOutreachAccount(selectedPool.sourceAccountId);
  const sourceSecrets = await getOutreachAccountSecrets(selectedPool.sourceAccountId);
  if (!sourceAccount || !sourceSecrets) {
    throw new Error("Customer.io account credentials are missing for the selected pool.");
  }

  const trackingApiKey = effectiveCustomerIoTrackingApiKey(sourceSecrets);
  if (!trackingApiKey) {
    throw new Error("Customer.io tracking API key is missing on the selected account.");
  }

  return {
    siteId: sourceAccount.config.customerIo.siteId.trim(),
    workspaceId: sourceAccount.config.customerIo.workspaceId.trim(),
    trackingApiKey,
    appApiKey: sourceSecrets.customerIoAppApiKey.trim(),
    billing: sanitizeCustomerIoBillingConfig(sourceAccount.config.customerIo.billing),
    sourceAccountId: sourceAccount.id,
    sourceAccountName: sourceAccount.name,
    sourcePool: selectedPool,
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
  const customerIoConnection = await resolveCustomerIoProvisioningConnection(input);
  const namecheapCredentials = await resolveNamecheapCredentials(input);
  const forwardingTargetUrl = input.forwardingTargetUrl?.trim()
    ? normalizeForwardingTargetUrl(input.forwardingTargetUrl)
    : brand.website.trim()
      ? normalizeForwardingTargetUrl(brand.website)
      : "";

  const mailboxSelection =
    input.selectedMailboxAccountId?.trim() || (await getBrandOutreachAssignment(brand.id))?.mailboxAccountId || "";
  const mailboxAccount = mailboxSelection ? await getOutreachAccount(mailboxSelection) : null;
  const replyMailboxEmail = getOutreachMailboxEmail(mailboxAccount).trim();

  if (!mailboxAccount) {
    throw new Error(
      "Assign a real mailbox account before provisioning a Customer.io sender. We do not allow unbacked From addresses."
    );
  }
  const senderBackingIssue = getOutreachSenderBackingIssue(
    {
      provider: "customerio",
      accountType: "delivery",
      config: {
        customerIo: {
          siteId: customerIoConnection.siteId,
          workspaceId: customerIoConnection.workspaceId,
          fromEmail,
          replyToEmail: replyMailboxEmail,
          billing: customerIoConnection.billing,
        },
        mailpool: {
          domainId: "",
          mailboxId: "",
          mailboxType: "google",
          spamCheckId: "",
          inboxPlacementId: "",
          status: "pending",
          lastSpamCheckAt: "",
          lastSpamCheckScore: 0,
          lastSpamCheckSummary: "",
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
          smtpHost: "",
          smtpPort: 587,
          smtpSecure: false,
          smtpUsername: "",
        },
      },
    },
    mailboxAccount
  );
  if (senderBackingIssue) {
    throw new Error(senderBackingIssue);
  }

  const connectivityAccount: OutreachAccount = {
    id: "provision_check",
    name: input.accountName.trim() || `Customer.io ${domain}`,
    provider: "customerio",
    accountType: "delivery",
    status: "active",
    config: {
      customerIo: {
        siteId: customerIoConnection.siteId,
        workspaceId: customerIoConnection.workspaceId,
        fromEmail,
        replyToEmail: replyMailboxEmail,
        billing: customerIoConnection.billing,
      },
      mailpool: {
        domainId: "",
        mailboxId: "",
        mailboxType: "google",
        spamCheckId: "",
        inboxPlacementId: "",
        status: "pending",
        lastSpamCheckAt: "",
        lastSpamCheckScore: 0,
        lastSpamCheckSummary: "",
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
        smtpHost: "",
        smtpPort: 587,
        smtpSecure: false,
        smtpUsername: "",
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
      customerIoApiKey: customerIoConnection.trackingApiKey,
      customerIoTrackApiKey: customerIoConnection.trackingApiKey,
      customerIoAppApiKey: customerIoConnection.appApiKey,
      apifyToken: "",
      mailboxAccessToken: "",
      mailboxRefreshToken: "",
      mailboxPassword: "",
      mailboxSmtpPassword: "",
      mailboxRecoveryEmail: "",
      mailboxRecoveryCodes: "",
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
      apiUser: namecheapCredentials.namecheapApiUser,
      userName: namecheapCredentials.namecheapUserName,
      apiKey: namecheapCredentials.namecheapApiKey,
      clientIp: namecheapCredentials.namecheapClientIp,
      domain,
      registrant: input.registrant,
    });
  }

  const existingHosts = await namecheapGetHosts({
    apiUser: namecheapCredentials.namecheapApiUser,
    userName: namecheapCredentials.namecheapUserName,
    apiKey: namecheapCredentials.namecheapApiKey,
    clientIp: namecheapCredentials.namecheapClientIp,
    domain,
  });

  const senderBootstrap = await bootstrapCustomerIoSender({
    siteId: customerIoConnection.siteId,
    trackingApiKey: customerIoConnection.trackingApiKey,
    appApiKey: customerIoConnection.appApiKey,
    fromEmail,
    senderName: brand.name || input.accountName || domain,
    domain,
  });

  const desiredDnsRecords = senderBootstrap.dnsRecords;
  if (desiredDnsRecords.length || forwardingTargetUrl) {
    let nextHosts = desiredDnsRecords.length ? mergeNamecheapHosts(existingHosts, desiredDnsRecords, domain) : existingHosts;
    if (forwardingTargetUrl) {
      nextHosts = mergeNamecheapForwardingHosts(nextHosts, forwardingTargetUrl);
    }
    await namecheapSetHosts({
      apiUser: namecheapCredentials.namecheapApiUser,
      userName: namecheapCredentials.namecheapUserName,
      apiKey: namecheapCredentials.namecheapApiKey,
      clientIp: namecheapCredentials.namecheapClientIp,
      domain,
      hosts: nextHosts,
    });
  }

  const account = await ensureCustomerIoDeliveryAccount({
    accountName: input.accountName.trim() || `${brand.name} ${domain}`,
    siteId: customerIoConnection.siteId,
    workspaceId: customerIoConnection.workspaceId,
    billing: customerIoConnection.billing,
    trackingApiKey: customerIoConnection.trackingApiKey,
    appApiKey: customerIoConnection.appApiKey,
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
  if (!forwardingTargetUrl) {
    warnings.push("No forwarding target is set for this domain yet.");
  }

  let nextDomains = updateBrandDomainRow({
    brand,
    domain,
    fromEmail,
    replyMailboxEmail,
    dnsStatus,
    forwardingTargetUrl,
    registrar: "namecheap",
    provider: "customerio",
    deliveryAccountId: customerIoConnection.sourceAccountId || account.id,
    deliveryAccountName: customerIoConnection.sourceAccountName || account.name,
    notes:
      desiredDnsRecords.length > 0
        ? "Provisioned through outreach settings."
        : "Provisioned partially. Customer.io sender verification still needs attention.",
  });
  const protectedDomain = forwardingTargetUrl ? normalizeDomain(forwardingTargetUrl) : "";
  if (protectedDomain && protectedDomain !== domain) {
    nextDomains = upsertProtectedBrandDomainRow({
      domains: nextDomains,
      protectedDomain,
      protectedUrl: forwardingTargetUrl,
    });
  }

  const updatedBrand = await updateBrand(brand.id, {
    domains: nextDomains,
  });

  const deliverabilitySettings = await getOutreachProvisioningSettings();
  if (deliverabilitySettings.deliverability.provider === "google_postmaster") {
    const monitoredDomains = new Set(
      deliverabilitySettings.deliverability.monitoredDomains.map((entry) => normalizeDomain(entry)).filter(Boolean)
    );
    if (!monitoredDomains.has(domain)) {
      monitoredDomains.add(domain);
      await updateOutreachProvisioningSettings({
        deliverability: {
          monitoredDomains: [...monitoredDomains],
        },
      });
    }
  }

  const nextSteps: string[] = [];
  if (!desiredDnsRecords.length) {
    nextSteps.push("Open Customer.io sender identities and finish verification for this domain.");
  }
  if (!forwardingTargetUrl) {
    nextSteps.push("Set a forwarding target so this domain redirects to the protected brand site.");
  }
  if (!replyMailboxEmail) {
    nextSteps.push("Assign a reply mailbox to the brand before launching outreach.");
  }
  nextSteps.push("Run a Customer.io account test again after DNS propagates.");

  return {
    ok: true,
    provider: "customerio",
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
      forwardingEnabled: Boolean(forwardingTargetUrl),
      forwardingTargetUrl,
    },
    customerIo: {
      senderIdentityStatus: senderBootstrap.status,
      dnsRecordCount: desiredDnsRecords.length,
      sourceAccountId: customerIoConnection.sourceAccountId || account.id,
      sourceAccountName: customerIoConnection.sourceAccountName || account.name,
    },
    mailpool: undefined,
    warnings,
    nextSteps,
  };
}

export async function provisionMailpoolSender(
  input: ProvisionSenderInput
): Promise<ProvisionSenderResult> {
  const brand = await getBrandById(input.brandId);
  if (!brand) {
    throw new Error("Brand not found");
  }

  const requestedDomain = normalizeDomain(input.domain);
  if (!requestedDomain || !requestedDomain.includes(".")) {
    throw new Error("A valid domain is required");
  }

  const fromLocalPart = normalizeEmailLocalPart(input.fromLocalPart);
  if (!fromLocalPart) {
    throw new Error("Sender local-part is required");
  }

  const apiKey = await resolveMailpoolApiKey(input);
  const domainSelection =
    input.domainMode === "register"
      ? await selectAvailableMailpoolDomain({
          preferredDomain: requestedDomain,
          domainCandidates: input.domainCandidates,
          allowAlternativeDomains: input.allowAlternativeDomains,
          mailpoolApiKey: apiKey,
        })
      : null;
  const domain = domainSelection?.domain || requestedDomain;
  if (input.domainMode === "register" && (!domainSelection || !domainSelection.available || !domain)) {
    throw new Error(
      domainSelection?.checkedDomains?.length
        ? `Mailpool could not find an available domain to register. Checked: ${domainSelection.checkedDomains.join(", ")}`
        : "Mailpool could not find an available domain to register."
    );
  }
  const forwardingTargetUrl = input.forwardingTargetUrl?.trim()
    ? normalizeForwardingTargetUrl(input.forwardingTargetUrl)
    : brand.website.trim()
      ? normalizeForwardingTargetUrl(brand.website)
      : "";
  const fromEmail = `${fromLocalPart}@${domain}`;
  const { firstName, lastName } = deriveMailboxNameParts({
    brand,
    accountName: input.accountName,
    emailLocalPart: fromLocalPart,
  });

  const [settings, existingDomains, existingMailboxes] = await Promise.all([
    getOutreachProvisioningSettings(),
    listMailpoolDomains(apiKey),
    listMailpoolMailboxes(apiKey),
  ]);

  let mailpoolDomain =
    existingDomains.find((entry) => entry.domain === domain) ?? null;
  if (input.domainMode === "register") {
    mailpoolDomain = await registerMailpoolDomain({
      apiKey,
      domain,
      type: "google",
      redirectUrl: forwardingTargetUrl || undefined,
      domainOwner: buildMailpoolDomainOwner({ brand, registrant: input.registrant }),
    });
  }

  if (!mailpoolDomain) {
    throw new Error("This domain is not managed in Mailpool yet. Add it there first or switch to register.");
  }

  let mailbox =
    existingMailboxes.find((entry) => entry.email === fromEmail.toLowerCase()) ?? null;
  if (!mailbox) {
    await ensureMailpoolGoogleSlots(apiKey, 1);
    try {
      mailbox = await createMailpoolMailbox({
        apiKey,
        email: fromEmail,
        firstName,
        lastName,
        signature: `Best regards,\n${firstName} ${lastName}`.trim(),
        type: "google",
      });
    } catch (error) {
      if (!isMailpoolMailboxLimitError(error)) {
        throw error;
      }
      await ensureMailpoolGoogleSlots(apiKey, 1);
      await sleep(1500);
      mailbox = await createMailpoolMailbox({
        apiKey,
        email: fromEmail,
        firstName,
        lastName,
        signature: `Best regards,\n${firstName} ${lastName}`.trim(),
        type: "google",
      });
    }
  }

  const mailboxReadyForDelivery = Boolean(
    mailbox.status === "active" &&
      String(mailbox.smtpHost ?? "").trim() &&
      String(mailbox.imapHost ?? "").trim() &&
      (String(mailbox.smtpPassword ?? mailbox.password ?? "").trim() ||
        String(mailbox.imapPassword ?? mailbox.password ?? "").trim())
  );
  let spamCheck: MailpoolSpamCheck | null = null;
  let resolvedSpamCheck: MailpoolSpamCheck | null = null;
  let inboxPlacement: MailpoolInboxPlacement | null = null;
  let resolvedInboxPlacement: MailpoolInboxPlacement | null = null;

  const warnings: string[] = [];
  const nextSteps: string[] = [];

  if (input.domainMode === "register" && domainSelection?.source && domainSelection.source !== "requested" && requestedDomain !== domain) {
    warnings.push(`Mailpool switched to ${domain} because ${requestedDomain} was not available.`);
  }

  if (mailboxReadyForDelivery && mailbox.id) {
    try {
      spamCheck = await createMailpoolSpamCheck({ apiKey, mailboxId: mailbox.id });
      resolvedSpamCheck =
        spamCheck?.id ? await waitForMailpoolSpamCheck(apiKey, spamCheck.id) : null;

      const inboxProviders =
        settings.deliverability.mailpoolInboxProviders.length
          ? settings.deliverability.mailpoolInboxProviders
          : ([...DEFAULT_MAILPOOL_INBOX_PROVIDERS] as MailpoolInboxPlacementProvider[]);
      inboxPlacement = await createMailpoolInboxPlacement({
        apiKey,
        mailboxId: mailbox.id,
        providers: inboxProviders,
      });
      const runningInboxPlacement =
        inboxPlacement?.id ? await runMailpoolInboxPlacement(apiKey, inboxPlacement.id) : inboxPlacement;
      resolvedInboxPlacement =
        runningInboxPlacement?.id
          ? await waitForMailpoolInboxPlacement(apiKey, runningInboxPlacement.id)
          : null;
    } catch (error) {
      if (!isMailpoolGoogleCredentialsPendingError(error)) {
        throw error;
      }
      warnings.push("Mailpool mailbox exists, but Google Workspace credentials are still provisioning.");
      nextSteps.push("Wait for Mailpool to finish Google Workspace mailbox setup, then refresh the sender.");
    }
  } else {
    warnings.push("Mailpool mailbox is still provisioning and is not ready for SMTP, IMAP, or deliverability checks yet.");
    nextSteps.push("Wait for Mailpool to mark the mailbox active, then refresh the sender to sync credentials.");
  }

  const account = await ensureMailpoolHybridAccount({
    accountName: input.accountName.trim() || `${brand.name} ${domain}`,
    mailbox,
    spamCheck: resolvedSpamCheck,
    inboxPlacement: resolvedInboxPlacement,
    replyToEmail: fromEmail,
  });

  const assignment =
    input.assignToBrand === false
      ? null
      : await setBrandOutreachAssignment(brand.id, {
          accountId: account.id,
          mailboxAccountId: account.id,
        });

  let nextDomains = updateBrandDomainRow({
    brand,
    domain,
    fromEmail,
    replyMailboxEmail: fromEmail,
    dnsStatus: mailpoolStatusToDnsStatus(mailpoolDomain.status),
    forwardingTargetUrl: forwardingTargetUrl || mailpoolDomain.redirectUrl || "",
    registrar: "mailpool",
    provider: "mailpool",
    deliveryAccountId: account.id,
    deliveryAccountName: account.name,
    mailpoolDomainId: mailpoolDomain.id,
    notes: "Provisioned through Mailpool.",
  });
  const protectedDomain = forwardingTargetUrl ? normalizeDomain(forwardingTargetUrl) : "";
  if (protectedDomain && protectedDomain !== domain) {
    nextDomains = upsertProtectedBrandDomainRow({
      domains: nextDomains,
      protectedDomain,
      protectedUrl: forwardingTargetUrl,
    });
  }
  const updatedBrand = await updateBrand(brand.id, {
    domains: nextDomains,
  });

  if (settings.deliverability.provider !== "none") {
    const monitoredDomains = new Set(
      settings.deliverability.monitoredDomains.map((entry) => normalizeDomain(entry)).filter(Boolean)
    );
    if (!monitoredDomains.has(domain)) {
      monitoredDomains.add(domain);
      await updateOutreachProvisioningSettings({
        deliverability: {
          monitoredDomains: [...monitoredDomains],
        },
      });
    }
  }

  if (mailpoolDomain.status !== "active") {
    warnings.push(`Mailpool domain is still ${mailpoolDomain.status}. DNS may still be propagating.`);
  }
  if (resolvedSpamCheck?.state !== "completed") {
    warnings.push("Mailpool spam check is still pending.");
  }
  if (resolvedInboxPlacement && resolvedInboxPlacement.state !== "completed") {
    warnings.push("Mailpool inbox placement is still pending.");
  }

  if (mailpoolDomain.status !== "active") {
    nextSteps.push("Wait for Mailpool to finish domain activation and DNS propagation.");
  }
  if (resolvedInboxPlacement && resolvedInboxPlacement.state !== "completed") {
    nextSteps.push("Refresh inbox placement after Mailpool finishes the first run.");
  }
  nextSteps.push("Run a sender test before launching live campaigns.");

  return {
    ok: true,
    provider: "mailpool",
    readyToSend: Boolean(
      mailpoolDomain.status === "active" &&
        supportsMailpoolDelivery(account, (await getOutreachAccountSecrets(account.id)) ?? undefined)
    ),
    domain,
    fromEmail,
    brand: updatedBrand ?? brand,
    account,
    assignment,
    namecheap: undefined,
    customerIo: undefined,
    mailpool: {
      domainId: mailpoolDomain.id,
      domainStatus: mailpoolDomain.status,
      mailboxId: mailbox.id,
      mailboxStatus: String(mailbox.status ?? "").trim() || "pending",
      spamCheckId: String(resolvedSpamCheck?.id ?? spamCheck?.id ?? "").trim(),
      spamCheckStatus: String(resolvedSpamCheck?.state ?? spamCheck?.state ?? "pending"),
      inboxPlacementId: String(resolvedInboxPlacement?.id ?? inboxPlacement?.id ?? "").trim(),
      inboxPlacementStatus: String(resolvedInboxPlacement?.state ?? inboxPlacement?.state ?? "pending"),
    },
    warnings,
    nextSteps,
  };
}

export async function provisionSender(input: ProvisionSenderInput): Promise<ProvisionSenderResult> {
  return (input.provider ?? "customerio") === "mailpool"
    ? provisionMailpoolSender(input)
    : provisionCustomerIoSender(input);
}
