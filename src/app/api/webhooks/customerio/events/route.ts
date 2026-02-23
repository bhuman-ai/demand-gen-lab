import { NextResponse } from "next/server";
import {
  createOutreachEvent,
  createRunAnomaly,
  enqueueOutreachJob,
  getRunMessage,
  updateOutreachRun,
  updateRunLead,
  updateRunMessage,
} from "@/lib/outreach-data";
import { ingestInboundReply } from "@/lib/outreach-runtime";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function validWebhookSecret(request: Request) {
  const expected = process.env.CUSTOMER_IO_WEBHOOK_SECRET;
  if (!expected) return true;
  const provided = request.headers.get("x-webhook-secret") ?? "";
  return provided === expected;
}

export async function POST(request: Request) {
  if (!validWebhookSecret(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = asRecord(await request.json());
  const eventType = String(body.eventType ?? body.type ?? "").toLowerCase();
  const runId = String(body.runId ?? body.run_id ?? "").trim();

  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  if (eventType === "reply" || eventType === "message_replied") {
    const from = String(body.from ?? "").trim();
    const to = String(body.to ?? "").trim();
    const subject = String(body.subject ?? "").trim();
    const messageBody = String(body.body ?? "").trim();
    if (!from || !to || !subject || !messageBody) {
      return NextResponse.json(
        { error: "reply webhook requires from, to, subject, and body" },
        { status: 400 }
      );
    }

    const result = await ingestInboundReply({
      brandId: String(body.brandId ?? body.brand_id ?? ""),
      campaignId: String(body.campaignId ?? body.campaign_id ?? ""),
      runId,
      from,
      to,
      subject,
      body: messageBody,
      providerMessageId: String(body.messageId ?? body.message_id ?? ""),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }

    return NextResponse.json({ ok: true, result });
  }

  if (eventType === "bounce" || eventType === "message_bounced") {
    const messageId = String(body.messageId ?? body.message_id ?? "").trim();
    if (messageId) {
      const message = await getRunMessage(messageId);
      await updateRunMessage(messageId, {
        status: "bounced",
        lastError: String(body.reason ?? "bounced"),
      });
      if (message) {
        await updateRunLead(message.leadId, { status: "bounced" });
      }
    }

    await createOutreachEvent({
      runId,
      eventType: "message_bounced",
      payload: body,
    });

    await enqueueOutreachJob({
      runId,
      jobType: "analyze_run",
      executeAfter: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  }

  if (eventType === "complaint" || eventType === "spam_complaint" || eventType === "message_complained") {
    await createRunAnomaly({
      runId,
      type: "spam_complaint_rate",
      severity: "critical",
      threshold: 0.003,
      observed: 1,
      details: String(body.reason ?? "Spam complaint received"),
    });

    await updateOutreachRun(runId, {
      status: "paused",
      pauseReason: "Auto-paused due to spam complaint",
      lastError: "Spam complaint webhook received",
    });

    await createOutreachEvent({
      runId,
      eventType: "run_paused_auto",
      payload: { reason: "spam_complaint" },
    });

    return NextResponse.json({ ok: true });
  }

  await createOutreachEvent({
    runId,
    eventType: eventType || "unknown_customerio_event",
    payload: body,
  });

  return NextResponse.json({ ok: true });
}
