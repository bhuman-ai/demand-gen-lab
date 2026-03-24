import type {
  ReplyMessage,
  ReplyThread,
  SenderLaunch,
  SenderLaunchAction,
  SenderLaunchEvent,
} from "@/lib/factory-types";
import {
  createSenderLaunchAction,
  createSenderLaunchEvent,
  listReplyMessagesByThread,
  listReplyThreadsByBrand,
  listSenderLaunchActions,
  updateSenderLaunchAction,
} from "@/lib/outreach-data";

type LaunchSourceKind = "newsletter" | "inquiry";
type SignupMode = "gravity_form" | "substack_free_form" | "kit_embedded_form";

type LaunchSource = {
  key: string;
  kind: LaunchSourceKind;
  label: string;
  active: boolean;
  priority: number;
  topicTags: string[];
  signupMode?: SignupMode;
  signupPageUrl?: string;
  signupFormSelector?: {
    actionIncludes?: string;
    actionEquals?: string;
  };
  kitEmbedScriptUrl?: string;
  doi?: {
    required: boolean;
    subjectIncludes: string[];
    senderDomains: string[];
    linkHostAllowlist: string[];
    successUrlIncludes: string[];
    successTextIncludes: string[];
  };
};

type AutopilotResult = {
  actionsScheduled: number;
  actionsCompleted: number;
  actionsFailed: number;
};

const TOPIC_EQUIVALENTS: Record<string, string[]> = {
  ai: ["llm", "llms", "models", "agents", "automation"],
  llm: ["ai", "llms", "models", "agents"],
  llms: ["ai", "llm", "models", "agents"],
  startup: ["startups", "founder", "founders", "saas"],
  startups: ["startup", "founder", "founders", "saas"],
  founder: ["founders", "startup", "startups", "bootstrapped", "self-funded", "indie"],
  founders: ["founder", "startup", "startups", "bootstrapped", "self-funded", "indie"],
  saas: ["software", "startup", "startups", "b2b", "cloud"],
  software: ["saas", "engineering", "developers"],
  engineering: ["engineer", "developers", "developer", "software", "infrastructure"],
  growth: ["marketing", "gtm", "demand", "acquisition", "product"],
  marketing: ["growth", "gtm", "demand", "content"],
  cloud: ["aws", "infrastructure", "devops", "saas"],
  infrastructure: ["cloud", "devops", "platform", "engineering"],
  product: ["growth", "marketing", "saas"],
  ecommerce: ["e-commerce", "dtc", "retail", "shopify"],
  "self-funded": ["bootstrapped", "founder", "founders", "indie"],
};

const OPT_IN_DAY_ONE_LIMIT = 2;
const OPT_IN_DAILY_LIMIT = 1;
const OPT_IN_FIRST_WEEK_LIMIT = 5;
const OPT_IN_PRE_READY_LIMIT = 8;
const DOUBLE_OPT_IN_DAILY_LIMIT = 3;
const DOUBLE_OPT_IN_POLL_MINUTES = 30;
const DOUBLE_OPT_IN_TIMEOUT_HOURS = 24;
const AUTOPILOT_INQUIRY_LANE_ENABLED = false;

const LAUNCH_SOURCE_CATALOG: LaunchSource[] = [
  {
    key: "last_week_in_aws",
    kind: "newsletter",
    label: "Last Week in AWS",
    active: true,
    priority: 100,
    topicTags: ["aws", "cloud", "credits", "infrastructure", "engineering", "founders"],
    signupMode: "gravity_form",
    signupPageUrl: "https://www.lastweekinaws.com/",
    signupFormSelector: {
      actionIncludes: "#gf_1",
    },
    doi: {
      required: true,
      subjectIncludes: ["confirm your subscription", "confirm subscription"],
      senderDomains: ["lastweekinaws.com"],
      linkHostAllowlist: ["click.lastweekinaws.com", "app.kit.com", "lastweekinaws.com"],
      successUrlIncludes: ["signup-complete", "signup-confirmation"],
      successTextIncludes: ["you’re subscribed and all set", "you’re almost done", "check your inbox"],
    },
  },
  {
    key: "pragmatic_engineer",
    kind: "newsletter",
    label: "The Pragmatic Engineer",
    active: true,
    priority: 90,
    topicTags: ["engineering", "software", "ai", "saas", "developers", "startups"],
    signupMode: "substack_free_form",
    signupPageUrl: "https://newsletter.pragmaticengineer.com/",
    signupFormSelector: {
      actionIncludes: "/api/v1/free?nojs=true",
    },
    doi: {
      required: false,
      subjectIncludes: [],
      senderDomains: ["substack.com", "newsletter.pragmaticengineer.com"],
      linkHostAllowlist: ["newsletter.pragmaticengineer.com", "substack.com"],
      successUrlIncludes: ["pragmaticengineer", "substack"],
      successTextIncludes: ["thanks for subscribing", "check your inbox"],
    },
  },
  {
    key: "bootstrapped_founder",
    kind: "newsletter",
    label: "The Bootstrapped Founder",
    active: true,
    priority: 85,
    topicTags: ["bootstrapped", "self-funded", "founders", "saas", "indie", "entrepreneur"],
    signupMode: "kit_embedded_form",
    signupPageUrl: "https://thebootstrappedfounder.com/newsletter/",
    kitEmbedScriptUrl: "https://wondrous-designer-9010.kit.com/5cadcdea23/index.js",
    doi: {
      required: true,
      subjectIncludes: ["confirm your subscription", "please confirm"],
      senderDomains: ["thebootstrappedfounder.com", "kit.com"],
      linkHostAllowlist: ["app.kit.com", "thebootstrappedfounder.com"],
      successUrlIncludes: ["newsletter-please-confirm", "confirm", "bootstrappedfounder"],
      successTextIncludes: ["check your email to confirm", "please confirm your subscription"],
    },
  },
  {
    key: "lennys_newsletter",
    kind: "newsletter",
    label: "Lenny's Newsletter",
    active: true,
    priority: 94,
    topicTags: ["product", "growth", "marketing", "startup", "startups", "founder", "founders", "saas"],
    signupMode: "substack_free_form",
    signupPageUrl: "https://www.lennysnewsletter.com/",
    signupFormSelector: {
      actionIncludes: "/api/v1/free?nojs=true",
    },
    doi: {
      required: false,
      subjectIncludes: [],
      senderDomains: ["substack.com", "lennysnewsletter.com"],
      linkHostAllowlist: ["www.lennysnewsletter.com", "substack.com"],
      successUrlIncludes: ["lennysnewsletter", "substack"],
      successTextIncludes: ["thanks for subscribing", "check your inbox"],
    },
  },
  {
    key: "not_boring",
    kind: "newsletter",
    label: "Not Boring",
    active: true,
    priority: 92,
    topicTags: ["technology", "tech", "startups", "founders", "venture", "investing", "ai", "saas", "cloud"],
    signupMode: "substack_free_form",
    signupPageUrl: "https://www.notboring.co/",
    signupFormSelector: {
      actionIncludes: "/api/v1/free?nojs=true",
    },
    doi: {
      required: false,
      subjectIncludes: [],
      senderDomains: ["substack.com", "notboring.co"],
      linkHostAllowlist: ["www.notboring.co", "substack.com"],
      successUrlIncludes: ["notboring", "substack"],
      successTextIncludes: ["thanks for subscribing", "check your inbox"],
    },
  },
  {
    key: "latent_space",
    kind: "newsletter",
    label: "Latent Space",
    active: true,
    priority: 93,
    topicTags: ["ai", "llm", "llms", "agents", "models", "engineering", "infrastructure", "developers"],
    signupMode: "substack_free_form",
    signupPageUrl: "https://www.latent.space/",
    signupFormSelector: {
      actionIncludes: "/api/v1/free?nojs=true",
    },
    doi: {
      required: false,
      subjectIncludes: [],
      senderDomains: ["substack.com", "latent.space"],
      linkHostAllowlist: ["www.latent.space", "substack.com"],
      successUrlIncludes: ["latent", "substack"],
      successTextIncludes: ["thanks for subscribing", "check your inbox"],
    },
  },
  {
    key: "one_useful_thing",
    kind: "newsletter",
    label: "One Useful Thing",
    active: true,
    priority: 93,
    topicTags: ["ai", "education", "work", "productivity", "enterprise", "management", "founder", "founders"],
    signupMode: "substack_free_form",
    signupPageUrl: "https://www.oneusefulthing.org/",
    signupFormSelector: {
      actionIncludes: "/api/v1/free?nojs=true",
    },
    doi: {
      required: false,
      subjectIncludes: [],
      senderDomains: ["substack.com", "oneusefulthing.org"],
      linkHostAllowlist: ["www.oneusefulthing.org", "substack.com"],
      successUrlIncludes: ["oneusefulthing", "substack"],
      successTextIncludes: ["thanks for subscribing", "check your inbox"],
    },
  },
  {
    key: "interconnects_ai",
    kind: "newsletter",
    label: "Interconnects AI",
    active: true,
    priority: 91,
    topicTags: ["ai", "llm", "llms", "models", "research", "engineering", "infrastructure", "agents"],
    signupMode: "substack_free_form",
    signupPageUrl: "https://www.interconnects.ai/",
    signupFormSelector: {
      actionIncludes: "/api/v1/free?nojs=true",
    },
    doi: {
      required: false,
      subjectIncludes: [],
      senderDomains: ["substack.com", "interconnects.ai"],
      linkHostAllowlist: ["www.interconnects.ai", "substack.com"],
      successUrlIncludes: ["interconnects", "substack"],
      successTextIncludes: ["thanks for subscribing", "check your inbox"],
    },
  },
  {
    key: "clouded_judgement",
    kind: "newsletter",
    label: "Clouded Judgement",
    active: true,
    priority: 88,
    topicTags: ["saas", "cloud", "finance", "fintech", "metrics", "revenue", "benchmarks", "software", "b2b"],
    signupMode: "substack_free_form",
    signupPageUrl: "https://cloudedjudgement.substack.com/",
    signupFormSelector: {
      actionIncludes: "/api/v1/free?nojs=true",
    },
    doi: {
      required: false,
      subjectIncludes: [],
      senderDomains: ["substack.com", "cloudedjudgement.substack.com"],
      linkHostAllowlist: ["cloudedjudgement.substack.com", "substack.com"],
      successUrlIncludes: ["cloudedjudgement", "substack"],
      successTextIncludes: ["thanks for subscribing", "check your inbox"],
    },
  },
];

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(iso: string, minutes: number) {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

function addHours(iso: string, hours: number) {
  return new Date(Date.parse(iso) + hours * 60 * 60_000).toISOString();
}

function startOfUtcDay(iso: string) {
  const date = new Date(iso);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function sameUtcDay(leftIso: string, rightIso: string) {
  return startOfUtcDay(leftIso) === startOfUtcDay(rightIso);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function emailDomain(value: string) {
  const normalized = normalizeEmail(value);
  const at = normalized.lastIndexOf("@");
  return at >= 0 ? normalized.slice(at + 1) : "";
}

function expandMatchToken(token: string) {
  const normalized = token.trim().toLowerCase();
  const variants = new Set<string>();
  if (!normalized) return variants;
  variants.add(normalized);
  if (normalized.includes("-")) {
    variants.add(normalized.replace(/-/g, ""));
    for (const part of normalized.split("-").filter(Boolean)) variants.add(part);
  }
  if (normalized.endsWith("ies") && normalized.length > 4) {
    variants.add(`${normalized.slice(0, -3)}y`);
  }
  if (normalized.endsWith("s") && normalized.length > 4) {
    variants.add(normalized.slice(0, -1));
  }
  if (normalized.endsWith("ing") && normalized.length > 6) {
    variants.add(normalized.slice(0, -3));
  }
  for (const equivalent of TOPIC_EQUIVALENTS[normalized] ?? []) {
    variants.add(equivalent);
  }
  return variants;
}

function stripQuotedPrintableSoftBreaks(value: string) {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=3D/gi, "=")
    .replace(/=20/gi, " ")
    .replace(/=\r/g, "")
    .replace(/=09/gi, "\t");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function decodeEscapedHtml(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">")
      .replace(/\\u0026/gi, "&")
      .replace(/\\"/g, '"')
      .replace(/\\\//g, "/")
  );
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseAttr(attributes: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = attributes.match(pattern);
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function parseInputs(formHtml: string) {
  const inputs: Array<{ type: string; name: string; value: string }> = [];
  const regex = /<input\b([^>]*)>/gi;
  for (const match of formHtml.matchAll(regex)) {
    const attrs = match[1] ?? "";
    const name = parseAttr(attrs, "name");
    if (!name) continue;
    const type = (parseAttr(attrs, "type") || "text").toLowerCase();
    const value = parseAttr(attrs, "value");
    inputs.push({ type, name, value });
  }
  return inputs;
}

function parseForms(html: string) {
  const forms: Array<{ action: string; method: string; html: string }> = [];
  const regex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  for (const match of html.matchAll(regex)) {
    const attrs = match[1] ?? "";
    forms.push({
      action: parseAttr(attrs, "action"),
      method: (parseAttr(attrs, "method") || "post").toLowerCase(),
      html: match[0],
    });
  }
  return forms;
}

function selectForm(html: string, selector?: LaunchSource["signupFormSelector"]) {
  const forms = parseForms(html);
  return (
    forms.find((form) => {
      if (selector?.actionEquals && form.action === selector.actionEquals) return true;
      if (selector?.actionIncludes && form.action.includes(selector.actionIncludes)) return true;
      return false;
    }) ?? null
  );
}

function extractUrls(value: string) {
  const normalized = stripQuotedPrintableSoftBreaks(value);
  const urls: string[] = [];
  const regex = /https?:\/\/[^\s<>"')\]]+/gi;
  for (const match of normalized.matchAll(regex)) {
    urls.push(match[0].replace(/[.,;:!?]+$/g, ""));
  }
  return urls;
}

function topicMatchScore(launch: SenderLaunch, source: LaunchSource) {
  const launchTokens = new Set<string>();
  for (const token of launch.topicKeywords) {
    for (const variant of expandMatchToken(token)) {
      launchTokens.add(variant);
    }
  }
  let score = 0;
  for (const tag of source.topicTags) {
    const tagVariants = expandMatchToken(tag);
    if ([...tagVariants].some((variant) => launchTokens.has(variant))) {
      score += 1;
    }
  }
  return score;
}

function ageInDays(launch: SenderLaunch) {
  const createdAt = Date.parse(launch.createdAt || launch.lastEvaluatedAt || nowIso());
  if (!Number.isFinite(createdAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - createdAt) / (24 * 60 * 60 * 1000)));
}

function isLaunchAutopilotEligible(launch: SenderLaunch) {
  return !["setup", "paused", "blocked", "ready"].includes(launch.state);
}

function optInDailyLimit(launch: SenderLaunch) {
  return ageInDays(launch) <= 0 ? OPT_IN_DAY_ONE_LIMIT : OPT_IN_DAILY_LIMIT;
}

function actionsForSource(actions: SenderLaunchAction[], sourceKey: string) {
  return actions.filter((action) => action.sourceKey === sourceKey);
}

function activeOrCompletedActions(actions: SenderLaunchAction[]) {
  return actions.filter((action) => !["failed", "skipped"].includes(action.status));
}

function countActionsToday(actions: SenderLaunchAction[], lane: SenderLaunchAction["lane"], referenceIso: string) {
  return actions.filter((action) => action.lane === lane && sameUtcDay(action.createdAt, referenceIso)).length;
}

async function recordLaunchEvent(
  launch: SenderLaunch,
  eventType: SenderLaunchEvent["eventType"],
  title: string,
  detail: string,
  metadata: Record<string, unknown> = {},
  occurredAt = nowIso()
) {
  return createSenderLaunchEvent(
    {
      senderLaunchId: launch.id,
      senderAccountId: launch.senderAccountId,
      brandId: launch.brandId,
      eventType,
      title,
      detail,
      metadata,
      occurredAt,
    },
    { allowMissingTable: true }
  );
}

async function fetchText(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    redirect: "follow",
    ...init,
    headers: {
      "user-agent": "lastb2b-sender-launch/1.0",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  return { response, text };
}

async function executeSubstackFreeSignup(source: LaunchSource, email: string) {
  if (!source.signupPageUrl) {
    return { ok: false, summary: "Missing signup page URL.", error: "missing_signup_page_url" };
  }
  const page = await fetchText(source.signupPageUrl);
  const form = selectForm(page.text, source.signupFormSelector);
  const inferredSubdomain =
    page.text.match(/https%3A%2F%2F([a-z0-9-]+)\.substack\.com%2Ftwitter%2Fsubscribe-card/i)?.[1] ??
    page.text.match(/"subdomain":"([a-z0-9-]+)"/i)?.[1] ??
    "";
  const actionUrl = form?.action
    ? new URL(form.action, source.signupPageUrl).toString()
    : inferredSubdomain
      ? `https://${inferredSubdomain}.substack.com/api/v1/free?nojs=true`
      : "";
  if (!actionUrl) {
    return { ok: false, summary: "Substack signup form was not found.", error: "signup_form_not_found" };
  }
  const params = new URLSearchParams();
  for (const input of parseInputs(form?.html ?? "").filter((entry) => entry.type === "hidden")) {
    params.set(input.name, input.value);
  }
  params.set("email", email);
  if (!params.has("current_url")) params.set("current_url", source.signupPageUrl);
  if (!params.has("first_url")) params.set("first_url", source.signupPageUrl);
  const result = await fetchText(actionUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const text = stripTags(result.text).toLowerCase();
  const ok =
    result.response.ok &&
    !/error|captcha|checkpoint|try again/.test(text) &&
    (result.response.url !== actionUrl || /check your inbox|thanks for subscribing|confirm/i.test(text));
  return {
    ok,
    summary: ok
      ? `Subscribed ${email} to ${source.label}.`
      : `Failed to subscribe ${email} to ${source.label}.`,
    error: ok ? "" : `unexpected_substack_response:${result.response.status}`,
  };
}

async function executeGravityFormSignup(source: LaunchSource, email: string) {
  if (!source.signupPageUrl) {
    return { ok: false, summary: "Missing signup page URL.", error: "missing_signup_page_url" };
  }
  const page = await fetchText(source.signupPageUrl);
  const form = selectForm(page.text, source.signupFormSelector);
  if (!form) {
    return { ok: false, summary: "Gravity form was not found.", error: "signup_form_not_found" };
  }
  const inputs = parseInputs(form.html);
  const emailInput = inputs.find((entry) => entry.type === "email");
  if (!emailInput?.name) {
    return { ok: false, summary: "Gravity form email field was not found.", error: "email_field_not_found" };
  }
  const body = new FormData();
  for (const input of inputs) {
    if (input.type === "submit") continue;
    body.set(input.name, input.name === emailInput.name ? email : input.value);
  }
  const actionUrl = new URL(form.action || source.signupPageUrl, source.signupPageUrl).toString();
  const result = await fetchText(actionUrl, {
    method: "POST",
    body,
  });
  const haystack = `${result.response.url} ${stripTags(result.text).toLowerCase()}`;
  const ok = result.response.ok && /signup-confirmation|you’re almost done|check your inbox|confirm/i.test(haystack);
  return {
    ok,
    summary: ok
      ? `Submitted the ${source.label} signup form for ${email}.`
      : `Failed to submit the ${source.label} signup form.`,
    error: ok ? "" : `unexpected_gravity_form_response:${result.response.status}`,
  };
}

async function executeKitEmbeddedSignup(source: LaunchSource, email: string) {
  if (!source.kitEmbedScriptUrl) {
    return { ok: false, summary: "Missing Kit embed script URL.", error: "missing_kit_script_url" };
  }
  const script = await fetchText(source.kitEmbedScriptUrl);
  const actionUrlMatch = script.text.match(/action=\\?"(https:\/\/app\.kit\.com\/forms\/\d+\/subscriptions)\\?"/i);
  if (!actionUrlMatch?.[1]) {
    return { ok: false, summary: "Kit form action was not found.", error: "kit_form_action_not_found" };
  }
  const redirectMatch = script.text.match(/"redirect_url":"([^"]+)"/i);
  const expectedRedirect = decodeEscapedHtml(redirectMatch?.[1] ?? "");
  const htmlMatch = script.text.match(/"html":"([\s\S]*?)","js"/i);
  const formHtml = htmlMatch?.[1] ? decodeEscapedHtml(htmlMatch[1]) : "";
  const params = new URLSearchParams();
  for (const input of parseInputs(formHtml).filter((entry) => entry.type === "hidden")) {
    params.set(input.name, input.value);
  }
  params.set("email_address", email);
  const result = await fetchText(actionUrlMatch[1], {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const haystack = `${result.response.url} ${stripTags(result.text).toLowerCase()}`;
  const ok =
    result.response.ok &&
    (Boolean(expectedRedirect && result.response.url.includes(expectedRedirect)) ||
      /check your email to confirm|please confirm your subscription|success/i.test(haystack));
  return {
    ok,
    summary: ok
      ? `Submitted the ${source.label} Kit signup for ${email}.`
      : `Failed to submit the ${source.label} Kit signup.`,
    error: ok ? "" : `unexpected_kit_response:${result.response.status}`,
  };
}

async function executeOptInSignup(source: LaunchSource, email: string) {
  if (source.signupMode === "substack_free_form") return executeSubstackFreeSignup(source, email);
  if (source.signupMode === "gravity_form") return executeGravityFormSignup(source, email);
  if (source.signupMode === "kit_embedded_form") return executeKitEmbeddedSignup(source, email);
  return { ok: false, summary: "Unsupported signup mode.", error: "unsupported_signup_mode" };
}

function safeLinkForSource(source: LaunchSource, message: ReplyMessage) {
  if (!source.doi) return "";
  const urls = extractUrls(message.body);
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (!source.doi.linkHostAllowlist.includes(parsed.hostname)) continue;
      if (parsed.pathname.toLowerCase().includes("unsubscribe")) continue;
      if (parsed.pathname.toLowerCase().includes("preferences")) continue;
      return url;
    } catch {
      continue;
    }
  }
  return "";
}

async function clickDoiLink(source: LaunchSource, url: string) {
  const result = await fetchText(url, {
    method: "GET",
  });
  const haystack = `${result.response.url} ${stripTags(result.text).toLowerCase()}`;
  const ok =
    result.response.ok &&
    (source.doi?.successUrlIncludes.some((entry) => haystack.includes(entry.toLowerCase())) ||
      source.doi?.successTextIncludes.some((entry) => haystack.includes(entry.toLowerCase())) ||
      /subscribed|all set|confirmed|check your inbox/.test(haystack));
  return {
    ok,
    summary: ok ? `Confirmed the ${source.label} double opt-in.` : `Failed to confirm the ${source.label} double opt-in.`,
    error: ok ? "" : `unexpected_doi_response:${result.response.status}`,
  };
}

async function scheduleOptInActionsForLaunch(
  launch: SenderLaunch,
  actions: SenderLaunchAction[],
  threads: ReplyThread[]
) {
  if (!isLaunchAutopilotEligible(launch)) return 0;
  const activeOptIns = activeOrCompletedActions(actions).filter((action) => action.lane === "opt_in");
  if (activeOptIns.length >= OPT_IN_PRE_READY_LIMIT) return 0;
  const today = nowIso();
  if (countActionsToday(actions, "opt_in", today) >= optInDailyLimit(launch)) return 0;
  if (activeOptIns.length >= OPT_IN_FIRST_WEEK_LIMIT && ageInDays(launch) < 7) return 0;

  let created = 0;
  const rankedSources = [...LAUNCH_SOURCE_CATALOG]
    .filter((source) => source.active && source.kind === "newsletter")
    .map((source) => ({ source, score: topicMatchScore(launch, source) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return right.source.priority - left.source.priority;
    });

  for (const { source } of rankedSources) {
    if (created >= optInDailyLimit(launch)) break;
    if (actionsForSource(actions, source.key).length > 0) continue;
    const alreadySeenInInbox = threads.some(
      (thread) =>
        thread.sourceType === "mailbox" && source.doi?.senderDomains.includes(emailDomain(thread.contactEmail))
    );
    if (alreadySeenInInbox) continue;
    const action = await createSenderLaunchAction(
      {
        senderLaunchId: launch.id,
        senderAccountId: launch.senderAccountId,
        brandId: launch.brandId,
        lane: "opt_in",
        actionType: "execute_opt_in",
        sourceKey: source.key,
        status: "queued",
        executeAfter: nowIso(),
        attempts: 0,
        maxAttempts: 2,
        payload: {
          sourceKey: source.key,
          sourceLabel: source.label,
          sourceKind: source.kind,
        },
        resultSummary: "",
        lastError: "",
      },
      { allowMissingTable: true }
    );
    actions.unshift(action);
    await recordLaunchEvent(
      launch,
      "opt_in_scheduled",
      "Opt-in source scheduled",
      `${source.label} was queued for automatic signup.`,
      { sourceKey: source.key, sourceLabel: source.label }
    );
    created += 1;
  }
  return created;
}

function sourceByKey(sourceKey: string) {
  return LAUNCH_SOURCE_CATALOG.find((entry) => entry.key === sourceKey) ?? null;
}

async function executeOptInAction(launch: SenderLaunch, action: SenderLaunchAction) {
  const source = sourceByKey(action.sourceKey);
  if (!source) {
    await updateSenderLaunchAction(
      action.id,
      {
        status: "failed",
        attempts: action.attempts + 1,
        lastError: "unknown_source",
        resultSummary: `Source ${action.sourceKey} is not configured.`,
        completedAt: nowIso(),
      },
      { allowMissingTable: true }
    );
    await recordLaunchEvent(launch, "action_failed", "Launch action failed", `Source ${action.sourceKey} is not configured.`, {
      actionId: action.id,
      sourceKey: action.sourceKey,
    });
    return { completed: 0, failed: 1 };
  }
  await updateSenderLaunchAction(action.id, { status: "running" }, { allowMissingTable: true });
  const result = await executeOptInSignup(source, launch.fromEmail);
  if (!result.ok) {
    await updateSenderLaunchAction(
      action.id,
      {
        status: "failed",
        attempts: action.attempts + 1,
        lastError: result.error,
        resultSummary: result.summary,
        completedAt: nowIso(),
      },
      { allowMissingTable: true }
    );
    await recordLaunchEvent(launch, "action_failed", "Launch action failed", result.summary, {
      actionId: action.id,
      sourceKey: source.key,
      lane: action.lane,
      error: result.error,
    });
    return { completed: 0, failed: 1 };
  }
  await updateSenderLaunchAction(
    action.id,
    {
      status: "completed",
      attempts: action.attempts + 1,
      resultSummary: result.summary,
      completedAt: nowIso(),
    },
    { allowMissingTable: true }
  );
  await recordLaunchEvent(launch, "opt_in_completed", "Opt-in signup completed", result.summary, {
    actionId: action.id,
    sourceKey: source.key,
    sourceLabel: source.label,
  });
  if (source.doi?.required) {
    const pendingDoi = await createSenderLaunchAction(
      {
        senderLaunchId: launch.id,
        senderAccountId: launch.senderAccountId,
        brandId: launch.brandId,
        lane: "double_opt_in",
        actionType: "confirm_double_opt_in",
        sourceKey: source.key,
        status: "waiting",
        executeAfter: addMinutes(nowIso(), 5),
        attempts: 0,
        maxAttempts: 12,
        payload: {
          sourceKey: source.key,
          sourceLabel: source.label,
        },
        resultSummary: `Waiting for the ${source.label} confirmation email.`,
        lastError: "",
      },
      { allowMissingTable: true }
    );
    return { completed: 1, failed: 0, followUpAction: pendingDoi };
  }
  return { completed: 1, failed: 0 };
}

async function executeDoubleOptInAction(
  launch: SenderLaunch,
  action: SenderLaunchAction,
  threads: ReplyThread[]
) {
  const source = sourceByKey(action.sourceKey);
  if (!source?.doi) {
    await updateSenderLaunchAction(
      action.id,
      {
        status: "skipped",
        resultSummary: "No DOI config exists for this source.",
        completedAt: nowIso(),
      },
      { allowMissingTable: true }
    );
    return { completed: 0, failed: 0 };
  }

  const relevantThreads = threads
    .filter((thread) => thread.sourceType === "mailbox")
    .filter((thread) => source.doi?.senderDomains.includes(emailDomain(thread.contactEmail)))
    .sort((left, right) => (left.lastMessageAt < right.lastMessageAt ? 1 : -1));

  for (const thread of relevantThreads) {
    const messages = await listReplyMessagesByThread(thread.id);
    const inbound = messages
      .filter((message) => message.direction === "inbound")
      .sort((left, right) => (left.receivedAt < right.receivedAt ? 1 : -1));
    const confirmationMessage = inbound.find((message) => {
      const subject = message.subject.toLowerCase();
      const body = stripQuotedPrintableSoftBreaks(message.body).toLowerCase();
      return (
        source.doi?.subjectIncludes.some((entry) => subject.includes(entry.toLowerCase())) ||
        source.doi?.subjectIncludes.some((entry) => body.includes(entry.toLowerCase())) ||
        /confirm your subscription|confirm subscription|please confirm/.test(subject)
      );
    });
    if (!confirmationMessage) continue;

    const alreadyTracked = String(action.payload.confirmationThreadId ?? "").trim();
    if (!alreadyTracked) {
      await updateSenderLaunchAction(
        action.id,
        {
          status: "waiting",
          payload: {
            ...action.payload,
            confirmationThreadId: thread.id,
            confirmationMessageId: confirmationMessage.id,
          },
          resultSummary: `Confirmation email from ${thread.contactEmail} is ready to be clicked.`,
        },
        { allowMissingTable: true }
      );
      await recordLaunchEvent(
        launch,
        "double_opt_in_received",
        "Double opt-in email received",
        `${source.label} sent a confirmation email to ${launch.fromEmail}.`,
        {
          actionId: action.id,
          threadId: thread.id,
          sourceKey: source.key,
        },
        confirmationMessage.receivedAt
      );
    }

    const link = safeLinkForSource(source, confirmationMessage);
    if (!link) {
      await updateSenderLaunchAction(
        action.id,
        {
          status: "failed",
          attempts: action.attempts + 1,
          lastError: "safe_confirmation_link_not_found",
          resultSummary: `A confirmation email arrived from ${source.label}, but no safe confirmation link was found.`,
          completedAt: nowIso(),
        },
        { allowMissingTable: true }
      );
      await recordLaunchEvent(launch, "action_failed", "Launch action failed", `No safe confirmation link was found for ${source.label}.`, {
        actionId: action.id,
        sourceKey: source.key,
      });
      return { completed: 0, failed: 1 };
    }

    await updateSenderLaunchAction(action.id, { status: "running" }, { allowMissingTable: true });
    const clickResult = await clickDoiLink(source, link);
    if (!clickResult.ok) {
      await updateSenderLaunchAction(
        action.id,
        {
          status: "failed",
          attempts: action.attempts + 1,
          lastError: clickResult.error,
          resultSummary: clickResult.summary,
          completedAt: nowIso(),
        },
        { allowMissingTable: true }
      );
      await recordLaunchEvent(launch, "action_failed", "Launch action failed", clickResult.summary, {
        actionId: action.id,
        sourceKey: source.key,
      });
      return { completed: 0, failed: 1 };
    }
    await updateSenderLaunchAction(
      action.id,
      {
        status: "completed",
        attempts: action.attempts + 1,
        resultSummary: clickResult.summary,
        completedAt: nowIso(),
      },
      { allowMissingTable: true }
    );
    await recordLaunchEvent(
      launch,
      "double_opt_in_confirmed",
      "Double opt-in confirmed",
      clickResult.summary,
      {
        actionId: action.id,
        sourceKey: source.key,
        confirmationThreadId: thread.id,
      },
      nowIso()
    );
    return { completed: 1, failed: 0 };
  }

  const expiresAt = addHours(action.createdAt, DOUBLE_OPT_IN_TIMEOUT_HOURS);
  if (Date.parse(expiresAt) <= Date.now()) {
    await updateSenderLaunchAction(
      action.id,
      {
        status: "failed",
        attempts: action.attempts + 1,
        lastError: "confirmation_email_timeout",
        resultSummary: `No ${source.label} confirmation email arrived within ${DOUBLE_OPT_IN_TIMEOUT_HOURS} hours.`,
        completedAt: nowIso(),
      },
      { allowMissingTable: true }
    );
    await recordLaunchEvent(launch, "action_failed", "Launch action failed", `No ${source.label} confirmation email arrived in time.`, {
      actionId: action.id,
      sourceKey: source.key,
    });
    return { completed: 0, failed: 1 };
  }

  await updateSenderLaunchAction(
    action.id,
    {
      status: "waiting",
      attempts: action.attempts,
      executeAfter: addMinutes(nowIso(), DOUBLE_OPT_IN_POLL_MINUTES),
      resultSummary: `Still waiting for the ${source.label} confirmation email.`,
    },
    { allowMissingTable: true }
  );
  return { completed: 0, failed: 0 };
}

async function processDueActionsForLaunch(
  launch: SenderLaunch,
  actions: SenderLaunchAction[],
  threads: ReplyThread[]
) {
  let completed = 0;
  let failed = 0;
  const dueActions = actions
    .filter((action) => ["queued", "waiting"].includes(action.status))
    .filter((action) => Date.parse(action.executeAfter || action.createdAt) <= Date.now())
    .sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1));

  for (const action of dueActions) {
    if (action.lane === "double_opt_in") {
      if (countActionsToday(actions, "double_opt_in", nowIso()) > DOUBLE_OPT_IN_DAILY_LIMIT) continue;
      const result = await executeDoubleOptInAction(launch, action, threads);
      completed += result.completed;
      failed += result.failed;
      continue;
    }
    if (action.lane === "opt_in") {
      const result = await executeOptInAction(launch, action);
      completed += result.completed;
      failed += result.failed;
      if (result.followUpAction) actions.unshift(result.followUpAction);
      continue;
    }
    if (action.lane === "inquiry" && AUTOPILOT_INQUIRY_LANE_ENABLED) {
      // Intentionally conservative in the first cut.
      continue;
    }
  }

  return { completed, failed };
}

export async function runSenderLaunchAutopilotForBrand(input: {
  brandId: string;
  launches: SenderLaunch[];
}): Promise<AutopilotResult> {
  const [allActions, replyThreadResult] = await Promise.all([
    listSenderLaunchActions({ brandId: input.brandId }, { allowMissingTable: true }),
    listReplyThreadsByBrand(input.brandId),
  ]);

  let actionsScheduled = 0;
  let actionsCompleted = 0;
  let actionsFailed = 0;

  for (const launch of input.launches) {
    const launchActions = allActions.filter((action) => action.senderLaunchId === launch.id);
    const processedExisting = await processDueActionsForLaunch(launch, launchActions, replyThreadResult.threads);
    actionsCompleted += processedExisting.completed;
    actionsFailed += processedExisting.failed;

    const scheduled = await scheduleOptInActionsForLaunch(launch, launchActions, replyThreadResult.threads);
    actionsScheduled += scheduled;

    const processedQueued = await processDueActionsForLaunch(launch, launchActions, replyThreadResult.threads);
    actionsCompleted += processedQueued.completed;
    actionsFailed += processedQueued.failed;
  }

  return {
    actionsScheduled,
    actionsCompleted,
    actionsFailed,
  };
}
