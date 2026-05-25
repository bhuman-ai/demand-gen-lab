import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import {
  createOutreachEvent,
  createRunAnomaly,
  enqueueOutreachJob,
  findReplyMessageByProviderMessageId,
  findRunMessageByProviderMessageId,
  getDeliverabilityProbeRun,
  getRunMessage,
  listDeliverabilitySeedReservationsByProviderMessageId,
  updateDeliverabilityProbeRun,
  updateDeliverabilitySeedReservations,
  updateOutreachRun,
  updateRunLead,
  updateRunMessage,
} from "@/lib/outreach-data";
import { ingestInboundReply } from "@/lib/outreach-runtime";

type CustomerIoReportingEvent = {
  deliveryId: string;
  eventId: string;
  metric: string;
  objectType: string;
  recipient: string;
  subject: string;
  failureMessage: string;
  timestamp: number | null;
  data: Record<string, unknown>;
};

type CustomerIoWebhookVerification = {
  ok: boolean;
  configured: boolean;
  verified: boolean;
  error: string;
  method: "none" | "hmac" | "url_token";
};

const DELIVERY_SUCCESS_METRICS = new Set(["delivered", "opened", "clicked"]);
const DELIVERY_FAILURE_METRICS = new Set([
  "bounced",
  "dropped",
  "failed",
  "hard_bounced",
  "marked_spam",
  "soft_bounced",
  "spammed",
  "suppressed",
  "undeliverable",
]);
const DELIVERY_POLL_METRICS = new Set(["delivered", "opened", "clicked"]);

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function parseJsonBody(rawBody: string) {
  try {
    return asRecord(JSON.parse(rawBody || "{}"));
  } catch {
    return null;
  }
}

function validLegacyWebhookSecret(request: Request) {
  const expected = process.env.CUSTOMER_IO_WEBHOOK_SECRET;
  if (!expected) return true;
  const provided = request.headers.get("x-webhook-secret") ?? "";
  return provided === expected;
}

function customerIoSigningSecret() {
  return (
    process.env.CUSTOMER_IO_WEBHOOK_SIGNING_SECRET ||
    process.env.CUSTOMER_IO_REPORTING_WEBHOOK_SECRET ||
    process.env.CUSTOMER_IO_WEBHOOK_SIGNING_KEY ||
    ""
  ).trim();
}

function normalizeSignatureCandidates(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .map((item) => item.replace(/^v0=/i, ""))
    .filter(Boolean);
}

function safeEqualHex(leftHex: string, rightHex: string) {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function safeEqualText(leftText: string, rightText: string) {
  const left = Buffer.from(leftText);
  const right = Buffer.from(rightText);
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function verifyCustomerIoSignature(request: Request, rawBody: string): CustomerIoWebhookVerification {
  const secret = customerIoSigningSecret();
  if (!secret) {
    return { ok: true, configured: false, verified: false, error: "", method: "none" };
  }

  const timestamp = asString(request.headers.get("x-cio-timestamp"));
  const signatureHeader = asString(request.headers.get("x-cio-signature"));
  if (!timestamp || !signatureHeader) {
    return {
      ok: false,
      configured: true,
      verified: false,
      error: "Missing Customer.io signature headers",
      method: "hmac",
    };
  }

  const expected = createHmac("sha256", secret)
    .update(`v0:${timestamp}:`)
    .update(rawBody)
    .digest("hex");
  const verified = normalizeSignatureCandidates(signatureHeader).some((candidate) =>
    safeEqualHex(candidate, expected)
  );

  return {
    ok: verified,
    configured: true,
    verified,
    error: verified ? "" : "Customer.io signature mismatch",
    method: "hmac",
  };
}

function verifyCustomerIoReportingAccess(request: Request, rawBody: string): CustomerIoWebhookVerification {
  const signature = verifyCustomerIoSignature(request, rawBody);
  if (signature.configured) return signature;

  const expectedToken = asString(process.env.CUSTOMER_IO_WEBHOOK_SECRET);
  if (!expectedToken) return signature;

  const url = new URL(request.url);
  const providedToken =
    asString(url.searchParams.get("token")) ||
    asString(url.searchParams.get("secret")) ||
    asString(request.headers.get("x-webhook-secret"));
  const verified = safeEqualText(providedToken, expectedToken);
  return {
    ok: verified,
    configured: true,
    verified,
    error: verified ? "" : "Customer.io webhook token mismatch",
    method: "url_token",
  };
}

function parseCustomerIoReportingEvent(body: Record<string, unknown>): CustomerIoReportingEvent {
  const data = asRecord(body.data);
  return {
    deliveryId:
      asString(data.delivery_id) ||
      asString(data.deliveryId) ||
      asString(body.delivery_id) ||
      asString(body.deliveryId) ||
      asString(body.message_id) ||
      asString(body.messageId),
    eventId: asString(body.event_id) || asString(body.eventId),
    metric: asString(body.metric || body.event_type || body.eventType).toLowerCase(),
    objectType: asString(body.object_type || body.objectType).toLowerCase(),
    recipient:
      asString(data.recipient) ||
      asString(data.email_address) ||
      asString(asRecord(data.identifiers).email),
    subject: asString(data.subject),
    failureMessage:
      asString(data.failure_message) ||
      asString(data.failureMessage) ||
      asString(body.failure_message) ||
      asString(body.failureMessage),
    timestamp: Number.isFinite(Number(body.timestamp)) ? Number(body.timestamp) : null,
    data,
  };
}

function looksLikeCustomerIoReportingWebhook(body: Record<string, unknown>) {
  return Boolean(body.metric || body.event_id || body.object_type || asRecord(body.data).delivery_id);
}

function reportingPayload(event: CustomerIoReportingEvent, signature: CustomerIoWebhookVerification) {
  return {
    provider: "customerio",
    deliveryId: event.deliveryId,
    eventId: event.eventId,
    metric: event.metric,
    objectType: event.objectType,
    recipient: event.recipient,
    subject: event.subject,
    failureMessage: event.failureMessage,
    timestamp: event.timestamp,
    data: event.data,
    signature: {
      configured: signature.configured,
      verified: signature.verified,
      method: signature.method,
    },
  };
}

function probeResultKey(result: { accountId: string; email: string }) {
  return `${result.accountId}:${result.email.toLowerCase()}`;
}

function summarizeProbeResults(results: Array<{ placement: string; ok: boolean }>, totalMonitors: number) {
  const counts: Record<string, number> = {
    inbox: 0,
    spam: 0,
    all_mail_only: 0,
    not_found: 0,
    error: 0,
  };
  for (const result of results) {
    const placement = ["inbox", "spam", "all_mail_only", "not_found", "error"].includes(result.placement)
      ? result.placement
      : result.ok
        ? "not_found"
        : "error";
    counts[placement] = (counts[placement] ?? 0) + 1;
  }
  const total = Math.max(totalMonitors, results.length, 1);
  const placement =
    counts.spam > 0
      ? "spam"
      : counts.inbox > 0
        ? "inbox"
        : counts.all_mail_only > 0
          ? "all_mail_only"
          : counts.error >= total
            ? "error"
            : counts.not_found > 0
              ? "not_found"
              : "unknown";
  const summaryText = `Customer.io webhook evidence: ${counts.inbox} inbox, ${counts.spam} spam, ${counts.all_mail_only} all-mail-only, ${counts.not_found} not found, ${counts.error} error across ${total} monitor${total === 1 ? "" : "s"}.`;
  return { counts, placement, total, summaryText };
}

async function recordProbeFailureFromCustomerIoWebhook(input: {
  probeRunId: string;
  reservationId: string;
  accountId: string;
  email: string;
  metric: string;
  failureMessage: string;
}) {
  const probeRun = await getDeliverabilityProbeRun(input.probeRunId);
  if (!probeRun || probeRun.status === "completed" || probeRun.status === "failed") return null;

  const error = `Customer.io reported ${input.metric}${input.failureMessage ? `: ${input.failureMessage}` : ""}`;
  const nextResult = {
    accountId: input.accountId,
    email: input.email.toLowerCase(),
    placement: "error",
    matchedMailbox: "",
    matchedUid: 0,
    ok: false,
    error,
  };
  const resultByKey = new Map(probeRun.results.map((result) => [probeResultKey(result), result] as const));
  resultByKey.set(probeResultKey(nextResult), nextResult);
  const results = Array.from(resultByKey.values());
  const monitorKeys = new Set(probeRun.monitorTargets.map((target) => probeResultKey(target)));
  const completedMonitorCount = results.filter((result) => monitorKeys.has(probeResultKey(result))).length;
  const totalMonitors = Math.max(probeRun.monitorTargets.length, results.length, 1);
  const complete = completedMonitorCount >= totalMonitors;
  const summary = summarizeProbeResults(results, totalMonitors);

  await updateDeliverabilitySeedReservations([input.reservationId], {
    status: "released",
    releasedAt: new Date().toISOString(),
    releasedReason: `customerio_${input.metric}`,
  });

  return updateDeliverabilityProbeRun(probeRun.id, {
    status: complete ? "completed" : "waiting",
    stage: "poll",
    results,
    pollAttempt: Math.max(1, probeRun.pollAttempt),
    placement: complete ? summary.placement : probeRun.placement,
    totalMonitors: summary.total,
    counts: complete ? summary.counts : probeRun.counts,
    summaryText: complete ? summary.summaryText : probeRun.summaryText,
    lastError: error,
    completedAt: complete ? new Date().toISOString() : probeRun.completedAt,
  });
}

async function queueProbePollFromCustomerIoWebhook(probeRunId: string) {
  const probeRun = await getDeliverabilityProbeRun(probeRunId);
  if (!probeRun || probeRun.status === "completed" || probeRun.status === "failed") return false;

  await updateDeliverabilityProbeRun(probeRun.id, {
    status: "waiting",
    stage: "poll",
    lastError: "",
  });

  await enqueueOutreachJob({
    runId: probeRun.runId,
    jobType: "monitor_deliverability",
    executeAfter: new Date(Date.now() + 15_000).toISOString(),
    payload: {
      stage: "poll",
      probeRunId: probeRun.id,
      probeVariant: probeRun.probeVariant,
      probeToken: probeRun.probeToken,
      subject: probeRun.subject,
      sourceMessageId: probeRun.sourceMessageId,
      sourceMessageStatus: probeRun.sourceMessageStatus,
      sourceType: probeRun.sourceType,
      nodeId: probeRun.sourceNodeId,
      leadId: probeRun.sourceLeadId,
      contentHash: probeRun.contentHash,
      senderAccountId: probeRun.senderAccountId,
      senderAccountName: probeRun.senderAccountName,
      fromEmail: probeRun.fromEmail,
      monitorTargets: probeRun.monitorTargets,
      previousResults: probeRun.results,
      pollAttempt: Math.max(1, probeRun.pollAttempt || 1),
      source: "customerio_delivery_webhook",
    },
  });
  return true;
}

async function handleCustomerIoReportingWebhook(
  event: CustomerIoReportingEvent,
  signature: CustomerIoWebhookVerification
) {
  if (!event.deliveryId) {
    return NextResponse.json({ ok: true, ignored: true, reason: "missing_delivery_id" });
  }

  const payload = reportingPayload(event, signature);
  const [message, replyMessage, reservations] = await Promise.all([
    findRunMessageByProviderMessageId(event.deliveryId),
    findReplyMessageByProviderMessageId(event.deliveryId),
    listDeliverabilitySeedReservationsByProviderMessageId(event.deliveryId),
  ]);
  const matchedRunIds = new Set<string>();
  let queuedProbePolls = 0;
  let probeFailuresRecorded = 0;

  if (message) {
    matchedRunIds.add(message.runId);
    await createOutreachEvent({
      runId: message.runId,
      eventType: "customerio_reporting_metric",
      payload: {
        ...payload,
        messageId: message.id,
        leadId: message.leadId,
      },
    });

    if (DELIVERY_FAILURE_METRICS.has(event.metric)) {
      const messageStatus = ["bounced", "hard_bounced", "soft_bounced", "undeliverable"].includes(event.metric)
        ? "bounced"
        : "failed";
      await updateRunMessage(message.id, {
        status: messageStatus,
        lastError: event.failureMessage || `Customer.io reported ${event.metric}`,
      });
      await updateRunLead(message.leadId, {
        status: messageStatus === "bounced" ? "bounced" : "suppressed",
      });
    }
  }

  if (replyMessage) {
    matchedRunIds.add(replyMessage.runId);
    await createOutreachEvent({
      runId: replyMessage.runId,
      eventType: "customerio_reply_reporting_metric",
      payload: {
        ...payload,
        replyMessageId: replyMessage.id,
        threadId: replyMessage.threadId,
      },
    });
  }

  for (const reservation of reservations) {
    matchedRunIds.add(reservation.runId);
    await createOutreachEvent({
      runId: reservation.runId,
      eventType: "customerio_probe_delivery_metric",
      payload: {
        ...payload,
        probeRunId: reservation.probeRunId,
        reservationId: reservation.id,
        senderAccountId: reservation.senderAccountId,
        monitorAccountId: reservation.monitorAccountId,
        monitorEmail: reservation.monitorEmail,
        probeVariant: reservation.probeVariant,
        contentHash: reservation.contentHash,
        probeToken: reservation.probeToken,
      },
    });

    if (DELIVERY_FAILURE_METRICS.has(event.metric)) {
      const updated = await recordProbeFailureFromCustomerIoWebhook({
        probeRunId: reservation.probeRunId,
        reservationId: reservation.id,
        accountId: reservation.monitorAccountId,
        email: reservation.monitorEmail,
        metric: event.metric,
        failureMessage: event.failureMessage,
      });
      if (updated) probeFailuresRecorded += 1;
      continue;
    }

    if (DELIVERY_POLL_METRICS.has(event.metric)) {
      const queued = await queueProbePollFromCustomerIoWebhook(reservation.probeRunId);
      if (queued) queuedProbePolls += 1;
    }
  }

  if (event.metric === "spammed" || event.metric === "marked_spam") {
    for (const runId of matchedRunIds) {
      await createRunAnomaly({
        runId,
        type: "spam_complaint_rate",
        severity: "critical",
        threshold: 0.003,
        observed: 1,
        details: event.failureMessage || "Customer.io reported a spam complaint",
      });
      await updateOutreachRun(runId, {
        status: "paused",
        pauseReason: "Auto-paused due to Customer.io spam complaint",
        lastError: "Customer.io spam complaint webhook received",
      });
      await createOutreachEvent({
        runId,
        eventType: "run_paused_auto",
        payload: { reason: "customerio_spam_complaint", deliveryId: event.deliveryId },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    deliveryId: event.deliveryId,
    metric: event.metric,
    matched: {
      outreachMessage: Boolean(message),
      replyMessage: Boolean(replyMessage),
      deliverabilitySeedReservations: reservations.length,
      runIds: Array.from(matchedRunIds),
    },
    queuedProbePolls,
    probeFailuresRecorded,
    knownSuccessMetric: DELIVERY_SUCCESS_METRICS.has(event.metric),
    knownFailureMetric: DELIVERY_FAILURE_METRICS.has(event.metric),
  });
}

async function handleLegacyCustomerIoWebhook(request: Request, body: Record<string, unknown>) {
  if (!validLegacyWebhookSecret(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const eventType = asString(body.eventType ?? body.type).toLowerCase();
  const runId = asString(body.runId ?? body.run_id);

  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  if (eventType === "reply" || eventType === "message_replied") {
    const from = asString(body.from);
    const to = asString(body.to);
    const subject = asString(body.subject);
    const messageBody = asString(body.body);
    if (!from || !to || !subject || !messageBody) {
      return NextResponse.json(
        { error: "reply webhook requires from, to, subject, and body" },
        { status: 400 }
      );
    }

    const result = await ingestInboundReply({
      brandId: asString(body.brandId ?? body.brand_id),
      campaignId: asString(body.campaignId ?? body.campaign_id),
      runId,
      from,
      to,
      subject,
      body: messageBody,
      providerMessageId: asString(body.messageId ?? body.message_id),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }

    return NextResponse.json({ ok: true, result });
  }

  if (eventType === "bounce" || eventType === "message_bounced") {
    const messageId = asString(body.messageId ?? body.message_id);
    if (messageId) {
      const message = await getRunMessage(messageId);
      await updateRunMessage(messageId, {
        status: "bounced",
        lastError: asString(body.reason) || "bounced",
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
      details: asString(body.reason) || "Spam complaint received",
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

export async function POST(request: Request) {
  const rawBody = await request.text();
  const body = parseJsonBody(rawBody);
  if (!body) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (looksLikeCustomerIoReportingWebhook(body)) {
    const signature = verifyCustomerIoReportingAccess(request, rawBody);
    if (!signature.ok) {
      return NextResponse.json({ error: signature.error }, { status: 401 });
    }
    return handleCustomerIoReportingWebhook(parseCustomerIoReportingEvent(body), signature);
  }

  return handleLegacyCustomerIoWebhook(request, body);
}
