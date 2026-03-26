import { NextResponse } from "next/server";
import {
  OutreachDataError,
  createSenderLaunchEvent,
  listSenderLaunches,
  upsertSenderLaunch,
} from "@/lib/outreach-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function normalizeDomainList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeDomain(String(entry ?? ""))).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((entry) => normalizeDomain(entry))
      .filter(Boolean);
  }
  return [];
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await context.params;
    const [launch] = await listSenderLaunches({ senderAccountId: accountId }, { allowMissingTable: true });
    if (!launch) {
      return NextResponse.json({ error: "sender launch not found" }, { status: 404 });
    }

    const body = asRecord(await request.json());
    const autopilotMode =
      body.autopilotMode === "curated_only" ? "curated_only" : "curated_plus_open_web";
    const autopilotAllowedDomains = normalizeDomainList(body.autopilotAllowedDomains);
    const autopilotBlockedDomains = normalizeDomainList(body.autopilotBlockedDomains).filter(
      (domain) => !autopilotAllowedDomains.includes(domain)
    );

    const updated = await upsertSenderLaunch(
      {
        ...launch,
        autopilotMode,
        autopilotAllowedDomains,
        autopilotBlockedDomains,
      },
      { allowMissingTable: true }
    );

    await createSenderLaunchEvent(
      {
        senderLaunchId: updated.id,
        senderAccountId: updated.senderAccountId,
        brandId: updated.brandId,
        eventType: "autopilot_policy_updated",
        title: "Launch autopilot updated",
        detail:
          updated.autopilotMode === "curated_only"
            ? "Autopilot is now limited to curated sources."
            : "Autopilot can use curated and open-web sources.",
        metadata: {
          autopilotMode: updated.autopilotMode,
          autopilotAllowedDomains: updated.autopilotAllowedDomains,
          autopilotBlockedDomains: updated.autopilotBlockedDomains,
        },
        occurredAt: updated.updatedAt,
      },
      { allowMissingTable: true }
    );

    return NextResponse.json({ launch: updated });
  } catch (err) {
    if (err instanceof OutreachDataError) {
      return NextResponse.json({ error: err.message, hint: err.hint, debug: err.debug }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Failed to update sender launch policy";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
