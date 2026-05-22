import { sanitizeAiText } from "@/lib/ai-sanitize";
import { listBrands } from "@/lib/factory-data";
import type { BrandRecord, EmailVerificationState, OutreachAccount } from "@/lib/factory-types";
import {
  createWarmupSeedReservations,
  getBrandOutreachAssignment,
  getOutreachAccountSecrets,
  listWarmupSeedReservations,
  listOutreachAccounts,
  type OutreachAccountSecrets,
} from "@/lib/outreach-data";

export const WARMUP_SEED_SOURCE_URL_PREFIX = "lastb2b://warmup-seed/";

export type WarmupSeedMonitorTarget = {
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  brandId: string;
  brand: Pick<
    BrandRecord,
    | "id"
    | "name"
    | "website"
    | "product"
    | "notes"
    | "targetMarkets"
    | "idealCustomerProfiles"
    | "keyFeatures"
    | "keyBenefits"
  > | null;
};

export type WarmupSeedLead = {
  email: string;
  name: string;
  company: string;
  title: string;
  domain: string;
  sourceUrl: string;
  realVerifiedEmail: boolean;
  emailVerification: EmailVerificationState;
};

type WarmupSeedSiteContext = {
  title: string;
  description: string;
  pageExcerpt: string;
};

const warmupSeedSiteContextCache = new Map<string, Promise<WarmupSeedSiteContext | null>>();

function supportsMailbox(account: OutreachAccount) {
  return account.accountType !== "delivery";
}

function isDedicatedDeliverabilityMonitor(account: OutreachAccount) {
  return account.name.trim().toLowerCase().startsWith("deliverability ");
}

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const codePoint = Number.parseInt(String(hex), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/&#([0-9]+);/g, (_match, decimal) => {
      const codePoint = Number.parseInt(String(decimal), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    });
}

function compactText(value: unknown, maxLength: number) {
  return sanitizeAiText(decodeHtmlEntities(String(value ?? "")).replace(/\s+/g, " "))
    .trim()
    .slice(0, maxLength)
    .trim();
}

function firstSentence(value: unknown, maxLength: number) {
  const compact = compactText(value, Math.max(maxLength, 220));
  return compactText(compact.split(/(?<=[.!?])\s+/)[0] ?? compact, maxLength);
}

function firstNonEmpty(values: Array<unknown>, maxLength: number) {
  for (const value of values) {
    const compact = compactText(value, maxLength);
    if (compact) return compact;
  }
  return "";
}

function companyFromDomain(domain: string) {
  const normalized = String(domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.+$/, "");
  if (!normalized) return "Seed Monitor";
  const root = normalized.split(".")[0] ?? normalized;
  return titleCaseWords(root.replace(/[-_]+/g, " ")) || "Seed Monitor";
}

function companyFromBrandName(name: string, fallbackDomain: string) {
  const normalized = compactText(name, 80);
  if (!normalized) {
    return companyFromDomain(fallbackDomain);
  }
  const primary = compactText(normalized.split(/\s+[|:-]\s+/)[0] ?? normalized, 80);
  return primary || companyFromDomain(fallbackDomain);
}

function extractMeta(html: string, name: string) {
  const regex = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = html.match(regex);
  return match ? match[1].trim() : "";
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : "";
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBrandNotes(value: string) {
  return compactText(
    value
      .replace(/current outreach offer:[^.]+\.?/gi, " ")
      .replace(/^this is the user's /i, "")
      .replace(/^this is the user'?s /i, "")
      .replace(/\bthe user\b/gi, "")
      .replace(/\s+/g, " "),
    160
  );
}

function buildWarmupSeedBrandSummary(
  brand:
    | Pick<
        BrandRecord,
        | "name"
        | "product"
        | "notes"
        | "targetMarkets"
        | "idealCustomerProfiles"
        | "keyFeatures"
        | "keyBenefits"
      >
    | null
) {
  if (!brand) return "";
  const product = compactText(brand.product, 110);
  const market = compactText(brand.targetMarkets?.[0], 70);
  const profile = compactText(brand.idealCustomerProfiles?.[0], 90);
  const feature = compactText(brand.keyFeatures?.[0], 90);
  const benefit = compactText(brand.keyBenefits?.[0], 90);
  const notes = cleanBrandNotes(String(brand.notes ?? ""));

  return firstNonEmpty(
    [
      product && market ? `${product} for ${market}` : "",
      product && profile ? `${product} for ${profile}` : "",
      product && benefit ? `${product}; ${benefit}` : "",
      product,
      feature,
      benefit,
      notes,
      profile,
    ],
    140
  );
}

async function fetchWarmupSeedSiteContext(domain: string): Promise<WarmupSeedSiteContext | null> {
  const normalizedDomain = String(domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.+$/, "");
  if (!normalizedDomain) return null;

  const cached = warmupSeedSiteContextCache.get(normalizedDomain);
  if (cached) return cached;

  const task = (async () => {
    const urls = [`https://${normalizedDomain}`, `http://${normalizedDomain}`];
    for (const url of urls) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "LastB2BWarmupSeedBot/1.0",
            Accept: "text/html,application/xhtml+xml",
          },
        });
        if (!response.ok) {
          continue;
        }
        const html = (await response.text()).slice(0, 180000);
        const title = compactText(extractMeta(html, "og:title") || extractTitle(html), 140);
        const description = compactText(
          extractMeta(html, "og:description") || extractMeta(html, "description"),
          180
        );
        const pageExcerpt = compactText(stripHtml(html), 240);
        if (!title && !description && !pageExcerpt) {
          continue;
        }
        return {
          title,
          description,
          pageExcerpt,
        } satisfies WarmupSeedSiteContext;
      } catch {
        continue;
      } finally {
        clearTimeout(timeout);
      }
    }

    return null;
  })();

  warmupSeedSiteContextCache.set(normalizedDomain, task);
  return task;
}

function buildWarmupSeedSiteSummary(input: {
  company: string;
  siteContext: WarmupSeedSiteContext | null;
}) {
  const company = compactText(input.company, 80);
  const description = firstSentence(input.siteContext?.description, 140);
  if (description) return description;

  const title = compactText(input.siteContext?.title, 120);
  if (title) {
    const escapedCompany = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const trimmedTitle = compactText(
      title.replace(new RegExp(`^${escapedCompany}\\s*[-:|]\\s*`, "i"), ""),
      120
    );
    if (trimmedTitle && trimmedTitle.toLowerCase() !== company.toLowerCase()) {
      return trimmedTitle;
    }
  }

  const excerpt = compactText(input.siteContext?.pageExcerpt, 140);
  if (excerpt) {
    return firstSentence(excerpt, 140);
  }

  return "";
}

function displayNameFromAccount(account: OutreachAccount) {
  const label = account.name.trim();
  if (label) return label;
  const email = account.config.mailbox.email.trim().toLowerCase();
  const local = email.split("@")[0] ?? "";
  return titleCaseWords(local.replace(/[._+-]+/g, " ")) || "Seed Monitor";
}

export function buildWarmupSeedSourceUrl(accountId: string) {
  return `${WARMUP_SEED_SOURCE_URL_PREFIX}${String(accountId ?? "").trim()}`;
}

export function isWarmupSeedSourceUrl(value: unknown) {
  return String(value ?? "").trim().startsWith(WARMUP_SEED_SOURCE_URL_PREFIX);
}

export function isWarmupSeedLead(lead: { sourceUrl?: unknown } | null | undefined) {
  return isWarmupSeedSourceUrl(lead?.sourceUrl);
}

export function parseWarmupSeedSourceUrlAccountId(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized.startsWith(WARMUP_SEED_SOURCE_URL_PREFIX)) return "";
  return normalized.slice(WARMUP_SEED_SOURCE_URL_PREFIX.length).trim();
}

export async function resolveWarmupSeedMonitorTargets(
  input: {
    runBrandId?: string;
    excludeAccountIds?: string[];
    excludeEmails?: string[];
  } = {}
): Promise<WarmupSeedMonitorTarget[]> {
  const [accounts, brands] = await Promise.all([listOutreachAccounts(), listBrands()]);
  const brandById = new Map(
    brands.map((brand) => [
      brand.id,
      {
        id: brand.id,
        name: brand.name,
        website: brand.website,
        product: brand.product,
        notes: brand.notes,
        targetMarkets: brand.targetMarkets,
        idealCustomerProfiles: brand.idealCustomerProfiles,
        keyFeatures: brand.keyFeatures,
        keyBenefits: brand.keyBenefits,
      },
    ] as const)
  );
  const assignments = await Promise.all(
    brands.map(async (brand) => ({
      brandId: brand.id,
      assignment: await getBrandOutreachAssignment(brand.id),
    }))
  );
  const mailboxBrandByAccountId = new Map(
    assignments
      .filter((row) => row.assignment?.mailboxAccountId)
      .map((row) => [String(row.assignment?.mailboxAccountId ?? "").trim(), row.brandId] as const)
  );
  const excludedAccountIds = new Set(
    (input.excludeAccountIds ?? []).map((value) => String(value ?? "").trim()).filter(Boolean)
  );
  const excludedEmails = new Set(
    (input.excludeEmails ?? []).map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean)
  );

  const candidates: WarmupSeedMonitorTarget[] = [];
  for (const account of accounts) {
    if (account.status !== "active" || !supportsMailbox(account)) continue;
    const mailboxEmail = account.config.mailbox.email.trim().toLowerCase();
    if (!mailboxEmail || account.config.mailbox.status !== "connected") continue;
    if (excludedAccountIds.has(account.id) || excludedEmails.has(mailboxEmail)) continue;
    const secrets = await getOutreachAccountSecrets(account.id);
    if (!secrets || !secrets.mailboxPassword.trim()) continue;
    const brandId = mailboxBrandByAccountId.get(account.id) ?? "";
    candidates.push({
      account,
      secrets,
      brandId,
      brand: brandById.get(brandId) ?? null,
    });
  }

  const dedicated = candidates.filter((candidate) => isDedicatedDeliverabilityMonitor(candidate.account));
  const pool = dedicated.length ? dedicated : candidates;

  return pool.sort((left, right) => {
    const leftDedicated = isDedicatedDeliverabilityMonitor(left.account) ? 0 : 1;
    const rightDedicated = isDedicatedDeliverabilityMonitor(right.account) ? 0 : 1;
    if (leftDedicated !== rightDedicated) return leftDedicated - rightDedicated;

    const leftCrossBrand = left.brandId && left.brandId !== input.runBrandId ? 0 : 1;
    const rightCrossBrand = right.brandId && right.brandId !== input.runBrandId ? 0 : 1;
    if (leftCrossBrand !== rightCrossBrand) return leftCrossBrand - rightCrossBrand;

    return left.account.name.localeCompare(right.account.name);
  });
}

export async function resolveAvailableWarmupSeedMonitorTargets(input: {
  runBrandId: string;
  excludeAccountIds?: string[];
  excludeEmails?: string[];
}) {
  const [targets, reservations] = await Promise.all([
    resolveWarmupSeedMonitorTargets(input),
    listWarmupSeedReservations({
      statuses: ["reserved"],
    }),
  ]);
  const reservedAccountIds = new Set(
    reservations.map((reservation) => reservation.monitorAccountId.trim()).filter(Boolean)
  );
  const reservedEmails = new Set(
    reservations.map((reservation) => reservation.monitorEmail.trim().toLowerCase()).filter(Boolean)
  );
  return targets.filter((target) => {
    const email = target.account.config.mailbox.email.trim().toLowerCase();
    return !reservedAccountIds.has(target.account.id) && !reservedEmails.has(email);
  });
}

export async function buildWarmupSeedLead(target: WarmupSeedMonitorTarget): Promise<WarmupSeedLead> {
  const email = target.account.config.mailbox.email.trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  const company = target.brand?.name
    ? companyFromBrandName(target.brand.name, domain)
    : companyFromDomain(domain);
  const siteContext = target.brand ? null : await fetchWarmupSeedSiteContext(domain);
  const title =
    buildWarmupSeedBrandSummary(target.brand) ||
    buildWarmupSeedSiteSummary({
      company,
      siteContext,
    }) ||
    `Business team at ${company}`;

  return {
    email,
    name: displayNameFromAccount(target.account),
    company,
    title,
    domain,
    sourceUrl: buildWarmupSeedSourceUrl(target.account.id),
    realVerifiedEmail: true,
    emailVerification: {
      mode: "local",
      provider: "deliverability_seed",
      verdict: "valid",
      confidence: "high",
      reason: "warmup_seed_monitor",
      mxStatus: "",
      acceptAll: null,
      catchAll: null,
    },
  };
}

export async function buildWarmupSeedLeads(input: {
  runBrandId: string;
  excludeAccountIds?: string[];
  excludeEmails?: string[];
  maxLeads?: number;
}): Promise<WarmupSeedLead[]> {
  const targets = await resolveAvailableWarmupSeedMonitorTargets({
    runBrandId: input.runBrandId,
    excludeAccountIds: input.excludeAccountIds,
    excludeEmails: input.excludeEmails,
  });
  const maxLeads = Math.max(1, Number(input.maxLeads ?? 1) || 1);
  return Promise.all(targets.slice(0, maxLeads).map((target) => buildWarmupSeedLead(target)));
}

export async function reserveWarmupSeedLeads(input: {
  runId: string;
  runBrandId: string;
  senderAccountId: string;
  fromEmail: string;
  excludeAccountIds?: string[];
  excludeEmails?: string[];
  maxLeads?: number;
}): Promise<WarmupSeedLead[]> {
  const targets = await resolveAvailableWarmupSeedMonitorTargets({
    runBrandId: input.runBrandId,
    excludeAccountIds: input.excludeAccountIds,
    excludeEmails: input.excludeEmails,
  });
  const maxLeads = Math.max(1, Number(input.maxLeads ?? 1) || 1);
  const reservedLeads: WarmupSeedLead[] = [];

  for (const target of targets) {
    if (reservedLeads.length >= maxLeads) break;
    const email = target.account.config.mailbox.email.trim().toLowerCase();
    const reservations = await createWarmupSeedReservations({
      runId: input.runId,
      brandId: input.runBrandId,
      senderAccountId: input.senderAccountId,
      fromEmail: input.fromEmail,
      targets: [
        {
          accountId: target.account.id,
          email,
        },
      ],
    });
    if (!reservations.length) {
      continue;
    }
    reservedLeads.push(await buildWarmupSeedLead(target));
  }

  return reservedLeads;
}
