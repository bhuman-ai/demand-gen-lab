import {
  defaultExperimentRunPolicy,
  getBrandById,
  getCampaignById,
  updateCampaign,
  type CampaignRecord,
  type Experiment,
  type Hypothesis,
} from "@/lib/factory-data";
import type { ReplyThread } from "@/lib/factory-types";
import {
  createOutreachEvent,
  createOutreachRun,
  createReplyDraft,
  createReplyMessage,
  createReplyThread,
  createRunAnomaly,
  createRunMessages,
  enqueueOutreachJob,
  getBrandOutreachAssignment,
  getOutreachAccount,
  getOutreachAccountSecrets,
  getOutreachRun,
  getReplyDraft,
  getReplyThread,
  listCampaignRuns,
  listDueOutreachJobs,
  listExperimentRuns,
  listReplyThreadsByBrand,
  listRunLeads,
  listRunMessages,
  updateOutreachJob,
  updateOutreachRun,
  updateReplyDraft,
  updateReplyThread,
  updateRunLead,
  updateRunMessage,
  upsertRunLeads,
  type OutreachJob,
} from "@/lib/outreach-data";
import {
  buildOutreachMessageBody,
  sendOutreachMessage,
  sendReplyDraftAsEvent,
  fetchPlatformEmailDiscoveryResults,
  leadsFromEmailDiscoveryRows,
  pollPlatformEmailDiscovery,
  runPlatformLeadDomainSearch,
  startPlatformEmailDiscovery,
  sourceLeadsFromApify,
  type ApifyLead,
} from "@/lib/outreach-providers";

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const PLATFORM_SOURCING_PROFILE = String(process.env.APIFY_DEFAULT_ACTOR_ID ?? "").trim();

const DAY_MS = 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function toDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0);
  }
  return parsed;
}

function findHypothesis(campaign: CampaignRecord, hypothesisId: string) {
  return campaign.hypotheses.find((item) => item.id === hypothesisId) ?? null;
}

function findExperiment(campaign: CampaignRecord, experimentId: string) {
  return campaign.experiments.find((item) => item.id === experimentId) ?? null;
}

function effectiveSourceConfig(hypothesis: Hypothesis, fallbackActorId: string) {
  return {
    actorId: hypothesis.sourceConfig?.actorId?.trim() || fallbackActorId || PLATFORM_SOURCING_PROFILE,
    actorInput: hypothesis.sourceConfig?.actorInput ?? {},
    maxLeads: Number(hypothesis.sourceConfig?.maxLeads ?? 100),
  };
}

function platformSourcingToken() {
  return (
    String(process.env.APIFY_TOKEN ?? "").trim() ||
    String(process.env.APIFY_API_TOKEN ?? "").trim() ||
    String(process.env.APIFY_API_KEY ?? "").trim()
  );
}

type ResolvedAccount = NonNullable<Awaited<ReturnType<typeof getOutreachAccount>>>;
type ResolvedSecrets = NonNullable<Awaited<ReturnType<typeof getOutreachAccountSecrets>>>;

function effectiveCustomerIoApiKey(secrets: ResolvedSecrets) {
  return (
    secrets.customerIoApiKey.trim() ||
    secrets.customerIoTrackApiKey.trim() ||
    secrets.customerIoAppApiKey.trim()
  );
}

function effectiveSourcingToken(secrets: ResolvedSecrets) {
  return secrets.apifyToken.trim() || platformSourcingToken();
}

function supportsDelivery(account: ResolvedAccount) {
  return account.accountType !== "mailbox";
}

function supportsMailbox(account: ResolvedAccount) {
  return account.accountType !== "delivery";
}

function preflightReason(input: {
  deliveryAccount: ResolvedAccount;
  deliverySecrets: ResolvedSecrets;
  mailboxAccount: ResolvedAccount;
  mailboxSecrets: ResolvedSecrets;
  hypothesis: Hypothesis;
}) {
  if (!supportsDelivery(input.deliveryAccount)) {
    return "Assigned delivery account does not support outreach sending";
  }
  if (!input.hypothesis.actorQuery.trim()) {
    return "Target Audience is required for lead sourcing";
  }
  if (!effectiveSourcingToken(input.deliverySecrets)) {
    return "Lead sourcing credentials are missing";
  }
  if (
    !input.deliveryAccount.config.customerIo.siteId.trim()
  ) {
    return "Customer.io site config is required";
  }
  if (!effectiveCustomerIoApiKey(input.deliverySecrets)) {
    return "Customer.io API key missing";
  }
  if (!input.deliveryAccount.config.customerIo.fromEmail.trim()) {
    return "Customer.io From Email is required";
  }
  if (!supportsMailbox(input.mailboxAccount)) {
    return "Assigned mailbox account does not support mailbox reply handling";
  }
  if (
    input.mailboxAccount.config.mailbox.status !== "connected" ||
    !input.mailboxAccount.config.mailbox.email.trim()
  ) {
    return "Mailbox must be connected for automated reply triage";
  }
  if (
    !input.mailboxSecrets.mailboxAccessToken.trim() &&
    !input.mailboxSecrets.mailboxPassword.trim()
  ) {
    return "Mailbox credentials missing";
  }
  return "";
}

function preflightDiagnostic(input: {
  reason: string;
  hypothesis: Hypothesis;
  deliveryAccount: ResolvedAccount;
  deliverySecrets: ResolvedSecrets;
}) {
  const sourceConfig = effectiveSourceConfig(
    input.hypothesis,
    input.deliveryAccount.config.apify.defaultActorId
  );

  const debug = {
    reason: input.reason,
    hypothesisId: input.hypothesis.id,
    hypothesisHasLeadSourceOverride: Boolean(input.hypothesis.sourceConfig?.actorId?.trim()),
    deliveryAccountHasLeadSourceDefault: Boolean(input.deliveryAccount.config.apify.defaultActorId.trim()),
    deploymentHasLeadSourceDefault: Boolean(PLATFORM_SOURCING_PROFILE),
    hasResolvedLeadSource: Boolean(sourceConfig.actorId),
    hasLeadSourcingToken: Boolean(effectiveSourcingToken(input.deliverySecrets)),
  } as const;

  if (input.reason === "Lead sourcing credentials are missing") {
    return {
      hint: "Platform lead sourcing credentials are missing in this deployment. This is platform-managed (not per-user).",
      debug,
    };
  }
  return { hint: "", debug };
}

function classifySentiment(body: string): ReplyThread["sentiment"] {
  const normalized = body.toLowerCase();
  if (/(not interested|stop|unsubscribe|remove me|no thanks)/.test(normalized)) {
    return "negative";
  }
  if (/(interested|sounds good|let's talk|book|yes)/.test(normalized)) {
    return "positive";
  }
  return "neutral";
}

function classifyIntent(body: string): ReplyThread["intent"] {
  const normalized = body.toLowerCase();
  if (/(unsubscribe|remove me|stop emailing)/.test(normalized)) {
    return "unsubscribe";
  }
  if (/(price|how much|details|question|what does)/.test(normalized)) {
    return "question";
  }
  if (/(interested|book|call|chat|learn more)/.test(normalized)) {
    return "interest";
  }
  if (/(already|not now|budget|timing|no need)/.test(normalized)) {
    return "objection";
  }
  return "other";
}

function threadDraftBody(input: { from: string; subject: string; body: string }) {
  const summaryLine = input.body.split("\n")[0]?.slice(0, 180) || "Thanks for your reply.";
  return `Thanks ${input.from.split("@")[0]},\n\nAppreciate the response on \"${input.subject}\".\n\n${summaryLine}\n\nWould a short 15-minute call next week be useful?`;
}

function addHours(dateIso: string, hours: number) {
  const date = new Date(dateIso);
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

async function failRunWithDiagnostics(input: {
  run: { id: string; brandId: string; campaignId: string; experimentId: string };
  reason: string;
  eventType?: string;
  payload?: Record<string, unknown>;
}) {
  await updateOutreachRun(input.run.id, { status: "failed", lastError: input.reason });
  await markExperimentExecutionStatus(input.run.brandId, input.run.campaignId, input.run.experimentId, "failed");
  await createOutreachEvent({
    runId: input.run.id,
    eventType: input.eventType ?? "run_failed",
    payload: {
      reason: input.reason,
      ...(input.payload ?? {}),
    },
  });
}

function calculateRunMetricsFromMessages(
  runId: string,
  messages: Awaited<ReturnType<typeof listRunMessages>>,
  threads: ReplyThread[]
) {
  const runMessages = messages.filter((item) => item.runId === runId);
  const sentMessages = runMessages.filter((item) => item.status === "sent").length;
  const bouncedMessages = runMessages.filter((item) => item.status === "bounced").length;
  const failedMessages = runMessages.filter((item) => item.status === "failed").length;
  const replies = threads.filter((item) => item.runId === runId).length;
  const positiveReplies = threads.filter(
    (item) => item.runId === runId && item.sentiment === "positive"
  ).length;
  const negativeReplies = threads.filter(
    (item) => item.runId === runId && item.sentiment === "negative"
  ).length;

  return {
    sentMessages,
    bouncedMessages,
    failedMessages,
    replies,
    positiveReplies,
    negativeReplies,
  };
}

async function ensureBrandAccount(brandId: string): Promise<{
  ok: boolean;
  reason: string;
  accountId: string;
  mailboxAccountId?: string;
  deliveryAccount?: ResolvedAccount;
  deliverySecrets?: ResolvedSecrets;
  mailboxAccount?: ResolvedAccount;
  mailboxSecrets?: ResolvedSecrets;
}> {
  const assignment = await getBrandOutreachAssignment(brandId);
  if (!assignment || !assignment.accountId.trim()) {
    return { ok: false, reason: "No outreach delivery account assigned to brand", accountId: "" };
  }

  const deliveryAccount = await getOutreachAccount(assignment.accountId);
  if (!deliveryAccount || deliveryAccount.status !== "active") {
    return {
      ok: false,
      reason: "Assigned outreach delivery account is missing or inactive",
      accountId: assignment.accountId,
    };
  }

  const deliverySecrets = await getOutreachAccountSecrets(deliveryAccount.id);
  if (!deliverySecrets) {
    return {
      ok: false,
      reason: "Assigned delivery account credentials are missing",
      accountId: assignment.accountId,
    };
  }

  const mailboxAccountId = assignment.mailboxAccountId || assignment.accountId;
  const mailboxAccount =
    mailboxAccountId === deliveryAccount.id
      ? deliveryAccount
      : await getOutreachAccount(mailboxAccountId);
  if (!mailboxAccount || mailboxAccount.status !== "active") {
    return {
      ok: false,
      reason: "Assigned mailbox account is missing or inactive",
      accountId: assignment.accountId,
    };
  }

  const mailboxSecrets =
    mailboxAccount.id === deliveryAccount.id
      ? deliverySecrets
      : await getOutreachAccountSecrets(mailboxAccount.id);
  if (!mailboxSecrets) {
    return {
      ok: false,
      reason: "Assigned mailbox account credentials are missing",
      accountId: assignment.accountId,
    };
  }

  return {
    ok: true,
    reason: "",
    accountId: assignment.accountId,
    mailboxAccountId,
    deliveryAccount,
    deliverySecrets,
    mailboxAccount,
    mailboxSecrets,
  };
}

async function resolveMailboxAccountForRun(run: { brandId: string; accountId: string }) {
  const assignment = await getBrandOutreachAssignment(run.brandId);
  const mailboxAccountId = assignment?.mailboxAccountId || assignment?.accountId || run.accountId;
  const account = await getOutreachAccount(mailboxAccountId);
  if (!account || account.status !== "active" || !supportsMailbox(account)) {
    return null;
  }
  const secrets = await getOutreachAccountSecrets(mailboxAccountId);
  if (!secrets) {
    return null;
  }
  return { account, secrets };
}

async function markExperimentExecutionStatus(
  brandId: string,
  campaignId: string,
  experimentId: string,
  executionStatus: Experiment["executionStatus"]
) {
  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) return;
  const nextExperiments = campaign.experiments.map((experiment) =>
    experiment.id === experimentId ? { ...experiment, executionStatus } : experiment
  );
  await updateCampaign(brandId, campaignId, { experiments: nextExperiments });
}

async function createDefaultExperimentForHypothesis(
  brandId: string,
  campaignId: string,
  hypothesis: Hypothesis
): Promise<Experiment | null> {
  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) return null;

  const experiment: Experiment = {
    id: `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    hypothesisId: hypothesis.id,
    name: `${hypothesis.title} / Autopilot`,
    status: "testing",
    notes: "Auto-created from approved hypothesis for outreach autopilot.",
    runPolicy: defaultExperimentRunPolicy(),
    executionStatus: "idle",
  };

  await updateCampaign(brandId, campaignId, {
    experiments: [experiment, ...campaign.experiments],
  });

  return experiment;
}

export async function launchExperimentRun(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
  trigger: "manual" | "hypothesis_approved";
}): Promise<{
  ok: boolean;
  runId: string;
  reason: string;
  hint?: string;
  debug?: Record<string, unknown>;
}> {
  const campaign = await getCampaignById(input.brandId, input.campaignId);
  if (!campaign) {
    return { ok: false, runId: "", reason: "Campaign not found" };
  }

  const experiment = findExperiment(campaign, input.experimentId);
  if (!experiment) {
    return { ok: false, runId: "", reason: "Experiment not found" };
  }

  const hypothesis = findHypothesis(campaign, experiment.hypothesisId);
  if (!hypothesis) {
    return { ok: false, runId: "", reason: "Linked hypothesis not found" };
  }

  if (hypothesis.status !== "approved" && input.trigger !== "manual") {
    return { ok: false, runId: "", reason: "Hypothesis must be approved before auto-run" };
  }

  const activeRuns = await listExperimentRuns(input.brandId, input.campaignId, experiment.id);
  const hasOpenRun = activeRuns.some((run) =>
    ["queued", "sourcing", "scheduled", "sending", "monitoring", "paused"].includes(run.status)
  );
  if (hasOpenRun) {
    return { ok: false, runId: "", reason: "Experiment already has an active run" };
  }

  const brandAccount = await ensureBrandAccount(input.brandId);
  if (
    !brandAccount.ok ||
    !brandAccount.deliveryAccount ||
    !brandAccount.deliverySecrets ||
    !brandAccount.mailboxAccount ||
    !brandAccount.mailboxSecrets
  ) {
    const failed = await createOutreachRun({
      brandId: input.brandId,
      campaignId: input.campaignId,
      experimentId: experiment.id,
      hypothesisId: hypothesis.id,
      accountId: brandAccount.accountId || "",
      status: "preflight_failed",
      dailyCap: experiment.runPolicy?.dailyCap ?? 30,
      hourlyCap: experiment.runPolicy?.hourlyCap ?? 6,
      timezone: experiment.runPolicy?.timezone || DEFAULT_TIMEZONE,
      minSpacingMinutes: experiment.runPolicy?.minSpacingMinutes ?? 8,
      lastError: brandAccount.reason,
    });
    await markExperimentExecutionStatus(input.brandId, input.campaignId, experiment.id, "failed");
    await createOutreachEvent({
      runId: failed.id,
      eventType: "hypothesis_approved_auto_run_queued",
      payload: { trigger: input.trigger, outcome: "preflight_failed", reason: brandAccount.reason },
    });
    return { ok: false, runId: failed.id, reason: brandAccount.reason };
  }

  const reason = preflightReason({
    deliveryAccount: brandAccount.deliveryAccount,
    deliverySecrets: brandAccount.deliverySecrets,
    mailboxAccount: brandAccount.mailboxAccount,
    mailboxSecrets: brandAccount.mailboxSecrets,
    hypothesis,
  });
  if (reason) {
    const diagnostic = preflightDiagnostic({
      reason,
      hypothesis,
      deliveryAccount: brandAccount.deliveryAccount,
      deliverySecrets: brandAccount.deliverySecrets,
    });
    const failed = await createOutreachRun({
      brandId: input.brandId,
      campaignId: input.campaignId,
      experimentId: experiment.id,
      hypothesisId: hypothesis.id,
      accountId: brandAccount.deliveryAccount.id,
      status: "preflight_failed",
      dailyCap: experiment.runPolicy?.dailyCap ?? 30,
      hourlyCap: experiment.runPolicy?.hourlyCap ?? 6,
      timezone: experiment.runPolicy?.timezone || DEFAULT_TIMEZONE,
      minSpacingMinutes: experiment.runPolicy?.minSpacingMinutes ?? 8,
      lastError: reason,
    });
    await markExperimentExecutionStatus(input.brandId, input.campaignId, experiment.id, "failed");
    await createOutreachEvent({
      runId: failed.id,
      eventType: "hypothesis_approved_auto_run_queued",
      payload: { trigger: input.trigger, outcome: "preflight_failed", reason },
    });
    return {
      ok: false,
      runId: failed.id,
      reason,
      hint: diagnostic.hint,
      debug: diagnostic.debug,
    };
  }

  const run = await createOutreachRun({
    brandId: input.brandId,
    campaignId: input.campaignId,
    experimentId: experiment.id,
    hypothesisId: hypothesis.id,
    accountId: brandAccount.deliveryAccount.id,
    status: "queued",
    dailyCap: experiment.runPolicy?.dailyCap ?? 30,
    hourlyCap: experiment.runPolicy?.hourlyCap ?? 6,
    timezone: experiment.runPolicy?.timezone || DEFAULT_TIMEZONE,
    minSpacingMinutes: experiment.runPolicy?.minSpacingMinutes ?? 8,
  });

  await enqueueOutreachJob({
    runId: run.id,
    jobType: "source_leads",
    executeAfter: nowIso(),
  });
  await markExperimentExecutionStatus(input.brandId, input.campaignId, experiment.id, "queued");
  await createOutreachEvent({
    runId: run.id,
    eventType: "hypothesis_approved_auto_run_queued",
    payload: { trigger: input.trigger },
  });

  return { ok: true, runId: run.id, reason: "Run queued" };
}

export async function autoQueueApprovedHypothesisRuns(input: {
  brandId: string;
  campaignId: string;
  previous: CampaignRecord;
  next: CampaignRecord;
}): Promise<void> {
  const transitions = input.next.hypotheses.filter((nextHypothesis) => {
    if (nextHypothesis.status !== "approved") return false;
    const previousHypothesis = input.previous.hypotheses.find((item) => item.id === nextHypothesis.id);
    return previousHypothesis?.status !== "approved";
  });

  if (!transitions.length) return;

  for (const hypothesis of transitions) {
    let campaign = await getCampaignById(input.brandId, input.campaignId);
    if (!campaign) continue;

    let relatedExperiments = campaign.experiments.filter((experiment) => experiment.hypothesisId === hypothesis.id);
    if (!relatedExperiments.length) {
      const created = await createDefaultExperimentForHypothesis(input.brandId, input.campaignId, hypothesis);
      if (created) {
        relatedExperiments = [created];
      }
    }

    campaign = await getCampaignById(input.brandId, input.campaignId);
    if (!campaign) continue;
    relatedExperiments = campaign.experiments.filter((experiment) => experiment.hypothesisId === hypothesis.id);

    for (const experiment of relatedExperiments) {
      await launchExperimentRun({
        brandId: input.brandId,
        campaignId: input.campaignId,
        experimentId: experiment.id,
        trigger: "hypothesis_approved",
      });
    }
  }
}

async function processSourceLeadsJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (!["queued", "sourcing"].includes(run.status)) {
    return;
  }

  const existingLeads = await listRunLeads(run.id);
  if (existingLeads.length) {
    await updateOutreachRun(run.id, {
      status: run.status === "queued" || run.status === "sourcing" ? "scheduled" : run.status,
      lastError: "",
      metrics: {
        ...run.metrics,
        sourcedLeads: existingLeads.length,
      },
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_skipped",
      payload: { reason: "leads_already_present", count: existingLeads.length },
    });
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "schedule_messages",
      executeAfter: nowIso(),
    });
    return;
  }

  const campaign = await getCampaignById(run.brandId, run.campaignId);
  if (!campaign) {
    await failRunWithDiagnostics({
      run,
      reason: "Campaign not found",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  const hypothesis = findHypothesis(campaign, run.hypothesisId);
  const experiment = findExperiment(campaign, run.experimentId);
  if (!hypothesis || !experiment) {
    await failRunWithDiagnostics({
      run,
      reason: "Hypothesis or experiment missing",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  const account = await getOutreachAccount(run.accountId);
  const secrets = await getOutreachAccountSecrets(run.accountId);
  if (!account || !secrets) {
    await failRunWithDiagnostics({
      run,
      reason: "Outreach account missing",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {};
  const stage = String((payload as Record<string, unknown>).stage ?? "").trim();

  const sourceConfig = effectiveSourceConfig(hypothesis, account.config.apify.defaultActorId);
  const sourcingToken = effectiveSourcingToken(secrets);
  const maxLeads = Math.max(1, Math.min(500, Number(sourceConfig.maxLeads ?? 100)));
  const targetAudience = hypothesis.actorQuery.trim();

  const brand = await getBrandById(run.brandId);
  const excludeDomains: string[] = [];
  if (brand?.website) {
    try {
      excludeDomains.push(new URL(brand.website).hostname.replace(/^www\./, "").toLowerCase());
    } catch {
      // ignore invalid
    }
  }

  if (run.status === "queued") {
    await updateOutreachRun(run.id, { status: "sourcing", lastError: "" });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "sourcing");
    await createOutreachEvent({ runId: run.id, eventType: "run_started", payload: {} });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_requested",
      payload: {
        strategy: sourceConfig.actorId ? "custom_actor" : "platform_search_then_email_discovery",
        maxLeads,
      },
    });
  }

  // Custom override: for backward compatibility (not exposed in UI).
  if (sourceConfig.actorId.trim()) {
    const sourced = await sourceLeadsFromApify({
      actorId: sourceConfig.actorId,
      actorInput: sourceConfig.actorInput,
      maxLeads,
      token: sourcingToken,
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_completed",
      payload: {
        sourcedCount: sourced.length,
        strategy: "custom_actor",
      },
    });

    if (!sourced.length) {
      await failRunWithDiagnostics({
        run,
        reason: "No leads sourced",
        eventType: "lead_sourcing_failed",
        payload: {
          sourcedCount: 0,
          maxLeads,
        },
      });
      return;
    }

    await finishSourcingWithLeads(run, sourced);
    return;
  }

  if (!targetAudience) {
    await failRunWithDiagnostics({
      run,
      reason: "Target Audience is empty for this hypothesis",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  const searchQuery =
    String((payload as Record<string, unknown>).searchQuery ?? "").trim() ||
    `${targetAudience} company website contact -site:linkedin.com -site:twitter.com -site:x.com -site:facebook.com -site:instagram.com -site:medium.com -site:quora.com -site:saastr.com -site:reddit.com -site:glassdoor.com -site:indeed.com -site:wikipedia.org -site:crunchbase.com`;

  const domainsRaw = (payload as Record<string, unknown>).domains;
  const domains = Array.isArray(domainsRaw)
    ? domainsRaw.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean)
    : [];
  const cursor = Math.max(0, Number((payload as Record<string, unknown>).cursor ?? 0) || 0);
  const chunkSize = Math.max(3, Math.min(12, Number((payload as Record<string, unknown>).chunkSize ?? 6) || 6));

  if (!stage) {
    const search = await runPlatformLeadDomainSearch({
      token: sourcingToken,
      query: searchQuery,
      maxResults: 30,
      excludeDomains,
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_search_completed",
      payload: {
        ok: search.ok,
        query: search.query,
        rawResultCount: search.rawResultCount,
        domainsFound: search.domains.length,
        filteredCount: search.filteredCount,
        error: search.error,
      },
    });

    if (!search.ok || !search.domains.length) {
      await failRunWithDiagnostics({
        run,
        reason: search.ok ? "No candidate domains found from lead search" : `Lead search failed: ${search.error}`,
        eventType: "lead_sourcing_failed",
        payload: {
          query: search.query,
          rawResultCount: search.rawResultCount,
        },
      });
      return;
    }

    await enqueueOutreachJob({
      runId: run.id,
      jobType: "source_leads",
      executeAfter: nowIso(),
      payload: {
        stage: "start_email_discovery",
        searchQuery: search.query,
        domains: search.domains,
        cursor: 0,
        chunkSize,
        maxLeads,
      },
    });
    return;
  }

  if (stage === "start_email_discovery") {
    if (!domains.length) {
      await failRunWithDiagnostics({
        run,
        reason: "No domains available for email discovery",
        eventType: "lead_sourcing_failed",
      });
      return;
    }

    const chunk = domains.slice(cursor, cursor + chunkSize);
    if (!chunk.length) {
      await failRunWithDiagnostics({
        run,
        reason: "No leads sourced (exhausted discovered domains)",
        eventType: "lead_sourcing_failed",
        payload: { domains: domains.length },
      });
      return;
    }

    const maxRequestsPerCrawl = Math.max(20, Math.min(80, chunk.length * 12));
    const started = await startPlatformEmailDiscovery({
      token: sourcingToken,
      domains: chunk,
      maxRequestsPerCrawl,
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_email_discovery_started",
      payload: {
        ok: started.ok,
        cursor,
        chunkSize: chunk.length,
        maxRequestsPerCrawl,
        error: started.error,
      },
    });

    if (!started.ok) {
      await failRunWithDiagnostics({
        run,
        reason: `Email discovery failed to start: ${started.error}`,
        eventType: "lead_sourcing_failed",
      });
      return;
    }

    await updateOutreachRun(run.id, { externalRef: started.runId });

    await enqueueOutreachJob({
      runId: run.id,
      jobType: "source_leads",
      executeAfter: new Date(Date.now() + 30_000).toISOString(),
      payload: {
        stage: "poll_email_discovery",
        searchQuery,
        domains,
        cursor,
        nextCursor: cursor + chunk.length,
        chunkSize,
        maxLeads,
        emailDiscoveryRunId: started.runId,
        emailDiscoveryDatasetId: started.datasetId,
      },
    });
    return;
  }

  if (stage === "poll_email_discovery") {
    const runId = String((payload as Record<string, unknown>).emailDiscoveryRunId ?? "").trim();
    const datasetId = String((payload as Record<string, unknown>).emailDiscoveryDatasetId ?? "").trim();
    const nextCursor = Math.max(0, Number((payload as Record<string, unknown>).nextCursor ?? cursor) || 0);

    const poll = await pollPlatformEmailDiscovery({ token: sourcingToken, runId });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_email_discovery_polled",
      payload: {
        ok: poll.ok,
        status: poll.status,
        error: poll.error,
      },
    });

    if (poll.ok && (poll.status === "ready" || poll.status === "running")) {
      await enqueueOutreachJob({
        runId: run.id,
        jobType: "source_leads",
        executeAfter: new Date(Date.now() + 30_000).toISOString(),
        payload: {
          ...payload,
          stage: "poll_email_discovery",
          emailDiscoveryDatasetId: poll.datasetId || datasetId,
          cursor,
          nextCursor,
        },
      });
      return;
    }

    if (!poll.ok && poll.status !== "succeeded") {
      await failRunWithDiagnostics({
        run,
        reason: `Email discovery failed: ${poll.error}`,
        eventType: "lead_sourcing_failed",
      });
      return;
    }

    const resolvedDatasetId = poll.datasetId || datasetId;
    const fetched = await fetchPlatformEmailDiscoveryResults({
      token: sourcingToken,
      datasetId: resolvedDatasetId,
      limit: 200,
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_email_discovery_completed",
      payload: {
        ok: fetched.ok,
        datasetRows: fetched.rows.length,
        error: fetched.error,
      },
    });

    if (!fetched.ok) {
      await failRunWithDiagnostics({
        run,
        reason: `Email discovery results fetch failed: ${fetched.error}`,
        eventType: "lead_sourcing_failed",
      });
      return;
    }

    const discovered = leadsFromEmailDiscoveryRows(fetched.rows, maxLeads);
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_completed",
      payload: {
        sourcedCount: discovered.length,
        strategy: "platform_search_then_email_discovery",
      },
    });

    if (!discovered.length) {
      await enqueueOutreachJob({
        runId: run.id,
        jobType: "source_leads",
        executeAfter: nowIso(),
        payload: {
          stage: "start_email_discovery",
          searchQuery,
          domains,
          cursor: nextCursor,
          chunkSize,
          maxLeads,
        },
      });
      return;
    }

    await finishSourcingWithLeads(run, discovered);
    return;
  }

  await failRunWithDiagnostics({
    run,
    reason: `Unknown lead sourcing stage: ${stage}`,
    eventType: "lead_sourcing_failed",
  });
  return;
}

async function finishSourcingWithLeads(run: NonNullable<Awaited<ReturnType<typeof getOutreachRun>>>, leads: ApifyLead[]) {
  const recentRuns = (await listCampaignRuns(run.brandId, run.campaignId)).filter((item) => {
    if (item.id === run.id) return false;
    const ageMs = Date.now() - new Date(item.createdAt).getTime();
    return ageMs <= 14 * DAY_MS;
  });
  const blockedEmails = new Set<string>();
  for (const recent of recentRuns) {
    const recentLeads = await listRunLeads(recent.id);
    for (const lead of recentLeads) {
      if (["scheduled", "sent", "replied", "bounced", "unsubscribed"].includes(lead.status)) {
        blockedEmails.add(lead.email.toLowerCase());
      }
    }
  }

  const filteredLeads = leads.filter((lead) => !blockedEmails.has(lead.email.toLowerCase()));
  if (!filteredLeads.length) {
    await failRunWithDiagnostics({
      run,
      reason: "All sourced leads were suppressed by 14-day duplicate policy",
      eventType: "lead_sourcing_failed",
      payload: {
        sourcedCount: leads.length,
        blockedCount: leads.length,
      },
    });
    return;
  }

  const upserted = await upsertRunLeads(
    run.id,
    run.brandId,
    run.campaignId,
    filteredLeads.map((lead) => ({
      email: lead.email,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      domain: lead.domain,
      sourceUrl: lead.sourceUrl,
    }))
  );

  await updateOutreachRun(run.id, {
    status: "scheduled",
    lastError: "",
    metrics: {
      ...run.metrics,
      sourcedLeads: upserted.length,
    },
  });
  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourced_apify",
    payload: {
      count: upserted.length,
      blockedCount: Math.max(0, leads.length - filteredLeads.length),
    },
  });

  await enqueueOutreachJob({
    runId: run.id,
    jobType: "schedule_messages",
    executeAfter: nowIso(),
  });
}

async function processScheduleMessagesJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["paused", "completed", "canceled", "failed", "preflight_failed"].includes(run.status)) return;

  const existingMessages = await listRunMessages(run.id);
  if (existingMessages.length) {
    await updateOutreachRun(run.id, {
      lastError: "",
      metrics: {
        ...run.metrics,
        scheduledMessages: Math.max(run.metrics.scheduledMessages, existingMessages.length),
      },
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "message_scheduling_skipped",
      payload: { reason: "messages_already_exist", count: existingMessages.length },
    });
    return;
  }

  const campaign = await getCampaignById(run.brandId, run.campaignId);
  if (!campaign) {
    await failRunWithDiagnostics({
      run,
      reason: "Campaign not found",
      eventType: "schedule_failed",
    });
    return;
  }

  const brand = await getBrandById(run.brandId);
  const hypothesis = findHypothesis(campaign, run.hypothesisId);
  const experiment = findExperiment(campaign, run.experimentId);
  if (!hypothesis || !experiment) {
    await failRunWithDiagnostics({
      run,
      reason: "Hypothesis or experiment missing",
      eventType: "schedule_failed",
    });
    return;
  }

  const leads = await listRunLeads(run.id);
  if (!leads.length) {
    await failRunWithDiagnostics({
      run,
      reason: "No leads sourced",
      eventType: "schedule_failed",
      payload: { sourcedLeads: run.metrics.sourcedLeads },
    });
    return;
  }

  const offsets = [0, 2, 7];
  const now = Date.now();
  const messages = leads.flatMap((lead) =>
    offsets.map((offsetDays, index) => {
      const scheduledAt = new Date(now + offsetDays * DAY_MS + index * run.minSpacingMinutes * 60 * 1000).toISOString();
      const composed = buildOutreachMessageBody({
        brandName: brand?.name || "Brand",
        experimentName: experiment.name,
        hypothesisTitle: hypothesis.title,
        step: index + 1,
        recipientName: lead.name,
      });
      return {
        runId: run.id,
        brandId: run.brandId,
        campaignId: run.campaignId,
        leadId: lead.id,
        step: index + 1,
        subject: composed.subject,
        body: composed.body,
        status: "scheduled" as const,
        scheduledAt,
      };
    })
  );

  await createRunMessages(messages);
  for (const lead of leads) {
    await updateRunLead(lead.id, { status: "scheduled" });
  }

  await updateOutreachRun(run.id, {
    status: "scheduled",
    metrics: {
      ...run.metrics,
      scheduledMessages: messages.length,
    },
  });
  await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "scheduled");
  await createOutreachEvent({ runId: run.id, eventType: "message_scheduled", payload: { count: messages.length } });

  await enqueueOutreachJob({ runId: run.id, jobType: "dispatch_messages", executeAfter: nowIso() });
  await enqueueOutreachJob({ runId: run.id, jobType: "analyze_run", executeAfter: addHours(nowIso(), 1) });
  await enqueueOutreachJob({ runId: run.id, jobType: "sync_replies", executeAfter: addHours(nowIso(), 1) });
}

function nextDispatchTime(messages: Awaited<ReturnType<typeof listRunMessages>>) {
  const pending = messages
    .filter((item) => item.status === "scheduled")
    .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1));
  return pending[0]?.scheduledAt ?? "";
}

async function processDispatchMessagesJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["paused", "completed", "canceled", "failed", "preflight_failed"].includes(run.status)) {
    return;
  }

  const account = await getOutreachAccount(run.accountId);
  const secrets = await getOutreachAccountSecrets(run.accountId);
  if (!account || !secrets) {
    await failRunWithDiagnostics({
      run,
      reason: "Account credentials missing",
      eventType: "dispatch_failed",
    });
    return;
  }

  const assignment = await getBrandOutreachAssignment(run.brandId);
  const mailboxAccountId = String(assignment?.mailboxAccountId ?? "").trim();
  let replyToEmail = "";
  if (mailboxAccountId) {
    const mailboxAccount =
      mailboxAccountId === account.id ? account : await getOutreachAccount(mailboxAccountId);
    replyToEmail = mailboxAccount?.config.mailbox.email?.trim() ?? "";
  }
  if (!replyToEmail) {
    replyToEmail = account.config.customerIo.replyToEmail.trim();
  }
  if (!replyToEmail) {
    replyToEmail = account.config.customerIo.fromEmail.trim();
  }

  await updateOutreachRun(run.id, { status: "sending" });
  await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "sending");

  const messages = await listRunMessages(run.id);
  const leads = await listRunLeads(run.id);
  const due = messages.filter(
    (message) => message.status === "scheduled" && toDate(message.scheduledAt).getTime() <= Date.now()
  );
  if (!due.length) {
    const nextAt = nextDispatchTime(messages);
    if (nextAt) {
      await enqueueOutreachJob({ runId: run.id, jobType: "dispatch_messages", executeAfter: nextAt });
      return;
    }

    await updateOutreachRun(run.id, {
      status: "monitoring",
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "monitoring");
    await enqueueOutreachJob({ runId: run.id, jobType: "analyze_run", executeAfter: addHours(nowIso(), 1) });
    return;
  }

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const hourlySent = messages.filter(
    (message) => message.status === "sent" && message.sentAt && toDate(message.sentAt).getTime() >= oneHourAgo
  ).length;
  const dailySent = messages.filter(
    (message) => message.status === "sent" && message.sentAt && toDate(message.sentAt).getTime() >= startOfDay.getTime()
  ).length;

  const hourlySlots = Math.max(0, run.hourlyCap - hourlySent);
  const dailySlots = Math.max(0, run.dailyCap - dailySent);
  const available = Math.max(0, Math.min(hourlySlots, dailySlots));

  if (available <= 0) {
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "dispatch_messages",
      executeAfter: addHours(nowIso(), 1),
    });
    return;
  }

  for (const message of due.slice(0, available)) {
    const lead = leads.find((item) => item.id === message.leadId);
    if (!lead || !lead.email) {
      await updateRunMessage(message.id, {
        status: "failed",
        lastError: "Lead email missing",
      });
      continue;
    }
    if (["unsubscribed", "bounced", "suppressed"].includes(lead.status)) {
      await updateRunMessage(message.id, {
        status: "canceled",
        lastError: `Lead blocked by suppression status: ${lead.status}`,
      });
      continue;
    }

    const send = await sendOutreachMessage({
      message,
      account,
      secrets,
      replyToEmail,
      recipient: lead.email,
      runId: run.id,
      experimentId: run.experimentId,
    });

    if (send.ok) {
      await updateRunMessage(message.id, {
        status: "sent",
        providerMessageId: send.providerMessageId,
        sentAt: nowIso(),
        lastError: "",
      });
      await updateRunLead(lead.id, { status: "sent" });
      await createOutreachEvent({ runId: run.id, eventType: "message_sent", payload: { messageId: message.id } });
    } else {
      await updateRunMessage(message.id, {
        status: "failed",
        lastError: send.error || "Send failed",
      });
    }
  }

  const refreshedMessages = await listRunMessages(run.id);
  const { threads } = await listReplyThreadsByBrand(run.brandId);
  const metrics = calculateRunMetricsFromMessages(run.id, refreshedMessages, threads);

  await updateOutreachRun(run.id, {
    status: "sending",
    metrics: {
      ...run.metrics,
      sentMessages: metrics.sentMessages,
      bouncedMessages: metrics.bouncedMessages,
      failedMessages: metrics.failedMessages,
      replies: metrics.replies,
      positiveReplies: metrics.positiveReplies,
      negativeReplies: metrics.negativeReplies,
    },
  });

  const nextAt = nextDispatchTime(refreshedMessages);
  if (nextAt) {
    await enqueueOutreachJob({ runId: run.id, jobType: "dispatch_messages", executeAfter: nextAt });
  } else {
    await updateOutreachRun(run.id, {
      status: "monitoring",
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "monitoring");
    await enqueueOutreachJob({ runId: run.id, jobType: "analyze_run", executeAfter: addHours(nowIso(), 1) });
  }
}

async function processSyncRepliesJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["completed", "canceled", "failed", "preflight_failed"].includes(run.status)) return;

  await createOutreachEvent({
    runId: run.id,
    eventType: "reply_sync_tick",
    payload: {
      note: "Mailbox sync should post replies via webhook endpoint",
    },
  });

  await enqueueOutreachJob({
    runId: run.id,
    jobType: "sync_replies",
    executeAfter: addHours(nowIso(), 1),
  });
}

async function processAnalyzeRunJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["canceled", "completed", "failed", "preflight_failed"].includes(run.status)) return;

  const messages = await listRunMessages(run.id);
  const { threads } = await listReplyThreadsByBrand(run.brandId);
  const metrics = calculateRunMetricsFromMessages(run.id, messages, threads);

  const delivered = Math.max(1, metrics.sentMessages + metrics.bouncedMessages);
  const attempted = Math.max(1, metrics.sentMessages + metrics.failedMessages + metrics.bouncedMessages);
  const replyCount = Math.max(1, metrics.replies);

  const bounceRate = metrics.bouncedMessages / delivered;
  const providerErrorRate = metrics.failedMessages / attempted;
  const negativeReplyRate = metrics.negativeReplies / replyCount;

  let paused = false;

  if (metrics.bouncedMessages >= 5 && bounceRate > 0.05) {
    paused = true;
    await createRunAnomaly({
      runId: run.id,
      type: "hard_bounce_rate",
      severity: "critical",
      threshold: 0.05,
      observed: bounceRate,
      details: "Hard bounce rate exceeded 5%.",
    });
  }

  if (!paused && providerErrorRate > 0.2) {
    paused = true;
    await createRunAnomaly({
      runId: run.id,
      type: "provider_error_rate",
      severity: "critical",
      threshold: 0.2,
      observed: providerErrorRate,
      details: "Provider error rate exceeded 20%.",
    });
  }

  if (!paused && metrics.replies >= 4 && negativeReplyRate > 0.25) {
    paused = true;
    await createRunAnomaly({
      runId: run.id,
      type: "negative_reply_rate_spike",
      severity: "warning",
      threshold: 0.25,
      observed: negativeReplyRate,
      details: "Negative reply rate spike above 25%.",
    });
  }

  if (paused) {
    await updateOutreachRun(run.id, {
      status: "paused",
      pauseReason: "Auto-paused due to anomaly",
      metrics: {
        ...run.metrics,
        sentMessages: metrics.sentMessages,
        bouncedMessages: metrics.bouncedMessages,
        failedMessages: metrics.failedMessages,
        replies: metrics.replies,
        positiveReplies: metrics.positiveReplies,
        negativeReplies: metrics.negativeReplies,
      },
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "paused");
    await createOutreachEvent({
      runId: run.id,
      eventType: "run_paused_auto",
      payload: { bounceRate, providerErrorRate, negativeReplyRate },
    });
    return;
  }

  const pendingScheduled = messages.some((message) => message.status === "scheduled");
  if (!pendingScheduled) {
    await updateOutreachRun(run.id, {
      status: "completed",
      completedAt: nowIso(),
      metrics: {
        ...run.metrics,
        sentMessages: metrics.sentMessages,
        bouncedMessages: metrics.bouncedMessages,
        failedMessages: metrics.failedMessages,
        replies: metrics.replies,
        positiveReplies: metrics.positiveReplies,
        negativeReplies: metrics.negativeReplies,
      },
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "completed");
    return;
  }

  await updateOutreachRun(run.id, {
    status: "monitoring",
    metrics: {
      ...run.metrics,
      sentMessages: metrics.sentMessages,
      bouncedMessages: metrics.bouncedMessages,
      failedMessages: metrics.failedMessages,
      replies: metrics.replies,
      positiveReplies: metrics.positiveReplies,
      negativeReplies: metrics.negativeReplies,
    },
  });
  await enqueueOutreachJob({
    runId: run.id,
    jobType: "analyze_run",
    executeAfter: addHours(nowIso(), 1),
  });
}

async function processOutreachJob(job: OutreachJob) {
  if (job.jobType === "source_leads") {
    await processSourceLeadsJob(job);
    return;
  }
  if (job.jobType === "schedule_messages") {
    await processScheduleMessagesJob(job);
    return;
  }
  if (job.jobType === "dispatch_messages") {
    await processDispatchMessagesJob(job);
    return;
  }
  if (job.jobType === "sync_replies") {
    await processSyncRepliesJob(job);
    return;
  }
  await processAnalyzeRunJob(job);
}

export async function runOutreachTick(limit = 20): Promise<{
  processed: number;
  completed: number;
  failed: number;
}> {
  const jobs = await listDueOutreachJobs(limit);

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    const attempts = job.attempts + 1;
    await updateOutreachJob(job.id, { status: "running", attempts });
    await createOutreachEvent({
      runId: job.runId,
      eventType: "job_started",
      payload: {
        jobId: job.id,
        jobType: job.jobType,
        attempt: attempts,
        maxAttempts: job.maxAttempts,
      },
    });

    try {
      await processOutreachJob(job);
      await updateOutreachJob(job.id, {
        status: "completed",
        lastError: "",
      });
      await createOutreachEvent({
        runId: job.runId,
        eventType: "job_completed",
        payload: {
          jobId: job.id,
          jobType: job.jobType,
          attempt: attempts,
        },
      });
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Job failed";
      if (attempts >= job.maxAttempts) {
        await updateOutreachJob(job.id, {
          status: "failed",
          lastError: message,
        });
      } else {
        const delayMinutes = Math.min(60, attempts * 5);
        const next = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
        await updateOutreachJob(job.id, {
          status: "queued",
          executeAfter: next,
          lastError: message,
        });
      }
      await createOutreachEvent({
        runId: job.runId,
        eventType: "job_failed",
        payload: {
          jobId: job.id,
          jobType: job.jobType,
          attempt: attempts,
          maxAttempts: job.maxAttempts,
          error: message,
          willRetry: attempts < job.maxAttempts,
        },
      });
      failed += 1;
    }
  }

  return {
    processed: jobs.length,
    completed,
    failed,
  };
}

export async function updateRunControl(input: {
  brandId: string;
  campaignId: string;
  runId: string;
  action: "pause" | "resume" | "cancel";
  reason?: string;
}): Promise<{ ok: boolean; reason: string }> {
  const run = await getOutreachRun(input.runId);
  if (!run || run.brandId !== input.brandId || run.campaignId !== input.campaignId) {
    return { ok: false, reason: "Run not found" };
  }

  if (input.action === "pause") {
    await updateOutreachRun(run.id, {
      status: "paused",
      pauseReason: input.reason?.trim() || "Paused by user",
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "paused");
    return { ok: true, reason: "Run paused" };
  }

  if (input.action === "resume") {
    if (run.status !== "paused") {
      return { ok: false, reason: "Run is not paused" };
    }
    await updateOutreachRun(run.id, {
      status: "sending",
      pauseReason: "",
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "sending");
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "dispatch_messages",
      executeAfter: nowIso(),
    });
    await createOutreachEvent({ runId: run.id, eventType: "run_resumed_manual", payload: {} });
    return { ok: true, reason: "Run resumed" };
  }

  await updateOutreachRun(run.id, {
    status: "canceled",
    completedAt: nowIso(),
    pauseReason: input.reason?.trim() || "Canceled by user",
  });
  await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "failed");
  return { ok: true, reason: "Run canceled" };
}

export async function ingestInboundReply(input: {
  brandId?: string;
  campaignId?: string;
  runId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  providerMessageId?: string;
}): Promise<{ ok: boolean; threadId: string; draftId: string; reason: string }> {
  const run = await getOutreachRun(input.runId);
  if (!run) {
    return { ok: false, threadId: "", draftId: "", reason: "Run not found" };
  }
  const brandId = input.brandId?.trim() || run.brandId;
  const campaignId = input.campaignId?.trim() || run.campaignId;
  if (run.brandId !== brandId || run.campaignId !== campaignId) {
    return { ok: false, threadId: "", draftId: "", reason: "Run/brand/campaign mismatch" };
  }

  const leads = await listRunLeads(run.id);
  const lead = leads.find((item) => item.email.toLowerCase() === input.from.toLowerCase()) ?? leads[0];
  if (!lead) {
    return { ok: false, threadId: "", draftId: "", reason: "No lead matched for reply" };
  }

  const sentiment = classifySentiment(input.body);
  const intent = classifyIntent(input.body);

  const { threads } = await listReplyThreadsByBrand(brandId);
  let thread = threads.find(
    (item) =>
      item.runId === run.id &&
      item.leadId === lead.id &&
      item.subject.trim().toLowerCase() === input.subject.trim().toLowerCase()
  );

  if (!thread) {
    thread = await createReplyThread({
      brandId: run.brandId,
      campaignId: run.campaignId,
      runId: run.id,
      leadId: lead.id,
      subject: input.subject,
      sentiment,
      intent,
      status: "new",
    });
  } else {
    const updated = await updateReplyThread(thread.id, {
      sentiment,
      intent,
      status: "open",
      lastMessageAt: nowIso(),
    });
    if (updated) {
      thread = updated;
    }
  }

  await createReplyMessage({
    threadId: thread.id,
    runId: run.id,
    direction: "inbound",
    from: input.from,
    to: input.to,
    subject: input.subject,
    body: input.body,
    providerMessageId: input.providerMessageId ?? "",
  });

  const draft = await createReplyDraft({
    threadId: thread.id,
    brandId: run.brandId,
    runId: run.id,
    subject: `Re: ${input.subject}`,
    body: threadDraftBody({ from: input.from, subject: input.subject, body: input.body }),
    reason: `Auto-generated from ${intent} reply`,
  });

  await updateRunLead(lead.id, { status: intent === "unsubscribe" ? "unsubscribed" : "replied" });

  const messages = await listRunMessages(run.id);
  const { threads: refreshedThreads } = await listReplyThreadsByBrand(run.brandId);
  const metrics = calculateRunMetricsFromMessages(run.id, messages, refreshedThreads);

  await updateOutreachRun(run.id, {
    metrics: {
      ...run.metrics,
      replies: metrics.replies,
      positiveReplies: metrics.positiveReplies,
      negativeReplies: metrics.negativeReplies,
      sentMessages: metrics.sentMessages,
      bouncedMessages: metrics.bouncedMessages,
      failedMessages: metrics.failedMessages,
    },
  });

  await createOutreachEvent({ runId: run.id, eventType: "reply_ingested", payload: { threadId: thread.id } });
  await createOutreachEvent({ runId: run.id, eventType: "reply_draft_created", payload: { draftId: draft.id } });

  return {
    ok: true,
    threadId: thread.id,
    draftId: draft.id,
    reason: "Reply ingested",
  };
}

export async function approveReplyDraftAndSend(input: {
  brandId: string;
  draftId: string;
}): Promise<{ ok: boolean; reason: string }> {
  const draft = await getReplyDraft(input.draftId);
  if (!draft || draft.brandId !== input.brandId) {
    return { ok: false, reason: "Draft not found" };
  }
  if (draft.status !== "draft") {
    return { ok: false, reason: "Draft already sent or dismissed" };
  }

  const thread = await getReplyThread(draft.threadId);
  if (!thread) {
    return { ok: false, reason: "Reply thread not found" };
  }

  const run = await getOutreachRun(draft.runId);
  if (!run) {
    return { ok: false, reason: "Run not found" };
  }

  const mailbox = await resolveMailboxAccountForRun(run);
  if (!mailbox) {
    return { ok: false, reason: "Reply mailbox account missing or invalid" };
  }

  const leads = await listRunLeads(run.id);
  const lead = leads.find((item) => item.id === thread.leadId);
  if (!lead) {
    return { ok: false, reason: "Lead not found for thread" };
  }

  const send = await sendReplyDraftAsEvent({
    draft,
    account: mailbox.account,
    secrets: mailbox.secrets,
    recipient: lead.email,
  });

  if (!send.ok) {
    return { ok: false, reason: send.error || "Failed to send reply draft" };
  }

  await updateReplyDraft(draft.id, {
    status: "sent",
    sentAt: nowIso(),
  });

  await updateReplyThread(thread.id, {
    status: "open",
    lastMessageAt: nowIso(),
  });

  await createReplyMessage({
    threadId: thread.id,
    runId: run.id,
    direction: "outbound",
    from: mailbox.account.config.mailbox.email,
    to: lead.email,
    subject: draft.subject,
    body: draft.body,
    providerMessageId: `reply_${Date.now().toString(36)}`,
  });

  await createOutreachEvent({
    runId: run.id,
    eventType: "reply_draft_sent",
    payload: { draftId: draft.id },
  });

  return { ok: true, reason: "Reply sent" };
}

export async function ingestApifyRunComplete(input: {
  runId: string;
  leads: ApifyLead[];
}): Promise<{ ok: boolean; reason: string }> {
  const run = await getOutreachRun(input.runId);
  if (!run) {
    return { ok: false, reason: "Run not found" };
  }

  await upsertRunLeads(
    run.id,
    run.brandId,
    run.campaignId,
    input.leads.map((lead) => ({
      email: lead.email,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      domain: lead.domain,
      sourceUrl: lead.sourceUrl,
    }))
  );

  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourced_apify",
    payload: { count: input.leads.length, source: "webhook" },
  });

  await enqueueOutreachJob({
    runId: run.id,
    jobType: "schedule_messages",
    executeAfter: nowIso(),
  });

  return { ok: true, reason: "Apify leads ingested" };
}
