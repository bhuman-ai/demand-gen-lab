import type { OutreachAccount, OutreachMessage, ReplyDraft } from "@/lib/factory-types";
import type { OutreachAccountSecrets } from "@/lib/outreach-data";

export type ProviderTestResult = {
  ok: boolean;
  scope: ProviderTestScope;
  checks: {
    customerIo: "pass" | "fail";
    apify: "pass" | "fail";
    mailbox: "pass" | "fail";
  };
  message: string;
};

export type ProviderTestScope = "full" | "customerio" | "mailbox";

export type ApifyLead = {
  email: string;
  name: string;
  company: string;
  title: string;
  domain: string;
  sourceUrl: string;
};

function maybeDomain(email: string, fallback: string) {
  const parts = email.split("@");
  if (parts.length === 2) return parts[1].toLowerCase();
  return fallback.trim().toLowerCase();
}

function customerIoApiKey(secrets: OutreachAccountSecrets) {
  return (
    secrets.customerIoApiKey.trim() ||
    secrets.customerIoTrackApiKey.trim() ||
    secrets.customerIoAppApiKey.trim()
  );
}

function sourcingToken(secrets: OutreachAccountSecrets) {
  return secrets.apifyToken.trim() || String(process.env.APIFY_TOKEN ?? "").trim();
}

function normalizeApifyLead(raw: unknown): ApifyLead | null {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const email = String(
    row.email ?? row.workEmail ?? row.businessEmail ?? row.contactEmail ?? row.emailAddress ?? ""
  )
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) {
    return null;
  }

  const name = String(row.name ?? row.fullName ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`).trim();
  const company = String(row.company ?? row.companyName ?? row.organization ?? "").trim();
  const title = String(row.title ?? row.jobTitle ?? "").trim();
  const sourceUrl = String(row.url ?? row.profileUrl ?? row.linkedinUrl ?? row.website ?? "").trim();

  return {
    email,
    name,
    company,
    title,
    domain: maybeDomain(email, String(row.domain ?? "")),
    sourceUrl,
  };
}

export async function testOutreachProviders(
  account: OutreachAccount,
  secrets: OutreachAccountSecrets,
  scope: ProviderTestScope = "full"
): Promise<ProviderTestResult> {
  const requiresDelivery = account.accountType !== "mailbox";
  const requiresMailbox = account.accountType !== "delivery";
  const shouldTestCustomerIo = scope === "full" || scope === "customerio";
  const shouldTestMailbox = scope === "full" || scope === "mailbox";
  const shouldTestSourcing = scope === "full";

  const rawCustomerIoPass = requiresDelivery
    ? Boolean(account.config.customerIo.siteId && account.config.customerIo.workspaceId && customerIoApiKey(secrets))
    : true;

  const rawSourcingPass = requiresDelivery ? Boolean(sourcingToken(secrets)) : true;
  const rawMailboxPass = requiresMailbox
    ? Boolean(account.config.mailbox.email && (secrets.mailboxAccessToken || secrets.mailboxPassword))
    : true;

  const customerIoPass = shouldTestCustomerIo ? rawCustomerIoPass : true;
  const apifyPass = shouldTestSourcing ? rawSourcingPass : true;
  const mailboxPass = shouldTestMailbox ? rawMailboxPass : true;

  const message =
    scope === "customerio"
      ? customerIoPass
        ? "Customer.io check passed"
        : "Customer.io check failed"
      : scope === "mailbox"
        ? mailboxPass
          ? "Mailbox check passed"
          : "Mailbox check failed"
        : customerIoPass && apifyPass && mailboxPass
          ? "All checks passed"
          : "One or more checks failed";

  return {
    ok: customerIoPass && apifyPass && mailboxPass,
    scope,
    checks: {
      customerIo: rawCustomerIoPass ? "pass" : "fail",
      apify: rawSourcingPass ? "pass" : "fail",
      mailbox: rawMailboxPass ? "pass" : "fail",
    },
    message,
  };
}

export async function sourceLeadsFromApify(params: {
  actorId: string;
  actorInput: Record<string, unknown>;
  maxLeads: number;
  token: string;
}): Promise<ApifyLead[]> {
  const actorId = params.actorId.trim();
  const token = params.token.trim();
  if (!actorId || !token) {
    return [];
  }

  try {
    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
      actorId
    )}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=120`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params.actorInput ?? {}),
    });

    if (!response.ok) {
      return [];
    }

    const payload: unknown = await response.json();
    const rows = Array.isArray(payload) ? payload : [];
    const leads: ApifyLead[] = [];
    for (const row of rows) {
      const normalized = normalizeApifyLead(row);
      if (normalized) {
        leads.push(normalized);
      }
      if (leads.length >= params.maxLeads) {
        break;
      }
    }
    return leads;
  } catch {
    return [];
  }
}

export async function sendCustomerIoEvent(params: {
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  customerId: string;
  eventName: string;
  data: Record<string, unknown>;
}): Promise<{ ok: boolean; providerMessageId: string; error: string }> {
  if (process.env.CUSTOMER_IO_SIMULATE === "1") {
    return {
      ok: true,
      providerMessageId: `sim_${Date.now().toString(36)}`,
      error: "",
    };
  }

  const siteId = params.account.config.customerIo.siteId.trim();
  const apiKey = customerIoApiKey(params.secrets);

  if (!siteId || !apiKey) {
    return {
      ok: true,
      providerMessageId: `sim_${Date.now().toString(36)}`,
      error: "",
    };
  }

  try {
    const auth = Buffer.from(`${siteId}:${apiKey}`).toString("base64");
    const response = await fetch(
      `https://track.customer.io/api/v1/customers/${encodeURIComponent(params.customerId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: params.eventName,
          data: params.data,
        }),
      }
    );

    if (!response.ok) {
      return {
        ok: false,
        providerMessageId: "",
        error: `Customer.io HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      providerMessageId: `cio_${Date.now().toString(36)}`,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      providerMessageId: "",
      error: error instanceof Error ? error.message : "Customer.io send failed",
    };
  }
}

export function buildOutreachMessageBody(input: {
  brandName: string;
  experimentName: string;
  hypothesisTitle: string;
  step: number;
  recipientName: string;
}): { subject: string; body: string } {
  const name = input.recipientName || "there";
  const stepLabel = input.step === 1 ? "Intro" : input.step === 2 ? "Follow-up" : "Close-out";
  return {
    subject: `${stepLabel}: ${input.hypothesisTitle}`,
    body: `Hi ${name},\n\nRunning ${input.experimentName} for ${input.brandName}. This touch is part of ${input.hypothesisTitle}.\n\nIf relevant, reply and I can share specifics.`,
  };
}

export async function sendReplyDraftAsEvent(params: {
  draft: ReplyDraft;
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  recipient: string;
}): Promise<{ ok: boolean; error: string }> {
  const result = await sendCustomerIoEvent({
    account: params.account,
    secrets: params.secrets,
    customerId: params.recipient,
    eventName: "factory_reply_sent",
    data: {
      draftId: params.draft.id,
      subject: params.draft.subject,
      body: params.draft.body,
    },
  });

  return {
    ok: result.ok,
    error: result.error,
  };
}

export async function sendOutreachMessage(params: {
  message: OutreachMessage;
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  recipient: string;
  runId: string;
  experimentId: string;
}): Promise<{ ok: boolean; providerMessageId: string; error: string }> {
  return sendCustomerIoEvent({
    account: params.account,
    secrets: params.secrets,
    customerId: params.recipient,
    eventName: "factory_outreach_touch",
    data: {
      runId: params.runId,
      experimentId: params.experimentId,
      messageId: params.message.id,
      step: params.message.step,
      subject: params.message.subject,
      body: params.message.body,
    },
  });
}
