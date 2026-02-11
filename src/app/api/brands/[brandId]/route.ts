import { NextResponse } from "next/server";
import {
  deleteBrand,
  getBrandById,
  updateBrand,
  type DomainRow,
  type InboxRow,
  type LeadRow,
} from "@/lib/factory-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeDomains(value: unknown): DomainRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      return {
        id: String(row.id ?? `domain_${Math.random().toString(36).slice(2, 8)}`),
        domain: String(row.domain ?? "").trim(),
        status: ["active", "warming", "risky"].includes(String(row.status ?? "").toLowerCase())
          ? (String(row.status).toLowerCase() as DomainRow["status"])
          : "active",
        warmupStage: String(row.warmupStage ?? ""),
        reputation: String(row.reputation ?? ""),
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

export async function GET(_: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
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
  if (Array.isArray(body.domains)) patch.domains = normalizeDomains(body.domains);
  if (Array.isArray(body.leads)) patch.leads = normalizeLeads(body.leads);
  if (Array.isArray(body.inbox)) patch.inbox = normalizeInbox(body.inbox);

  const brand = await updateBrand(brandId, patch);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }
  return NextResponse.json({ brand });
}

export async function DELETE(_: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const deleted = await deleteBrand(brandId);
  if (!deleted) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }
  return NextResponse.json({ deletedId: brandId });
}
