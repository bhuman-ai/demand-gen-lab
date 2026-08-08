import type { BrandRecord, LeadRow, OutreachMessage, OutreachRunLead, ReplyThread } from "@/lib/factory-types";
import { listBrandMessages, listBrandRunLeads, listReplyThreadsByBrand } from "@/lib/outreach-data";

export type AudienceContactStatus =
  | "new"
  | "scheduled"
  | "contacted"
  | "replied"
  | "qualified"
  | "closed"
  | "suppressed"
  | "failed"
  | "bounced"
  | "unsubscribed";

export type AudienceContactSource = "manual" | "outbound" | "reply";

export type AudienceContact = {
  id: string;
  name: string;
  email: string;
  title: string;
  company: string;
  domain: string;
  sources: AudienceContactSource[];
  status: AudienceContactStatus;
  lastTouch: string;
  firstSeenAt: string;
  attempts: number;
  sentCount: number;
  scheduledCount: number;
  failedCount: number;
  replyCount: number;
  lastSubject: string;
  replyIntent: ReplyThread["intent"] | "";
  replySentiment: ReplyThread["sentiment"] | "";
};

export type BrandAudienceSnapshot = {
  generatedAt: string;
  contacts: AudienceContact[];
};

type MutableAudienceContact = AudienceContact & {
  statusRank: number;
  sourceSet: Set<AudienceContactSource>;
};

const STATUS_RANK: Record<AudienceContactStatus, number> = {
  new: 0,
  scheduled: 1,
  suppressed: 1,
  failed: 2,
  bounced: 2,
  contacted: 3,
  unsubscribed: 4,
  closed: 5,
  qualified: 6,
  replied: 7,
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeEmail(value: unknown) {
  return clean(value).toLowerCase();
}

function contactKey(input: { email?: string; leadId?: string; fallbackId: string }) {
  const email = normalizeEmail(input.email);
  if (email) return `email:${email}`;
  const leadId = clean(input.leadId);
  if (leadId) return `lead:${leadId}`;
  return input.fallbackId;
}

function betterName(next: string, current: string) {
  const normalizedNext = clean(next);
  if (!normalizedNext) return current;
  if (!current) return normalizedNext;
  return normalizedNext.length > current.length ? normalizedNext : current;
}

function isLater(next: string, current: string) {
  if (!next) return false;
  if (!current) return true;
  return new Date(next).getTime() > new Date(current).getTime();
}

function applyStatus(contact: MutableAudienceContact, status: AudienceContactStatus) {
  const rank = STATUS_RANK[status] ?? 0;
  if (rank >= contact.statusRank) {
    contact.status = status;
    contact.statusRank = rank;
  }
}

function manualStatus(status: LeadRow["status"]): AudienceContactStatus {
  if (status === "contacted") return "contacted";
  if (status === "qualified") return "qualified";
  if (status === "closed") return "closed";
  return "new";
}

function runLeadStatus(status: OutreachRunLead["status"]): AudienceContactStatus {
  if (status === "scheduled") return "scheduled";
  if (status === "sent") return "contacted";
  if (status === "replied") return "replied";
  if (status === "bounced") return "bounced";
  if (status === "unsubscribed") return "unsubscribed";
  if (status === "suppressed") return "suppressed";
  return "new";
}

function messageStatus(status: OutreachMessage["status"]): AudienceContactStatus | null {
  if (status === "scheduled") return "scheduled";
  if (status === "sent") return "contacted";
  if (status === "replied") return "replied";
  if (status === "failed") return "failed";
  if (status === "bounced") return "bounced";
  return null;
}

function createContact(key: string, source: AudienceContactSource): MutableAudienceContact {
  return {
    id: key,
    name: "",
    email: "",
    title: "",
    company: "",
    domain: "",
    sources: [source],
    sourceSet: new Set([source]),
    status: "new",
    statusRank: STATUS_RANK.new,
    lastTouch: "",
    firstSeenAt: "",
    attempts: 0,
    sentCount: 0,
    scheduledCount: 0,
    failedCount: 0,
    replyCount: 0,
    lastSubject: "",
    replyIntent: "",
    replySentiment: "",
  };
}

function upsertContact(
  contacts: Map<string, MutableAudienceContact>,
  key: string,
  source: AudienceContactSource
) {
  const current = contacts.get(key);
  if (current) {
    current.sourceSet.add(source);
    current.sources = [...current.sourceSet];
    return current;
  }
  const next = createContact(key, source);
  contacts.set(key, next);
  return next;
}

function touch(contact: MutableAudienceContact, date: string, subject?: string) {
  const normalized = clean(date);
  if (!contact.firstSeenAt || (normalized && normalized < contact.firstSeenAt)) {
    contact.firstSeenAt = normalized;
  }
  if (isLater(normalized, contact.lastTouch)) {
    contact.lastTouch = normalized;
    if (subject !== undefined) contact.lastSubject = clean(subject);
  } else if (!contact.lastSubject && subject !== undefined) {
    contact.lastSubject = clean(subject);
  }
}

function fillFromRunLead(contact: MutableAudienceContact, lead: OutreachRunLead) {
  contact.email ||= clean(lead.email);
  contact.name = betterName(lead.name, contact.name);
  contact.title ||= clean(lead.title);
  contact.company ||= clean(lead.company);
  contact.domain ||= clean(lead.domain);
  applyStatus(contact, runLeadStatus(lead.status));
  touch(contact, lead.updatedAt || lead.createdAt);
}

function fillFromThread(contact: MutableAudienceContact, thread: ReplyThread) {
  contact.email ||= clean(thread.contactEmail);
  contact.name = betterName(thread.contactName, contact.name);
  contact.company ||= clean(thread.contactCompany);
  contact.replyIntent = thread.intent;
  contact.replySentiment = thread.sentiment;
  contact.replyCount += 1;
  applyStatus(contact, thread.intent === "unsubscribe" ? "unsubscribed" : "replied");
  touch(contact, thread.lastMessageAt || thread.updatedAt || thread.createdAt, thread.subject);
}

export async function buildBrandAudienceSnapshot(brand: BrandRecord): Promise<BrandAudienceSnapshot> {
  const [runLeads, messages, replyState] = await Promise.all([
    listBrandRunLeads(brand.id),
    listBrandMessages(brand.id),
    listReplyThreadsByBrand(brand.id),
  ]);

  const contacts = new Map<string, MutableAudienceContact>();
  const leadIdToKey = new Map<string, string>();

  for (const lead of brand.leads ?? []) {
    const key = contactKey({ fallbackId: `manual:${lead.id}` });
    const contact = upsertContact(contacts, key, "manual");
    contact.name = betterName(lead.name, contact.name);
    contact.domain ||= clean(lead.channel);
    applyStatus(contact, manualStatus(lead.status));
    touch(contact, lead.lastTouch);
  }

  for (const lead of runLeads) {
    const key = contactKey({ email: lead.email, leadId: lead.id, fallbackId: `run-lead:${lead.id}` });
    leadIdToKey.set(lead.id, key);
    const contact = upsertContact(contacts, key, "outbound");
    fillFromRunLead(contact, lead);
  }

  for (const message of messages) {
    const key = leadIdToKey.get(message.leadId);
    if (!key) continue;
    const contact = upsertContact(contacts, key, "outbound");
    if (message.status !== "canceled") contact.attempts += 1;
    if (message.status === "sent" || message.status === "replied") contact.sentCount += 1;
    if (message.status === "scheduled") contact.scheduledCount += 1;
    if (message.status === "failed" || message.status === "bounced") contact.failedCount += 1;
    const status = messageStatus(message.status);
    if (status) applyStatus(contact, status);
    touch(contact, message.sentAt || message.scheduledAt || message.updatedAt || message.createdAt, message.subject);
  }

  for (const thread of replyState.threads) {
    const key = contactKey({
      email: thread.contactEmail,
      leadId: thread.leadId,
      fallbackId: `reply:${thread.id}`,
    });
    const contact = upsertContact(contacts, key, "reply");
    fillFromThread(contact, thread);
  }

  const contactsList = [...contacts.values()]
    .map((contact): AudienceContact => ({
      id: contact.id,
      name: contact.name || contact.email || contact.company || "Unknown person",
      email: contact.email,
      title: contact.title,
      company: contact.company,
      domain: contact.domain,
      sources: contact.sources.sort(),
      status: contact.status,
      lastTouch: contact.lastTouch,
      firstSeenAt: contact.firstSeenAt,
      attempts: contact.attempts,
      sentCount: contact.sentCount,
      scheduledCount: contact.scheduledCount,
      failedCount: contact.failedCount,
      replyCount: contact.replyCount,
      lastSubject: contact.lastSubject,
      replyIntent: contact.replyIntent,
      replySentiment: contact.replySentiment,
    }))
    .sort((left, right) => {
      const leftTime = left.lastTouch ? new Date(left.lastTouch).getTime() : 0;
      const rightTime = right.lastTouch ? new Date(right.lastTouch).getTime() : 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return left.name.localeCompare(right.name);
    });

  return {
    generatedAt: new Date().toISOString(),
    contacts: contactsList,
  };
}
