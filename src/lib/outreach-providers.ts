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

function customerIoTrackBaseUrl() {
  const explicit = String(process.env.CUSTOMER_IO_TRACK_BASE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const region = String(process.env.CUSTOMER_IO_REGION ?? "").trim().toLowerCase();
  if (region === "eu") return "https://track-eu.customer.io";

  return "https://track.customer.io";
}

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

async function testCustomerIoTrackCredentials(input: {
  siteId: string;
  apiKey: string;
}): Promise<{ ok: boolean; error: string; region: string; baseUrl: string }> {
  if (process.env.CUSTOMER_IO_SIMULATE === "1") {
    return { ok: true, error: "", region: "simulated", baseUrl: "simulated" };
  }

  const siteId = input.siteId.trim();
  const apiKey = input.apiKey.trim();
  if (!siteId || !apiKey) {
    return { ok: false, error: "Missing Customer.io Site ID or API key.", region: "", baseUrl: customerIoTrackBaseUrl() };
  }

  const baseUrl = customerIoTrackBaseUrl();

  async function attempt(url: string) {
    const auth = Buffer.from(`${siteId}:${apiKey}`).toString("base64");
    const response = await fetch(`${url}/api/v1/accounts/region`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      let body = "";
      try {
        body = (await response.text()).trim();
      } catch {
        body = "";
      }
      return { ok: false as const, status: response.status, body };
    }

    const payload: unknown = await response.json().catch(() => ({}));
    const row = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    const region = String(row.region ?? "").trim();
    return { ok: true as const, status: 200, region, body: "" };
  }

  try {
    const primary = await attempt(baseUrl);
    if (primary.ok) {
      return { ok: true, error: "", region: primary.region, baseUrl };
    }

    // If the account lives in the other region, try the alternate Track base URL to produce a useful hint.
    const explicitBase = String(process.env.CUSTOMER_IO_TRACK_BASE_URL ?? "").trim();
    if (!explicitBase && primary.status === 401) {
      const alternateBase =
        baseUrl === "https://track-eu.customer.io" ? "https://track.customer.io" : "https://track-eu.customer.io";
      const alternate = await attempt(alternateBase);
      if (alternate.ok) {
        return {
          ok: false,
          error: `Customer.io auth failed (HTTP 401) on ${baseUrl}, but succeeded on ${alternateBase}. Your account may be in a different region.`,
          region: alternate.region,
          baseUrl,
        };
      }
    }

    const siteIdLooksWrong = siteId.includes("@") || siteId.includes(".") || siteId.includes(" ");
    const siteIdHint = siteIdLooksWrong
      ? " Site ID looks wrong (it should be the Site ID value, not a workspace/name)."
      : "";
    const bodyText = primary.body ? ` ${primary.body.slice(0, 160)}` : "";
    return {
      ok: false,
      error: `Customer.io auth failed (HTTP ${primary.status}) on ${baseUrl}.${bodyText}${siteIdHint}`,
      region: "",
      baseUrl,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Customer.io auth failed",
      region: "",
      baseUrl,
    };
  }
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

  const fromEmail = account.config.customerIo.fromEmail.trim();
  const rawCustomerIoPass = requiresDelivery
    ? Boolean(account.config.customerIo.siteId && customerIoApiKey(secrets) && fromEmail)
    : true;

  const rawSourcingPass = requiresDelivery ? Boolean(sourcingToken(secrets)) : true;
  const rawMailboxPass = requiresMailbox
    ? Boolean(account.config.mailbox.email && (secrets.mailboxAccessToken || secrets.mailboxPassword))
    : true;

  let customerIoPass = shouldTestCustomerIo ? rawCustomerIoPass : true;
  let customerIoDetail = "";
  if (requiresDelivery && shouldTestCustomerIo) {
    if (!rawCustomerIoPass) {
      const missing: string[] = [];
      if (!account.config.customerIo.siteId.trim()) missing.push("Site ID");
      if (!customerIoApiKey(secrets)) missing.push("API key");
      if (!fromEmail) missing.push("From Email");
      customerIoDetail = missing.length ? `Missing: ${missing.join(", ")}` : "Customer.io config missing";
      customerIoPass = false;
    } else {
      const auth = await testCustomerIoTrackCredentials({
        siteId: account.config.customerIo.siteId,
        apiKey: customerIoApiKey(secrets),
      });
      customerIoPass = auth.ok;
      if (!auth.ok) {
        customerIoDetail = auth.error;
      } else {
        const detailParts: string[] = [];
        if (auth.region) detailParts.push(`Region: ${auth.region}`);
        if (auth.baseUrl) detailParts.push(`Base: ${auth.baseUrl.replace(/^https?:\/\//, "")}`);
        customerIoDetail = detailParts.join(" · ");
      }
    }
  }

  const apifyPass = shouldTestSourcing ? rawSourcingPass : true;
  const mailboxPass = shouldTestMailbox ? rawMailboxPass : true;

  const message =
    scope === "customerio"
      ? customerIoPass
        ? customerIoDetail
          ? `Customer.io check passed. ${customerIoDetail}`
          : "Customer.io check passed"
        : customerIoDetail
          ? `Customer.io check failed. ${customerIoDetail}`
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
      customerIo: customerIoPass ? "pass" : "fail",
      apify: apifyPass ? "pass" : "fail",
      mailbox: mailboxPass ? "pass" : "fail",
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
      ok: false,
      providerMessageId: "",
      error: "Customer.io Site ID/API key missing",
    };
  }

  try {
    const auth = Buffer.from(`${siteId}:${apiKey}`).toString("base64");
    const response = await fetch(
      `${customerIoTrackBaseUrl()}/api/v1/customers/${encodeURIComponent(params.customerId)}/events`,
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
      let detail = "";
      try {
        detail = (await response.text()).trim();
      } catch {
        detail = "";
      }
      return {
        ok: false,
        providerMessageId: "",
        error: `Customer.io HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
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
  replyToEmail: string;
  recipient: string;
  runId: string;
  experimentId: string;
}): Promise<{ ok: boolean; providerMessageId: string; error: string }> {
  const fromEmail = params.account.config.customerIo.fromEmail.trim();
  const replyToEmail = params.replyToEmail.trim();
  return sendCustomerIoEvent({
    account: params.account,
    secrets: params.secrets,
    customerId: params.recipient,
    eventName: "factory_outreach_touch",
    data: {
      // Reserved properties (Customer.io track) override campaign From/To/Reply-To.
      recipient: params.recipient,
      ...(fromEmail ? { from_address: fromEmail } : {}),
      ...(replyToEmail ? { reply_to: replyToEmail } : {}),
      runId: params.runId,
      experimentId: params.experimentId,
      messageId: params.message.id,
      step: params.message.step,
      subject: params.message.subject,
      body: params.message.body,
    },
  });
}
