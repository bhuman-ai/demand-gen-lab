import crypto from "crypto";
import type {
  MailpoolInboxPlacementProvider,
  MailpoolMailboxType,
} from "@/lib/factory-types";

const DEFAULT_MAILPOOL_API_BASE_URL = "https://app.mailpool.io/v1/api";

type MailpoolRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  apiKey: string;
  path: string;
  body?: unknown;
};

export type MailpoolDomainOwner = {
  company: string;
  firstName: string;
  lastName: string;
  email: string;
  streetAddress1: string;
  streetAddress2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type MailpoolDomain = {
  id: string;
  createdAt: string;
  domain: string;
  domainOwner?: MailpoolDomainOwner & { id?: string };
  redirectUrl?: string;
  status: string;
  type?: string;
  expireAt?: string;
  nameservers?: string[];
};

export type MailpoolDnsRecord = {
  type: string;
  key: string;
  value: string;
  ttl?: number;
  priority?: number;
  weight?: number;
  port?: number | string;
};

export type MailpoolMailbox = {
  id: string;
  type: MailpoolMailboxType;
  email: string;
  domain?: MailpoolDomain;
  firstName: string;
  lastName: string;
  signature?: string;
  forwardTo?: string;
  password?: string;
  status?: string;
  avatar?: string;
  avatarUrl?: string;
  imapHost?: string;
  imapPort?: number | string;
  imapTLS?: boolean;
  imapUsername?: string;
  imapPassword?: string;
  smtpHost?: string;
  smtpPort?: number | string;
  smtpTLS?: boolean;
  smtpUsername?: string;
  smtpPassword?: string;
  isAdmin?: boolean;
};

export type MailpoolSpamCheck = {
  id: string;
  createdAt: string;
  email?: string;
  fromEmail: string;
  state: "pending" | "completed";
  result?: {
    subject?: string;
    fromEmail?: string;
    score?: number;
  } & Record<string, unknown>;
  mailbox?: MailpoolMailbox;
};

export type MailpoolInboxPlacement = {
  id: string;
  createdAt: string;
  insertInBody: string;
  emails?: string[];
  fromEmail: string;
  state: "pending" | "completed";
  result?: {
    checks?: Array<{
      provider?: MailpoolInboxPlacementProvider;
      email?: string;
      mailboxId?: string;
      placement?: "inbox" | "promotion" | "spam" | "unreceived";
      spf?: string;
      dkim?: string;
      dmarc?: string;
      ip?: string;
      deliveredIn?: number;
    }>;
    stats?: {
      inbox?: number;
      promotion?: number;
      spam?: number;
      undelivered?: number;
    };
  };
};

export type MailpoolWebhookEvent = {
  type: string;
  domain?: MailpoolDomain;
  mailbox?: MailpoolMailbox;
} & Record<string, unknown>;

export type MailpoolSubscriptionSlotType = "google" | "private" | "outlook";

type MailpoolSubscriptionSlotCounters = {
  google: number;
  private: number;
  outlook: number;
  shared: number;
};

export type MailpoolSubscriptionSlots = {
  mailboxes: MailpoolSubscriptionSlotCounters;
  slots: MailpoolSubscriptionSlotCounters;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOrString(value: unknown): number | string | undefined {
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mailpoolApiBaseUrl() {
  return String(process.env.MAILPOOL_API_BASE_URL ?? DEFAULT_MAILPOOL_API_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
}

function mailpoolHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "X-Api-Authorization": apiKey.trim(),
  };
}

async function mailpoolRequest<T>(options: MailpoolRequestOptions): Promise<T> {
  const response = await fetch(`${mailpoolApiBaseUrl()}${options.path}`, {
    method: options.method ?? "GET",
    headers: mailpoolHeaders(options.apiKey),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  const raw = await response.text();
  const payload = raw
    ? (() => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return raw as unknown;
        }
      })()
    : null;
  if (!response.ok) {
    const detailSource =
      typeof payload === "string"
        ? payload
        : (() => {
            const record = asRecord(payload);
            const candidate = record.message ?? record.error ?? raw ?? "";
            return typeof candidate === "string" ? candidate : JSON.stringify(candidate);
          })();
    const detail = String(detailSource ?? "").trim();
    throw new Error(`Mailpool ${options.method ?? "GET"} ${options.path} failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return payload as T;
}

function mapDomain(input: unknown): MailpoolDomain {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    createdAt: String(row.createdAt ?? row.created_at ?? "").trim(),
    domain: String(row.domain ?? "").trim().toLowerCase(),
    domainOwner: row.domainOwner ? (asRecord(row.domainOwner) as MailpoolDomain["domainOwner"]) : undefined,
    redirectUrl: String(row.redirectUrl ?? row.redirect_url ?? "").trim() || undefined,
    status: String(row.status ?? "").trim().toLowerCase(),
    type: String(row.type ?? "").trim().toLowerCase() || undefined,
    expireAt: String(row.expireAt ?? row.expire_at ?? "").trim() || undefined,
    nameservers: asArray(row.nameservers).map((entry) => String(entry ?? "").trim()).filter(Boolean),
  };
}

function mapMailbox(input: unknown): MailpoolMailbox {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    type: (String(row.type ?? "google").trim().toLowerCase() as MailpoolMailboxType) || "google",
    email: String(row.email ?? "").trim().toLowerCase(),
    domain: row.domain ? mapDomain(row.domain) : undefined,
    firstName: String(row.firstName ?? row.first_name ?? "").trim(),
    lastName: String(row.lastName ?? row.last_name ?? "").trim(),
    signature: String(row.signature ?? "").trim() || undefined,
    forwardTo: String(row.forwardTo ?? row.forward_to ?? "").trim() || undefined,
    password: String(row.password ?? "").trim() || undefined,
    status: String(row.status ?? "").trim() || undefined,
    avatar: String(row.avatar ?? row.avatarUrl ?? row.avatar_url ?? "").trim() || undefined,
    avatarUrl: String(row.avatarUrl ?? row.avatar_url ?? "").trim() || undefined,
    imapHost: String(row.imapHost ?? row.imap_host ?? "").trim() || undefined,
    imapPort: numberOrString(row.imapPort ?? row.imap_port),
    imapTLS: typeof row.imapTLS === "boolean" ? row.imapTLS : Boolean(row.imap_tls),
    imapUsername: String(row.imapUsername ?? row.imap_username ?? "").trim() || undefined,
    imapPassword: String(row.imapPassword ?? row.imap_password ?? "").trim() || undefined,
    smtpHost: String(row.smtpHost ?? row.smtp_host ?? "").trim() || undefined,
    smtpPort: numberOrString(row.smtpPort ?? row.smtp_port),
    smtpTLS: typeof row.smtpTLS === "boolean" ? row.smtpTLS : Boolean(row.smtp_tls),
    smtpUsername: String(row.smtpUsername ?? row.smtp_username ?? "").trim() || undefined,
    smtpPassword: String(row.smtpPassword ?? row.smtp_password ?? "").trim() || undefined,
    isAdmin: typeof row.isAdmin === "boolean" ? row.isAdmin : undefined,
  };
}

function mapSpamCheck(input: unknown): MailpoolSpamCheck {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    createdAt: String(row.createdAt ?? row.created_at ?? "").trim(),
    email: String(row.email ?? "").trim() || undefined,
    fromEmail: String(row.fromEmail ?? row.from_email ?? "").trim().toLowerCase(),
    state: String(row.state ?? "").trim().toLowerCase() === "completed" ? "completed" : "pending",
    result: row.result ? ({ ...asRecord(row.result) } as MailpoolSpamCheck["result"]) : undefined,
    mailbox: row.mailbox ? mapMailbox(row.mailbox) : undefined,
  };
}

function mapInboxPlacement(input: unknown): MailpoolInboxPlacement {
  const row = asRecord(input);
  const result = asRecord(row.result);
  const stats = asRecord(result.stats);
  return {
    id: String(row.id ?? "").trim(),
    createdAt: String(row.createdAt ?? row.created_at ?? "").trim(),
    insertInBody: String(row.insertInBody ?? row.insert_in_body ?? "").trim(),
    emails: asArray(row.emails).map((entry) => String(entry ?? "").trim().toLowerCase()).filter(Boolean),
    fromEmail: String(row.fromEmail ?? row.from_email ?? "").trim().toLowerCase(),
    state: String(row.state ?? "").trim().toLowerCase() === "completed" ? "completed" : "pending",
    result: row.result
      ? {
          checks: asArray(result.checks).map((entry) => {
            const check = asRecord(entry);
            return {
              provider: String(check.provider ?? "").trim() as MailpoolInboxPlacementProvider,
              email: String(check.email ?? "").trim().toLowerCase() || undefined,
              mailboxId: String(check.mailboxId ?? check.mailbox_id ?? "").trim() || undefined,
              placement: String(check.placement ?? "").trim() as
                | "inbox"
                | "promotion"
                | "spam"
                | "unreceived",
              spf: String(check.spf ?? "").trim() || undefined,
              dkim: String(check.dkim ?? "").trim() || undefined,
              dmarc: String(check.dmarc ?? "").trim() || undefined,
              ip: String(check.ip ?? "").trim() || undefined,
              deliveredIn: Number(check.deliveredIn ?? check.delivered_in ?? 0) || undefined,
            };
          }),
          stats: {
            inbox: Number(stats.inbox ?? 0) || 0,
            promotion: Number(stats.promotion ?? 0) || 0,
            spam: Number(stats.spam ?? 0) || 0,
            undelivered: Number(stats.undelivered ?? 0) || 0,
          },
        }
      : undefined,
  };
}

function mapSubscriptionSlotCounters(input: unknown): MailpoolSubscriptionSlots["mailboxes"] {
  const row = asRecord(input);
  return {
    google: numberValue(row.google),
    private: numberValue(row.private),
    outlook: numberValue(row.outlook),
    shared: numberValue(row.shared),
  };
}

function mapSubscriptionSlots(input: unknown): MailpoolSubscriptionSlots {
  const row = asRecord(input);
  return {
    mailboxes: mapSubscriptionSlotCounters(row.mailboxes),
    slots: mapSubscriptionSlotCounters(row.slots),
  };
}

export async function testMailpoolConnection(apiKey: string) {
  await listMailpoolDomains(apiKey);
  return {
    ok: true,
    message: "Mailpool connection passed",
  };
}

export async function listMailpoolDomains(apiKey: string) {
  const payload = await mailpoolRequest<unknown>({
    apiKey,
    path: "/domains/?limit=100&offset=0",
  });
  return asArray(asRecord(payload).data).map((entry) => mapDomain(entry)).filter((entry) => entry.domain);
}

export async function getMailpoolSubscriptionSlots(apiKey: string) {
  const payload = await mailpoolRequest<unknown>({
    apiKey,
    path: "/subscriptions/slots",
  });
  return mapSubscriptionSlots(payload);
}

export async function updateMailpoolSubscriptionSlots(input: {
  apiKey: string;
  type: MailpoolSubscriptionSlotType;
  quantity: number;
}) {
  await mailpoolRequest<unknown>({
    apiKey: input.apiKey,
    method: "POST",
    path: "/subscriptions/update-slots",
    body: {
      type: input.type,
      quantity: Math.max(0, Math.round(input.quantity)),
    },
  });
  return getMailpoolSubscriptionSlots(input.apiKey);
}

export async function registerMailpoolDomain(input: {
  apiKey: string;
  domain: string;
  type?: MailpoolMailboxType;
  redirectUrl?: string;
  domainOwner: MailpoolDomainOwner;
}) {
  const payload = await mailpoolRequest<unknown[]>({
    apiKey: input.apiKey,
    method: "POST",
    path: "/domains/",
    body: {
      domains: [input.domain.trim().toLowerCase()],
      redirect: input.redirectUrl?.trim() || undefined,
      newDomainOwner: input.domainOwner,
    },
  });
  const created = asArray(payload).map((entry) => mapDomain(entry)).find((entry) => entry.domain);
  if (!created) {
    throw new Error("Mailpool domain registration did not return a domain record");
  }
  return created;
}

export async function getMailpoolDomainDns(apiKey: string, domainId: string) {
  return mailpoolRequest<Record<string, unknown>>({
    apiKey,
    path: `/domains/${encodeURIComponent(domainId)}/dns`,
  });
}

export async function updateMailpoolDomainDns(input: {
  apiKey: string;
  domainId: string;
  records: unknown;
}) {
  return mailpoolRequest<Record<string, unknown>>({
    apiKey: input.apiKey,
    method: "PUT",
    path: `/domains/${encodeURIComponent(input.domainId)}/dns`,
    body: input.records,
  });
}

export async function listMailpoolMailboxes(apiKey: string) {
  const payload = await mailpoolRequest<unknown>({
    apiKey,
    path: "/mailboxes?limit=100&offset=0",
  });
  return asArray(asRecord(payload).data).map((entry) => mapMailbox(entry)).filter((entry) => entry.email);
}

export async function createMailpoolMailbox(input: {
  apiKey: string;
  email: string;
  firstName: string;
  lastName: string;
  signature?: string;
  forwardTo?: string;
  type: MailpoolMailboxType;
}) {
  const payload = await mailpoolRequest<unknown>({
    apiKey: input.apiKey,
    method: "POST",
    path: "/mailboxes",
    body: [
      {
        email: input.email.trim().toLowerCase(),
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        signature: input.signature?.trim() || undefined,
        forwardTo: input.forwardTo?.trim() || undefined,
        type: input.type,
      },
    ],
  });
  const created = asArray(asRecord(payload).emails).map((entry) => mapMailbox(entry)).find((entry) => entry.email);
  if (!created) {
    throw new Error("Mailpool mailbox creation did not return a mailbox record");
  }
  return created;
}

export async function getMailpoolMailbox(apiKey: string, mailboxId: string) {
  const payload = await mailpoolRequest<unknown>({
    apiKey,
    path: `/mailboxes/${encodeURIComponent(mailboxId)}`,
  });
  return mapMailbox(payload);
}

export async function updateMailpoolMailbox(input: {
  apiKey: string;
  mailboxId: string;
  patch: Record<string, unknown>;
}) {
  const payload = await mailpoolRequest<unknown>({
    apiKey: input.apiKey,
    method: "PUT",
    path: `/mailboxes/${encodeURIComponent(input.mailboxId)}`,
    body: input.patch,
  });
  return mapMailbox(payload);
}

export async function deleteMailpoolMailbox(apiKey: string, mailboxId: string) {
  await mailpoolRequest<unknown>({
    apiKey,
    method: "DELETE",
    path: `/mailboxes/${encodeURIComponent(mailboxId)}`,
  });
}

export async function createMailpoolSpamCheck(input: { apiKey: string; mailboxId: string }) {
  const payload = await mailpoolRequest<unknown>({
    apiKey: input.apiKey,
    method: "POST",
    path: "/spam-checks/",
    body: { mailboxId: input.mailboxId },
  });
  return mapSpamCheck(payload);
}

export async function getMailpoolSpamCheck(apiKey: string, spamCheckId: string) {
  const payload = await mailpoolRequest<unknown>({
    apiKey,
    path: `/spam-checks/${encodeURIComponent(spamCheckId)}`,
  });
  return mapSpamCheck(payload);
}

export async function deleteMailpoolSpamCheck(apiKey: string, spamCheckId: string) {
  await mailpoolRequest<unknown>({
    apiKey,
    method: "DELETE",
    path: `/spam-checks/${encodeURIComponent(spamCheckId)}`,
  });
}

export async function createMailpoolInboxPlacement(input: {
  apiKey: string;
  mailboxId: string;
  providers: MailpoolInboxPlacementProvider[];
}) {
  const payload = await mailpoolRequest<unknown>({
    apiKey: input.apiKey,
    method: "POST",
    path: "/inbox-placements/",
    body: {
      mailboxId: input.mailboxId,
      providers: input.providers,
    },
  });
  return mapInboxPlacement(payload);
}

export async function getMailpoolInboxPlacement(apiKey: string, inboxPlacementId: string) {
  const payload = await mailpoolRequest<unknown>({
    apiKey,
    path: `/inbox-placements/${encodeURIComponent(inboxPlacementId)}`,
  });
  return mapInboxPlacement(payload);
}

export async function runMailpoolInboxPlacement(apiKey: string, inboxPlacementId: string) {
  const payload = await mailpoolRequest<unknown>({
    apiKey,
    method: "POST",
    path: `/inbox-placements/${encodeURIComponent(inboxPlacementId)}/run`,
  });
  return mapInboxPlacement(payload);
}

export async function deleteMailpoolInboxPlacement(apiKey: string, inboxPlacementId: string) {
  await mailpoolRequest<unknown>({
    apiKey,
    method: "DELETE",
    path: `/inbox-placements/${encodeURIComponent(inboxPlacementId)}`,
  });
}

function constantTimeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyMailpoolWebhookSignature(input: {
  rawBody: string;
  secret: string;
  headers: Headers;
}) {
  const secret = input.secret.trim();
  if (!secret) return false;
  const provided = [
    input.headers.get("x-webhook-signature"),
    input.headers.get("x-signature"),
    input.headers.get("signature"),
    input.headers.get("x-mailpool-signature"),
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (!provided.length) return false;

  const hex = crypto.createHmac("sha256", secret).update(input.rawBody).digest("hex");
  const base64 = crypto.createHmac("sha256", secret).update(input.rawBody).digest("base64");
  const candidates = new Set([hex, base64, `sha256=${hex}`, `sha256=${base64}`]);

  return provided.some((value) => Array.from(candidates).some((candidate) => constantTimeEquals(value, candidate)));
}

export function parseMailpoolWebhookEvent(raw: string): MailpoolWebhookEvent {
  const payload = raw ? (JSON.parse(raw) as unknown) : {};
  const row = asRecord(payload);
  return {
    ...row,
    type: String(row.type ?? "").trim(),
    domain: row.domain ? mapDomain(row.domain) : undefined,
    mailbox: row.mailbox ? mapMailbox(row.mailbox) : undefined,
  };
}
