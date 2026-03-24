import type { ExperimentRecord, OutreachRunLead } from "@/lib/factory-types";
import { isReportCommentExperiment } from "@/lib/experiment-policy";
import { normalizeDomainCandidate } from "@/lib/experiment-prospect-import";

type ReportCommentLeadLike = Pick<
  OutreachRunLead,
  "name" | "company" | "title" | "domain" | "sourceUrl"
> & { email?: string };

type ReportCommentFamily =
  | "ecommerce_channel"
  | "retention_stack"
  | "accounting_automation"
  | "legal_operations"
  | "gtm_hiring"
  | "unknown";

const EXACT_BLOCKED_DOMAINS = new Set([
  "success.ai",
  "wikitia.com",
  "prnewswire.com",
  "prlog.org",
  "omt.de",
  "shopify.com",
  "klaviyo.com",
  "hubspot.com",
  "salesforce.com",
  "apollo.io",
  "zoominfo.com",
  "botkeeper.com",
  "iaaic.org",
  "booking.com",
  "tiktok.com",
  "meta.com",
  "facebook.com",
  "google.com",
  "youtube.com",
  "camunda.com",
]);

const GENERIC_SERVICE_KEYWORDS = [
  "agency",
  "agence",
  "agentur",
  "bureau",
  "byra",
  "byrå",
  "consult",
  "consulting",
  "consultancy",
  "consultant",
  "advisor",
  "advisory",
  "specialist",
  "studio",
  "collective",
  "partner",
  "partners",
  "freelance",
  "freelancer",
  "independent",
  "strategist",
  "growth",
  "performance marketing",
  "paid social",
  "paid-social",
];

const GENERIC_MEDIA_OR_DIRECTORY_KEYWORDS = [
  "newswire",
  "press release",
  "press-release",
  "wiki",
  "directory",
  "marketplace",
  "association",
  "institute",
  "society",
  "academy",
  "community",
  "newsletter",
  "podcast",
  "magazine",
  "publication",
  "conference",
  "awards",
];

const ECOMMERCE_BRAND_KEYWORDS = [
  "foods",
  "apparel",
  "fashion",
  "store",
  "shop",
  "pet",
  "beauty",
  "cosmetics",
  "furniture",
  "brand",
  "retailer",
];

const ACCOUNTING_FIRM_KEYWORDS = [
  "cpa",
  "cpa's",
  "accounting firm",
  "chartered professional accountant",
  "tax",
  "audit",
  "bookkeeping firm",
];

const ACCOUNTING_FIRM_BRANDS = [
  "deloitte",
  "withum",
  "aprio",
  "eisneramper",
  "grant thornton",
  "grantthornton",
  "bdo",
  "kpmg",
  "pricewaterhousecoopers",
  "pwc",
  "ernst young",
  "ey",
  "rsm",
  "baker tilly",
  "mnp",
  "capexcpa",
];

const LEGAL_FIRM_KEYWORDS = [
  "law firm",
  "attorney",
  "attorneys",
  "solicitor",
  "solicitors",
  "litigation",
  "injury law",
  "family law",
  "estate planning",
  "criminal defense",
];

const GTM_NEGATIVE_KEYWORDS = [
  "venture capital",
  "investor",
  "vc fund",
  "recruiter",
  "recruitment",
  "headhunter",
  "talent partner",
];

const CHANNEL_KEYWORDS = [
  "tiktok",
  "meta ads",
  "paid social",
  "performance marketing",
  "ecommerce",
  "e-commerce",
  "shopify",
  "dtc",
  "acquisition",
];

const RETENTION_KEYWORDS = [
  "retention",
  "email marketing",
  "sms marketing",
  "lifecycle",
  "crm",
  "klaviyo",
  "shopify",
];

const ACCOUNTING_AUTOMATION_KEYWORDS = [
  "automation",
  "workflow",
  "integrator",
  "implementation",
  "accounting",
  "bookkeeping",
  "quickbooks",
  "ops",
  "operations",
  "systems",
  "advisory",
];

const ACCOUNTING_MARKET_KEYWORDS = [
  "accounting",
  "bookkeeping",
  "bookkeeper",
  "quickbooks",
  "payroll",
  "reconciliation",
  "tax",
  "cpa",
  "cas",
];

const AUTOMATION_SERVICE_KEYWORDS = [
  "automation",
  "workflow",
  "workflows",
  "systems",
  "operations",
  "ops",
  "consult",
  "consulting",
  "advisory",
  "integrator",
  "integration",
  "implementation",
  "ai",
  "fractional",
];

const LEGAL_MARKET_KEYWORDS = [
  "law",
  "legal",
  "firm",
  "clio",
  "matter",
  "intake",
  "solicitor",
  "attorney",
];

const LEGAL_OPERATIONS_KEYWORDS = [
  "legal ops",
  "intake",
  "clio",
  "automation",
  "workflow",
  "law firm operations",
  "matter management",
];

const GTM_KEYWORDS = [
  "revops",
  "gtm",
  "outbound",
  "hubspot",
  "salesforce",
  "crm",
  "sales systems",
  "go to market",
];

function normalizeText(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(blob: string, keywords: string[]) {
  return keywords.some((keyword) => blob.includes(normalizeText(keyword)));
}

function classifyReportCommentExperimentName(name: string): ReportCommentFamily {
  const normalized = normalizeText(name);
  if (normalized.includes("ecommerce channel report")) return "ecommerce_channel";
  if (normalized.includes("retention stack report")) return "retention_stack";
  if (normalized.includes("accounting automation report")) return "accounting_automation";
  if (normalized.includes("legal operations report")) return "legal_operations";
  if (normalized.includes("gtm hiring report")) return "gtm_hiring";
  return "unknown";
}

function hasServiceSignal(blob: string) {
  return includesAny(blob, GENERIC_SERVICE_KEYWORDS);
}

function hasExactBlockedDomain(domain: string, sourceDomain: string) {
  return EXACT_BLOCKED_DOMAINS.has(domain) || EXACT_BLOCKED_DOMAINS.has(sourceDomain);
}

export function assessReportCommentLeadQuality(
  experiment: Pick<ExperimentRecord, "name" | "audience" | "offer">,
  lead: ReportCommentLeadLike
) {
  if (!isReportCommentExperiment(experiment)) {
    return { keep: true, reason: "not_report_comment" } as const;
  }

  const family = classifyReportCommentExperimentName(experiment.name);
  const domain = normalizeDomainCandidate(lead.domain ?? "");
  const sourceDomain = normalizeDomainCandidate(lead.sourceUrl ?? "");
  const leadBlob = normalizeText(
    [
      lead.name,
      lead.company,
      lead.title,
      domain,
      sourceDomain,
      lead.sourceUrl,
    ].join(" ")
  );
  const contextBlob = normalizeText([experiment.name, experiment.audience, experiment.offer].join(" "));
  const serviceSignal = hasServiceSignal(leadBlob);

  if (hasExactBlockedDomain(domain, sourceDomain)) {
    return { keep: false, reason: "blocked_domain" } as const;
  }

  if (includesAny(leadBlob, GENERIC_MEDIA_OR_DIRECTORY_KEYWORDS) && !serviceSignal) {
    return { keep: false, reason: "media_or_directory" } as const;
  }

  if (family === "ecommerce_channel" || family === "retention_stack") {
    const familyKeywords = family === "retention_stack" ? RETENTION_KEYWORDS : CHANNEL_KEYWORDS;
    const familySignal = includesAny(leadBlob, familyKeywords);
    if (includesAny(leadBlob, ECOMMERCE_BRAND_KEYWORDS) && !serviceSignal) {
      return { keep: false, reason: "target_brand_not_expert" } as const;
    }
    if (!familySignal) {
      return {
        keep: false,
        reason: family === "retention_stack" ? "weak_retention_fit" : "weak_channel_fit",
      } as const;
    }
    return { keep: true, reason: "channel_or_retention_fit" } as const;
  }

  if (family === "accounting_automation") {
    const familySignal = includesAny(leadBlob, ACCOUNTING_AUTOMATION_KEYWORDS);
    const marketSignal = includesAny(leadBlob, ACCOUNTING_MARKET_KEYWORDS);
    const automationServiceSignal = includesAny(leadBlob, AUTOMATION_SERVICE_KEYWORDS);
    const looksLikeAccountingFirm =
      includesAny(leadBlob, ACCOUNTING_FIRM_KEYWORDS) || includesAny(leadBlob, ACCOUNTING_FIRM_BRANDS);
    if (includesAny(leadBlob, ACCOUNTING_FIRM_BRANDS)) {
      return { keep: false, reason: "accounting_brand_not_target_expert" } as const;
    }
    if (
      looksLikeAccountingFirm &&
      !includesAny(leadBlob, [
        "automation",
        "workflow",
        "systems",
        "integrator",
        "implementation",
        "consult",
        "advisory",
        "ops",
        "fractional",
      ])
    ) {
      return { keep: false, reason: "accounting_firm_not_service_provider" } as const;
    }
    if (!marketSignal || !automationServiceSignal || !familySignal) {
      return { keep: false, reason: "weak_accounting_automation_fit" } as const;
    }
    return { keep: true, reason: "accounting_automation_fit" } as const;
  }

  if (family === "legal_operations") {
    const familySignal = includesAny(leadBlob, LEGAL_OPERATIONS_KEYWORDS);
    const marketSignal = includesAny(leadBlob, LEGAL_MARKET_KEYWORDS);
    const looksLikeLawFirm = includesAny(leadBlob, LEGAL_FIRM_KEYWORDS);
    if (
      looksLikeLawFirm &&
      !includesAny(leadBlob, [
        "automation",
        "workflow",
        "ops",
        "operations",
        "consult",
        "advisory",
        "fractional",
        "systems",
      ])
    ) {
      return { keep: false, reason: "law_firm_not_service_provider" } as const;
    }
    if (!marketSignal || !familySignal) {
      return { keep: false, reason: "weak_legal_ops_fit" } as const;
    }
    return { keep: true, reason: "legal_ops_fit" } as const;
  }

  if (family === "gtm_hiring") {
    const familySignal = includesAny(leadBlob, GTM_KEYWORDS);
    if (includesAny(leadBlob, GTM_NEGATIVE_KEYWORDS) && !serviceSignal) {
      return { keep: false, reason: "gtm_non_operator" } as const;
    }
    if (!familySignal) {
      return { keep: false, reason: "weak_gtm_fit" } as const;
    }
    return { keep: true, reason: "gtm_fit" } as const;
  }

  return serviceSignal || hasServiceSignal(contextBlob)
    ? ({ keep: true, reason: "generic_service_fit" } as const)
    : ({ keep: false, reason: "weak_generic_fit" } as const);
}
