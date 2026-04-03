import { NextResponse } from "next/server";
import {
  deleteBrand,
  getBrandById,
  updateBrand,
  type DomainRow,
  type InboxRow,
  type LeadRow,
} from "@/lib/factory-data";
import {
  getOutreachProvisioningSettings,
  updateOutreachProvisioningSettings,
} from "@/lib/outreach-provider-settings";
import { syncBrandGmailUiAssignments } from "@/lib/gmail-ui-brand-sync";
import { enrichBrandWithSenderHealth } from "@/lib/sender-health";
import { loadBrandSenderLaunchView } from "@/lib/sender-launch";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeMonitoredDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function normalizeDomains(value: unknown): DomainRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      const automationStatus = String(row.automationStatus ?? row.automation_status ?? "").toLowerCase();
      const domainHealth = String(row.domainHealth ?? row.domain_health ?? "").toLowerCase();
      const emailHealth = String(row.emailHealth ?? row.email_health ?? "").toLowerCase();
      const ipHealth = String(row.ipHealth ?? row.ip_health ?? "").toLowerCase();
      const messagingHealth = String(row.messagingHealth ?? row.messaging_health ?? "").toLowerCase();
      const seedPolicy = String(row.seedPolicy ?? row.seed_policy ?? "").toLowerCase();
      return {
        id: String(row.id ?? `domain_${Math.random().toString(36).slice(2, 8)}`),
        domain: String(row.domain ?? "").trim(),
        status: ["active", "warming", "risky"].includes(String(row.status ?? "").toLowerCase())
          ? (String(row.status).toLowerCase() as DomainRow["status"])
          : "active",
        warmupStage: String(row.warmupStage ?? ""),
        reputation: String(row.reputation ?? ""),
        automationStatus: ["queued", "testing", "warming", "ready", "attention"].includes(automationStatus)
          ? (automationStatus as DomainRow["automationStatus"])
          : undefined,
        automationSummary: String(row.automationSummary ?? row.automation_summary ?? "").trim(),
        domainHealth: ["unknown", "queued", "healthy", "watch", "risky"].includes(domainHealth)
          ? (domainHealth as DomainRow["domainHealth"])
          : undefined,
        domainHealthSummary: String(row.domainHealthSummary ?? row.domain_health_summary ?? "").trim(),
        emailHealth: ["unknown", "queued", "healthy", "watch", "risky"].includes(emailHealth)
          ? (emailHealth as DomainRow["emailHealth"])
          : undefined,
        emailHealthSummary: String(row.emailHealthSummary ?? row.email_health_summary ?? "").trim(),
        ipHealth: ["unknown", "queued", "healthy", "watch", "risky"].includes(ipHealth)
          ? (ipHealth as DomainRow["ipHealth"])
          : undefined,
        ipHealthSummary: String(row.ipHealthSummary ?? row.ip_health_summary ?? "").trim(),
        messagingHealth: ["unknown", "queued", "healthy", "watch", "risky"].includes(messagingHealth)
          ? (messagingHealth as DomainRow["messagingHealth"])
          : undefined,
        messagingHealthSummary: String(row.messagingHealthSummary ?? row.messaging_health_summary ?? "").trim(),
        seedPolicy: ["fresh_pool", "rotating_pool", "tainted_mailbox"].includes(seedPolicy)
          ? (seedPolicy as DomainRow["seedPolicy"])
          : undefined,
        role: ["brand", "sender"].includes(String(row.role ?? "").toLowerCase())
          ? (String(row.role).toLowerCase() as DomainRow["role"])
          : undefined,
        registrar:
          String(row.registrar ?? "").toLowerCase() === "namecheap"
            ? ("namecheap" as DomainRow["registrar"])
            : String(row.registrar ?? "").toLowerCase() === "mailpool"
              ? ("mailpool" as DomainRow["registrar"])
              : ("manual" as DomainRow["registrar"]),
        provider:
          String(row.provider ?? "").toLowerCase() === "customerio"
            ? ("customerio" as DomainRow["provider"])
            : String(row.provider ?? "").toLowerCase() === "mailpool"
              ? ("mailpool" as DomainRow["provider"])
            : ("manual" as DomainRow["provider"]),
        dnsStatus: ["pending", "configured", "verified", "error"].includes(String(row.dnsStatus ?? "").toLowerCase())
          ? (String(row.dnsStatus).toLowerCase() as DomainRow["dnsStatus"])
          : "pending",
        fromEmail: String(row.fromEmail ?? "").trim(),
        replyMailboxEmail: String(row.replyMailboxEmail ?? "").trim(),
        forwardingTargetUrl: String(row.forwardingTargetUrl ?? row.forwarding_target_url ?? "").trim(),
        deliveryAccountId: String(row.deliveryAccountId ?? row.delivery_account_id ?? "").trim(),
        deliveryAccountName: String(row.deliveryAccountName ?? row.delivery_account_name ?? "").trim(),
        customerIoAccountId: String(row.customerIoAccountId ?? row.customer_io_account_id ?? "").trim(),
        customerIoAccountName: String(row.customerIoAccountName ?? row.customer_io_account_name ?? "").trim(),
        mailpoolDomainId: String(row.mailpoolDomainId ?? row.mailpool_domain_id ?? "").trim(),
        notes: String(row.notes ?? "").trim(),
        lastProvisionedAt: String(row.lastProvisionedAt ?? "").trim(),
        lastHealthCheckAt: String(row.lastHealthCheckAt ?? row.last_health_check_at ?? "").trim(),
        nextHealthCheckAt: String(row.nextHealthCheckAt ?? row.next_health_check_at ?? "").trim(),
      };
    })
    .filter((row) => row.domain.length > 0);
}

function normalizeLeads(value: unknown): LeadRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      return {
        id: String(row.id ?? `lead_${Math.random().toString(36).slice(2, 8)}`),
        name: String(row.name ?? "").trim(),
        channel: String(row.channel ?? "").trim(),
        status: ["new", "contacted", "qualified", "closed"].includes(String(row.status ?? "").toLowerCase())
          ? (String(row.status).toLowerCase() as LeadRow["status"])
          : "new",
        lastTouch: String(row.lastTouch ?? ""),
      };
    })
    .filter((row) => row.name.length > 0);
}

function normalizeInbox(value: unknown): InboxRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      return {
        id: String(row.id ?? `msg_${Math.random().toString(36).slice(2, 8)}`),
        from: String(row.from ?? "").trim(),
        subject: String(row.subject ?? "").trim(),
        sentiment: ["positive", "neutral", "negative"].includes(String(row.sentiment ?? "").toLowerCase())
          ? (String(row.sentiment).toLowerCase() as InboxRow["sentiment"])
          : "neutral",
        status: ["new", "open", "closed"].includes(String(row.status ?? "").toLowerCase())
          ? (String(row.status).toLowerCase() as InboxRow["status"])
          : "new",
        receivedAt: String(row.receivedAt ?? ""),
      };
    })
    .filter((row) => row.subject.length > 0);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
}

export async function GET(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const { searchParams } = new URL(request.url);
  const includeEmbedded = searchParams.get("includeEmbedded") === "1";
  const brand = await getBrandById(brandId, { includeEmbedded });
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }
  return NextResponse.json({ brand });
}

export async function PATCH(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const body = asRecord(await request.json());

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.brandName === "string") patch.name = body.brandName.trim();
  if (typeof body.website === "string") patch.website = body.website.trim();
  if (typeof body.tone === "string") patch.tone = body.tone.trim();
  if (typeof body.notes === "string") patch.notes = body.notes.trim();
  if (typeof body.proof === "string") patch.notes = body.proof.trim();
  if (typeof body.product === "string") patch.product = body.product.trim();
  if (Array.isArray(body.targetMarkets)) patch.targetMarkets = normalizeStringArray(body.targetMarkets);
  if (Array.isArray(body.idealCustomerProfiles)) {
    patch.idealCustomerProfiles = normalizeStringArray(body.idealCustomerProfiles);
  }
  if (Array.isArray(body.keyFeatures)) patch.keyFeatures = normalizeStringArray(body.keyFeatures);
  if (Array.isArray(body.keyBenefits)) patch.keyBenefits = normalizeStringArray(body.keyBenefits);
  if (Array.isArray(body.domains)) patch.domains = normalizeDomains(body.domains);
  if (Array.isArray(body.leads)) patch.leads = normalizeLeads(body.leads);
  if (Array.isArray(body.inbox)) patch.inbox = normalizeInbox(body.inbox);

  const brand = await updateBrand(brandId, patch);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  await syncBrandGmailUiAssignments({ brandIds: [brand.id] }).catch(() => null);

  if (Array.isArray(patch.domains)) {
    const senderDomains = brand.domains
      .filter((row) => row.role !== "brand")
      .map((row) => normalizeMonitoredDomain(row.domain))
      .filter(Boolean);
    if (senderDomains.length) {
      const settings = await getOutreachProvisioningSettings();
      if (settings.deliverability.provider === "google_postmaster") {
        const monitoredDomains = new Set(
          settings.deliverability.monitoredDomains.map((entry) => normalizeMonitoredDomain(entry)).filter(Boolean)
        );
        let changed = false;
        for (const domain of senderDomains) {
          if (!monitoredDomains.has(domain)) {
            monitoredDomains.add(domain);
            changed = true;
          }
        }
        if (changed) {
          await updateOutreachProvisioningSettings({
            deliverability: {
              monitoredDomains: [...monitoredDomains],
            },
          });
        }
      }
    }
  }

  const launchView = await loadBrandSenderLaunchView(brand.id);
  return NextResponse.json({ brand: launchView?.brand ?? (await enrichBrandWithSenderHealth(brand)) });
}

export async function DELETE(_: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const deleted = await deleteBrand(brandId);
  if (!deleted) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }
  return NextResponse.json({ deletedId: brandId });
}
