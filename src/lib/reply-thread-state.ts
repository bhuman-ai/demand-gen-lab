import { sanitizeAiText } from "@/lib/ai-sanitize";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import type {
  ReplyDraft,
  ReplyThread,
  ReplyThreadCanonicalState,
  ReplyThreadDetail,
  ReplyThreadDraftMeta,
  ReplyThreadFact,
  ReplyThreadHistoryItem,
  ReplyThreadMove,
  ReplyThreadStage,
  ReplyThreadStateDecision,
  ReplyThreadStateRecord,
} from "@/lib/factory-types";
import { getExperimentRecordByRuntimeRef } from "@/lib/experiment-data";
import { resolveLlmModel } from "@/lib/llm-router";
import {
  createReplyDraft,
  getOutreachRun,
  getReplyThread,
  getReplyThreadState,
  listReplyThreadFeedback,
  listReplyMessagesByThread,
  listReplyMessagesByRun,
  listReplyThreadsByBrand,
  listRunLeads,
  listRunMessages,
  updateReplyDraft,
  upsertReplyThreadState,
} from "@/lib/outreach-data";
import {
  getConversationSessionByLead,
  getPublishedConversationMapForExperiment,
} from "@/lib/conversation-flow-data";

type SyncDecisionHint = Partial<ReplyThreadStateDecision>;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nowIso() {
  return new Date().toISOString();
}

function oneLine(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clampZeroOne(value: unknown, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, Number(num.toFixed(3))));
}

function shortText(value: unknown, max = 220) {
  const text = oneLine(value);
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

const DRAFT_PLACEHOLDER_TOKEN = /{{\s*[^}\n]+\s*}}|\[\s*(?:your|sender|contact|company|brand|first|last|full|agent|rep)[^[\]\n]{0,40}(?:name|company|title|email|phone|signature|role)?[^[\]\n]*\]|<\s*(?:your|sender|contact|company|brand|first|last|full|agent|rep)[^>\n]{0,40}(?:name|company|title|email|phone|signature|role)?[^>\n]*>/i;
const SIGNOFF_LINE = /^(best|best regards|regards|kind regards|thanks|thank you|cheers|sincerely)[,!-]*$/i;

function containsDraftPlaceholderToken(value: string) {
  return DRAFT_PLACEHOLDER_TOKEN.test(String(value ?? ""));
}

function stripInlineDraftPlaceholders(value: string) {
  return String(value ?? "")
    .replace(/{{\s*[^}\n]+\s*}}/g, "")
    .replace(/\[\s*(?:your|sender|contact|company|brand|first|last|full|agent|rep)[^[\]\n]{0,40}(?:name|company|title|email|phone|signature|role)?[^[\]\n]*\]/gi, "")
    .replace(/<\s*(?:your|sender|contact|company|brand|first|last|full|agent|rep)[^>\n]{0,40}(?:name|company|title|email|phone|signature|role)?[^>\n]*>/gi, "");
}

function sanitizeDraftSubject(value: string) {
  const next = sanitizeAiText(stripInlineDraftPlaceholders(value).replace(/[ \t]{2,}/g, " "));
  return next.trim();
}

function sanitizeDraftBody(value: string) {
  const lines = String(value ?? "").split(/\r?\n/);
  const cleaned: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const trimmed = rawLine.trim();
    const nextTrimmed = (lines[index + 1] ?? "").trim();

    if (trimmed && containsDraftPlaceholderToken(trimmed)) {
      continue;
    }

    if (trimmed && SIGNOFF_LINE.test(trimmed) && nextTrimmed && containsDraftPlaceholderToken(nextTrimmed)) {
      continue;
    }

    const hadPlaceholder = containsDraftPlaceholderToken(rawLine);
    const stripped = stripInlineDraftPlaceholders(rawLine).replace(/[ \t]{2,}/g, " ").trimEnd();
    if (!stripped.trim()) {
      cleaned.push("");
      continue;
    }
    if (hadPlaceholder && SIGNOFF_LINE.test(stripped.trim())) {
      continue;
    }
    cleaned.push(stripped);
  }

  return sanitizeAiText(cleaned.join("\n").replace(/\n{3,}/g, "\n\n"));
}

function parseOfferAndCta(rawOffer: string) {
  const text = String(rawOffer ?? "").trim();
  if (!text) return { offer: "", cta: "" };
  const ctaMatch = text.match(/\bCTA\s*:\s*([^\n]+)/i);
  const cta = ctaMatch ? ctaMatch[1].trim() : "";
  const offer = text.replace(/\bCTA\s*:\s*[^\n]+/gi, "").replace(/\s{2,}/g, " ").trim();
  return { offer, cta };
}

function historyText(history: ReplyThreadHistoryItem[]) {
  return history
    .map((item) =>
      [
        `${item.direction.toUpperCase()} @ ${item.at}`,
        item.subject ? `Subject: ${item.subject}` : "",
        item.body ? `Body: ${item.body}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

function latestInbound(history: ReplyThreadHistoryItem[]) {
  return [...history].reverse().find((item) => item.direction === "inbound") ?? null;
}

function extractLatestUserAsk(body: string) {
  const text = shortText(body, 240);
  if (!text) return "";
  const questionSentence = text
    .split(/(?<=[?!])\s+/)
    .find((part) => /\?$/.test(part.trim()));
  return questionSentence ? oneLine(questionSentence) : text;
}

function inferMoveFromThread(thread: ReplyThread, latestDraft: ReplyDraft | null): ReplyThreadMove {
  if (thread.intent === "unsubscribe" || thread.status === "closed") {
    return "respect_opt_out";
  }
  if (latestDraft?.status === "draft" && /manual review/i.test(latestDraft.reason)) {
    return "handoff_to_human";
  }
  if (thread.intent === "question") return "answer_question";
  if (thread.intent === "interest") return "advance_next_step";
  if (thread.intent === "objection") return "reframe_objection";
  if (latestDraft?.status === "draft") return "ask_qualifying_question";
  return "soft_nurture";
}

function inferStageFromThread(
  thread: ReplyThread,
  move: ReplyThreadMove,
  latestInboundBody: string
): ReplyThreadStage {
  if (thread.intent === "unsubscribe" || thread.status === "closed") return "closed";
  if (move === "advance_next_step") return "advance_next_step";
  if (move === "reframe_objection" || thread.intent === "objection") return "handle_objection";
  if (move === "soft_nurture") return "nurture";
  if (move === "answer_question" || move === "ask_qualifying_question" || latestInboundBody.includes("?")) {
    return "qualify";
  }
  return "discover_relevance";
}

function stageGoal(stage: ReplyThreadStage) {
  if (stage === "discover_relevance") return "Establish relevance and earn a genuine reply.";
  if (stage === "qualify") return "Clarify fit and answer the most important open question.";
  if (stage === "handle_objection") return "Resolve uncertainty without overselling.";
  if (stage === "advance_next_step") return "Get the next concrete step agreed.";
  if (stage === "nurture") return "Keep the thread warm without pressure.";
  return "Close the thread cleanly and avoid unnecessary follow-up.";
}

function progressForStage(stage: ReplyThreadStage) {
  if (stage === "discover_relevance") return 0.18;
  if (stage === "qualify") return 0.38;
  if (stage === "handle_objection") return 0.55;
  if (stage === "advance_next_step") return 0.82;
  if (stage === "nurture") return 0.48;
  return 1;
}

function preferredMovesForStage(stage: ReplyThreadStage): ReplyThreadMove[] {
  if (stage === "discover_relevance") return ["ask_qualifying_question", "offer_proof"];
  if (stage === "qualify") return ["answer_question", "ask_qualifying_question", "offer_proof"];
  if (stage === "handle_objection") return ["reframe_objection", "offer_proof", "handoff_to_human"];
  if (stage === "advance_next_step") return ["advance_next_step", "answer_question"];
  if (stage === "nurture") return ["soft_nurture", "offer_proof"];
  return ["stay_silent", "respect_opt_out"];
}

function forbiddenMovesForStage(stage: ReplyThreadStage): ReplyThreadMove[] {
  if (stage === "closed") {
    return [
      "acknowledge_and_close",
      "answer_question",
      "ask_qualifying_question",
      "offer_proof",
      "reframe_objection",
      "advance_next_step",
      "soft_nurture",
      "handoff_to_human",
    ];
  }
  if (stage !== "advance_next_step") {
    return ["advance_next_step"];
  }
  return [];
}

function relationshipValue(title: string, sentiment: ReplyThread["sentiment"]) {
  const normalizedTitle = title.toLowerCase();
  if (/\b(founder|ceo|cto|chief|vp|head|director)\b/.test(normalizedTitle)) return "high" as const;
  if (sentiment === "positive") return "medium" as const;
  return "low" as const;
}

function buildConfirmedFacts(input: {
  brandName: string;
  offer: string;
  cta: string;
  contactEmail: string;
  leadName: string;
  leadCompany: string;
  leadTitle: string;
  thread: ReplyThread;
}): ReplyThreadFact[] {
  const facts: ReplyThreadFact[] = [];
  if (input.contactEmail) facts.push({ key: "contact_email", value: input.contactEmail, source: "thread", confidence: 1 });
  if (input.leadName) facts.push({ key: "lead_name", value: input.leadName, source: "crm", confidence: 1 });
  if (input.leadCompany) facts.push({ key: "lead_company", value: input.leadCompany, source: "crm", confidence: 1 });
  if (input.leadTitle) facts.push({ key: "lead_title", value: input.leadTitle, source: "crm", confidence: 1 });
  if (input.brandName) facts.push({ key: "brand_name", value: input.brandName, source: "brand_memory", confidence: 1 });
  if (input.offer) facts.push({ key: "offer", value: shortText(input.offer, 180), source: "brand_memory", confidence: 1 });
  if (input.cta) facts.push({ key: "cta", value: shortText(input.cta, 180), source: "brand_memory", confidence: 1 });
  facts.push({ key: "thread_intent", value: input.thread.intent, source: "thread", confidence: 1 });
  facts.push({ key: "thread_sentiment", value: input.thread.sentiment, source: "thread", confidence: 1 });
  return facts;
}

function buildDraftMeta(draft: ReplyDraft | null): ReplyThreadDraftMeta {
  if (!draft) {
    return {
      draftId: "",
      status: "none",
      subject: "",
      reason: "",
      createdAt: "",
    };
  }
  return {
    draftId: draft.id,
    status: draft.status,
    subject: draft.subject,
    reason: draft.reason,
    createdAt: draft.createdAt,
  };
}

function buildFallbackDecision(input: {
  thread: ReplyThread;
  latestInboundBody: string;
  latestDraft: ReplyDraft | null;
  hint?: SyncDecisionHint;
}): ReplyThreadStateDecision {
  const recommendedMove =
    input.hint?.recommendedMove && input.hint.recommendedMove.trim()
      ? input.hint.recommendedMove
      : inferMoveFromThread(input.thread, input.latestDraft);
  let objectiveForThisTurn = input.hint?.objectiveForThisTurn?.trim() || "";
  if (!objectiveForThisTurn) {
    if (recommendedMove === "answer_question") objectiveForThisTurn = "Answer the question directly and keep momentum.";
    else if (recommendedMove === "advance_next_step") objectiveForThisTurn = "Make the next step easy to accept.";
    else if (recommendedMove === "reframe_objection") objectiveForThisTurn = "Reduce risk and address the core objection.";
    else if (recommendedMove === "handoff_to_human") objectiveForThisTurn = "Escalate the thread for a thoughtful human review.";
    else if (recommendedMove === "respect_opt_out") objectiveForThisTurn = "Stop outreach and close the thread cleanly.";
    else objectiveForThisTurn = "Keep the thread moving with one low-friction response.";
  }

  return {
    recommendedMove,
    objectiveForThisTurn,
    rationale:
      input.hint?.rationale?.trim() ||
      input.latestDraft?.reason ||
      (input.thread.intent === "question"
        ? "The latest inbound message contains a concrete question."
        : input.thread.intent === "interest"
          ? "The lead showed interest and there is a meaningful next step to offer."
          : input.thread.intent === "objection"
            ? "The lead expressed doubt or resistance that needs a careful response."
            : input.thread.intent === "unsubscribe"
              ? "The lead indicated they do not want further outreach."
              : "The thread needs a low-pressure, contextual response."),
    confidence: clampZeroOne(input.hint?.confidence, input.thread.intent === "other" ? 0.52 : 0.74),
    autopilotOk:
      input.hint?.autopilotOk === true ||
      (input.thread.intent !== "unsubscribe" &&
        input.thread.intent !== "objection" &&
        !/strategic|partnership|referral|intro/i.test(input.latestInboundBody)),
    manualReviewReason:
      input.hint?.manualReviewReason?.trim() ||
      (recommendedMove === "handoff_to_human"
        ? input.latestDraft?.reason || "Manual review required."
        : ""),
  };
}

function extractOutputText(payloadRaw: unknown) {
  const payload = asRecord(payloadRaw);
  const output = Array.isArray(payload.output) ? payload.output : [];
  const firstOutput = asRecord(output[0]);
  const content = Array.isArray(firstOutput.content) ? firstOutput.content : [];
  return (
    String(payload.output_text ?? "") ||
    String(
      content
        .map((item) => asRecord(item))
        .find((item) => typeof item.text === "string")?.text ?? ""
    ) ||
    "{}"
  );
}

async function compileWithLlm(input: {
  brandName: string;
  brandWebsite: string;
  brandTone: string;
  brandNotes: string;
  productSummary: string;
  offer: string;
  cta: string;
  desiredOutcome: string;
  leadName: string;
  leadCompany: string;
  leadTitle: string;
  relationshipValue: "low" | "medium" | "high";
  latestInboundBody: string;
  fallbackDecision: ReplyThreadStateDecision;
  history: ReplyThreadHistoryItem[];
}): Promise<{
  thread: Pick<ReplyThreadCanonicalState["thread"], "rollingSummary" | "latestInboundSummary" | "latestUserAsk" | "currentStage" | "stageGoal" | "progressScore">;
  evidence: Pick<ReplyThreadCanonicalState["evidence"], "inferredFacts" | "openQuestions" | "objections" | "commitments" | "riskFlags" | "buyingSignals">;
  decision: ReplyThreadStateDecision;
  model: string;
} | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = [
    "You compile canonical reply thread state for a brand inbox.",
    "Return strict JSON only.",
    "Do not invent confirmed facts. Use inferredFacts for any uncertainty.",
    'Use one of these stages only: "discover_relevance","qualify","handle_objection","advance_next_step","nurture","closed".',
    'Use one of these moves only: "stay_silent","acknowledge_and_close","answer_question","ask_qualifying_question","offer_proof","reframe_objection","advance_next_step","soft_nurture","handoff_to_human","respect_opt_out".',
    'JSON shape: {"rollingSummary":"","latestInboundSummary":"","latestUserAsk":"","currentStage":"","stageGoal":"","progressScore":0-1,"inferredFacts":[{"key":"","value":"","confidence":0-1}],"openQuestions":[],"objections":[],"commitments":[],"riskFlags":[],"buyingSignals":[],"decision":{"recommendedMove":"","objectiveForThisTurn":"","rationale":"","confidence":0-1,"autopilotOk":true,"manualReviewReason":""}}',
    "",
    "Use the fallback decision as a strong hint unless the history clearly suggests a better move.",
    `Context JSON:\n${JSON.stringify({
      brandName: input.brandName,
      brandWebsite: input.brandWebsite,
      brandTone: input.brandTone,
      brandNotes: input.brandNotes,
      productSummary: input.productSummary,
      offer: input.offer,
      cta: input.cta,
      desiredOutcome: input.desiredOutcome,
      leadName: input.leadName,
      leadCompany: input.leadCompany,
      leadTitle: input.leadTitle,
      relationshipValue: input.relationshipValue,
      fallbackDecision: input.fallbackDecision,
      history: input.history.map((item) => ({
        direction: item.direction,
        subject: item.subject,
        body: item.body,
        at: item.at,
      })),
    })}`,
  ].join("\n");

  try {
    const model = resolveLlmModel("reply_thread_state_compile", {
      prompt,
      legacyModelEnv: process.env.REPLY_THREAD_STATE_MODEL,
    });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        text: { format: { type: "json_object" } },
        max_output_tokens: 1400,
      }),
    });
    const raw = await response.text();
    if (!response.ok) return null;
    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    const parsed = asRecord(JSON.parse(extractOutputText(payload)));
    const currentStage = String(parsed.currentStage ?? "").trim();
    const decisionRaw = asRecord(parsed.decision);
    const recommendedMove = String(decisionRaw.recommendedMove ?? "").trim();

    return {
      thread: {
        rollingSummary: sanitizeAiText(shortText(parsed.rollingSummary, 420)),
        latestInboundSummary: sanitizeAiText(shortText(parsed.latestInboundSummary, 240)),
        latestUserAsk: sanitizeAiText(shortText(parsed.latestUserAsk, 220)),
        currentStage: [
          "discover_relevance",
          "qualify",
          "handle_objection",
          "advance_next_step",
          "nurture",
          "closed",
        ].includes(currentStage)
          ? (currentStage as ReplyThreadStage)
          : inferStageFromThread(
              { intent: "other", status: "open", sentiment: "neutral" } as ReplyThread,
              input.fallbackDecision.recommendedMove,
              input.latestInboundBody
            ),
        stageGoal: sanitizeAiText(shortText(parsed.stageGoal, 180)),
        progressScore: clampZeroOne(parsed.progressScore, input.fallbackDecision.confidence),
      },
      evidence: {
        inferredFacts: asArray(parsed.inferredFacts)
          .map((item) => asRecord(item))
          .map((item) => ({
            key: oneLine(item.key),
            value: sanitizeAiText(shortText(item.value, 160)),
            source: "inference" as const,
            confidence: clampZeroOne(item.confidence, 0.5),
          }))
          .filter((item) => item.key && item.value)
          .slice(0, 8),
        openQuestions: asArray(parsed.openQuestions).map((item) => sanitizeAiText(shortText(item, 180))).filter(Boolean).slice(0, 6),
        objections: asArray(parsed.objections).map((item) => sanitizeAiText(shortText(item, 180))).filter(Boolean).slice(0, 6),
        commitments: asArray(parsed.commitments).map((item) => sanitizeAiText(shortText(item, 180))).filter(Boolean).slice(0, 6),
        riskFlags: asArray(parsed.riskFlags).map((item) => sanitizeAiText(shortText(item, 120))).filter(Boolean).slice(0, 6),
        buyingSignals: asArray(parsed.buyingSignals).map((item) => sanitizeAiText(shortText(item, 120))).filter(Boolean).slice(0, 6),
      },
      decision: {
        recommendedMove: [
          "stay_silent",
          "acknowledge_and_close",
          "answer_question",
          "ask_qualifying_question",
          "offer_proof",
          "reframe_objection",
          "advance_next_step",
          "soft_nurture",
          "handoff_to_human",
          "respect_opt_out",
        ].includes(recommendedMove)
          ? (recommendedMove as ReplyThreadMove)
          : input.fallbackDecision.recommendedMove,
        objectiveForThisTurn: sanitizeAiText(shortText(decisionRaw.objectiveForThisTurn, 180)) || input.fallbackDecision.objectiveForThisTurn,
        rationale: sanitizeAiText(shortText(decisionRaw.rationale, 220)) || input.fallbackDecision.rationale,
        confidence: clampZeroOne(decisionRaw.confidence, input.fallbackDecision.confidence),
        autopilotOk: decisionRaw.autopilotOk === true,
        manualReviewReason: sanitizeAiText(shortText(decisionRaw.manualReviewReason, 180)),
      },
      model,
    };
  } catch {
    return null;
  }
}

function buildThreadHistory(input: {
  threadId: string;
  leadId: string;
  runMessages: Awaited<ReturnType<typeof listRunMessages>>;
  replyMessages: Awaited<ReturnType<typeof listReplyMessagesByRun>>;
}): ReplyThreadHistoryItem[] {
  const outbound = input.runMessages
    .filter((message) => message.leadId === input.leadId && ["sent", "replied"].includes(message.status))
    .map((message) => ({
      id: message.id,
      source: "outreach_message" as const,
      direction: "outbound" as const,
      subject: message.subject,
      body: message.body,
      at: message.sentAt || message.scheduledAt || message.createdAt,
      status: message.status,
    }));

  const replies = input.replyMessages
    .filter((message) => message.threadId === input.threadId)
    .map((message) => ({
      id: message.id,
      source: "reply_message" as const,
      direction: message.direction,
      subject: message.subject,
      body: message.body,
      at: message.receivedAt || message.createdAt,
      status: message.direction === "inbound" ? "received" : "sent",
    }));

  return [...outbound, ...replies]
    .filter((item) => item.subject || item.body)
    .sort((a, b) => (a.at > b.at ? 1 : -1));
}

function buildReplyOnlyHistory(input: {
  threadId: string;
  replyMessages: Awaited<ReturnType<typeof listReplyMessagesByThread>>;
}): ReplyThreadHistoryItem[] {
  return input.replyMessages
    .filter((message) => message.threadId === input.threadId)
    .map((message) => ({
      id: message.id,
      source: "reply_message" as const,
      direction: message.direction,
      subject: message.subject,
      body: message.body,
      at: message.receivedAt || message.createdAt,
      status: message.direction === "inbound" ? "received" : "sent",
    }))
    .filter((item) => item.subject || item.body)
    .sort((a, b) => (a.at > b.at ? 1 : -1));
}

async function compileCanonicalState(input: {
  thread: ReplyThread;
  latestDraft: ReplyDraft | null;
  decisionHint?: SyncDecisionHint;
}): Promise<{ canonicalState: ReplyThreadCanonicalState; latestDecision: ReplyThreadStateDecision; latestDraftMeta: ReplyThreadDraftMeta } | null> {
  const run = input.thread.runId ? await getOutreachRun(input.thread.runId) : null;

  const [brand, campaign, runLeads, runMessages, replyMessages, sourceExperiment] = await Promise.all([
    getBrandById(input.thread.brandId),
    run && input.thread.campaignId
      ? getCampaignById(input.thread.brandId, input.thread.campaignId)
      : Promise.resolve(null),
    run ? listRunLeads(run.id) : Promise.resolve([]),
    run ? listRunMessages(run.id) : Promise.resolve([]),
    run ? listReplyMessagesByRun(run.id) : listReplyMessagesByThread(input.thread.id),
    run && input.thread.campaignId
      ? getExperimentRecordByRuntimeRef(run.brandId, input.thread.campaignId, run.experimentId)
      : Promise.resolve(null),
  ]);
  const lead = input.thread.leadId ? runLeads.find((item) => item.id === input.thread.leadId) ?? null : null;
  const contactEmail = input.thread.contactEmail || "";
  const contactName = input.thread.contactName || lead?.name || "";
  const contactCompany = input.thread.contactCompany || lead?.company || "";
  const contactTitle = lead?.title || "";

  const [flowMap, session] = await Promise.all([
    run && input.thread.campaignId
      ? getPublishedConversationMapForExperiment(run.brandId, input.thread.campaignId, run.experimentId)
      : Promise.resolve(null),
    run && lead
      ? getConversationSessionByLead({ runId: run.id, leadId: lead.id })
      : Promise.resolve(null),
  ]);

  const history =
    run && lead
      ? buildThreadHistory({
          threadId: input.thread.id,
          leadId: lead.id,
          runMessages,
          replyMessages,
        })
      : buildReplyOnlyHistory({
          threadId: input.thread.id,
          replyMessages,
        });
  const latestInboundMessage = latestInbound(history);
  const latestInboundBody = latestInboundMessage?.body ?? "";

  const parsedOffer = parseOfferAndCta(sourceExperiment?.offer ?? "");
  const desiredOutcome =
    parsedOffer.cta ||
    campaign?.objective.goal ||
    parsedOffer.offer ||
    sourceExperiment?.offer ||
    "Keep the conversation helpful and move toward the right next step.";

  const fallbackDecision = buildFallbackDecision({
    thread: input.thread,
    latestInboundBody,
    latestDraft: input.latestDraft,
    hint: input.decisionHint,
  });
  const fallbackStage = inferStageFromThread(input.thread, fallbackDecision.recommendedMove, latestInboundBody);
  const fallbackPolicyMoves = preferredMovesForStage(fallbackStage);

  const llmCompiled = await compileWithLlm({
    brandName: brand?.name ?? "",
    brandWebsite: brand?.website ?? "",
    brandTone: brand?.tone ?? "",
    brandNotes: brand?.notes ?? "",
    productSummary: brand?.product ?? "",
    offer: parsedOffer.offer || sourceExperiment?.offer || "",
    cta: parsedOffer.cta,
    desiredOutcome,
    leadName: contactName,
    leadCompany: contactCompany,
    leadTitle: contactTitle,
    relationshipValue: relationshipValue(contactTitle, input.thread.sentiment),
    latestInboundBody,
    fallbackDecision,
    history,
  });

  const currentStage = llmCompiled?.thread.currentStage ?? fallbackStage;
  const latestDecision = llmCompiled?.decision ?? fallbackDecision;
  const sourcesUsed = [
    "brand",
    input.thread.sourceType,
    campaign ? "campaign" : "",
    lead ? "lead" : "",
    `reply_history:${history.length}`,
    flowMap ? "conversation_map" : "",
    session ? "conversation_session" : "",
  ].filter(Boolean);

  const canonicalState: ReplyThreadCanonicalState = {
    ids: {
      threadId: input.thread.id,
      brandId: input.thread.brandId,
      campaignId: input.thread.campaignId,
      runId: input.thread.runId,
      leadId: input.thread.leadId,
      sourceType: input.thread.sourceType,
      mailboxAccountId: input.thread.mailboxAccountId,
    },
    org: {
      brandSummary: shortText(brand?.notes || brand?.name || "", 220),
      productSummary: shortText(brand?.product || "", 220),
      offerSummary: shortText(parsedOffer.offer || sourceExperiment?.offer || "", 220),
      tone: shortText(brand?.tone || "", 120),
      proofPoints: [...(brand?.keyBenefits ?? []), ...(brand?.keyFeatures ?? [])].filter(Boolean).slice(0, 6),
      allowedClaims: [
        "Use only facts grounded in the brand context, offer, and thread history.",
        "Keep replies selective, plainspoken, and concrete.",
      ],
      forbiddenClaims: [
        "Do not invent unavailable facts or customer results.",
        "Do not promise timing, approvals, or outcomes you cannot verify.",
      ],
      desiredOutcome: shortText(desiredOutcome, 180),
    },
    contact: {
      email: contactEmail,
      name: contactName,
      company: contactCompany,
      title: contactTitle,
      roleFit: shortText(contactTitle || "Unknown role", 120),
      relationshipValue: relationshipValue(contactTitle, input.thread.sentiment),
    },
    thread: {
      rollingSummary:
        llmCompiled?.thread.rollingSummary ||
        shortText(historyText(history), 420) ||
        "No thread summary yet.",
      latestInboundSummary:
        llmCompiled?.thread.latestInboundSummary ||
        shortText(latestInboundBody || latestInboundMessage?.subject || "", 220),
      latestUserAsk:
        llmCompiled?.thread.latestUserAsk ||
        extractLatestUserAsk(latestInboundBody || latestInboundMessage?.subject || ""),
      currentStage,
      stageGoal: llmCompiled?.thread.stageGoal || stageGoal(currentStage),
      progressScore: llmCompiled?.thread.progressScore ?? progressForStage(currentStage),
    },
    evidence: {
      confirmedFacts: buildConfirmedFacts({
        brandName: brand?.name ?? "",
        offer: parsedOffer.offer || sourceExperiment?.offer || "",
        cta: parsedOffer.cta,
        contactEmail,
        leadName: contactName,
        leadCompany: contactCompany,
        leadTitle: contactTitle,
        thread: input.thread,
      }),
      inferredFacts: llmCompiled?.evidence.inferredFacts ?? [],
      openQuestions:
        llmCompiled?.evidence.openQuestions ??
        (latestInboundBody.includes("?") ? [extractLatestUserAsk(latestInboundBody)] : []),
      objections:
        llmCompiled?.evidence.objections ??
        (input.thread.intent === "objection" ? [shortText(latestInboundBody, 160)] : []),
      commitments: llmCompiled?.evidence.commitments ?? [],
      riskFlags:
        llmCompiled?.evidence.riskFlags ??
        [
          input.thread.intent === "unsubscribe" ? "Contact requested no further outreach." : "",
          latestDecision.manualReviewReason ? latestDecision.manualReviewReason : "",
          input.thread.sentiment === "negative" ? "Negative sentiment detected in the latest reply." : "",
        ].filter(Boolean),
      buyingSignals:
        llmCompiled?.evidence.buyingSignals ??
        [
          input.thread.intent === "interest" ? "Lead showed active interest." : "",
          input.thread.intent === "question" ? "Lead asked a substantive question." : "",
          input.thread.sentiment === "positive" ? "Positive sentiment detected in the thread." : "",
        ].filter(Boolean),
    },
    policy: {
      preferredMoves: fallbackPolicyMoves,
      forbiddenMoves: forbiddenMovesForStage(currentStage),
      manualReviewTriggers: [
        "Partnership, referral, intro, or strategic relationship discussion",
        "Pricing or legal/compliance questions",
        "Ambiguous high-value reply",
      ],
      autopilotEnabled: latestDecision.autopilotOk,
    },
    decision: latestDecision,
    draft: {
      subject: input.latestDraft?.subject ?? "",
      body: input.latestDraft?.body ?? "",
      styleNotes: [
        brand?.tone ? `Tone: ${brand.tone}` : "",
        `Source: ${input.thread.sourceType}`,
        flowMap ? `Flow revision: ${flowMap.publishedRevision}` : "",
      ].filter(Boolean),
    },
    audit: {
      stateRevision: 1,
      sourcesUsed,
      model: llmCompiled?.model ?? "deterministic_fallback",
      generatedAt: nowIso(),
    },
  };

  return {
    canonicalState,
    latestDecision,
    latestDraftMeta: buildDraftMeta(input.latestDraft),
  };
}

function draftReasonFromDecision(decision: ReplyThreadStateDecision) {
  if (decision.manualReviewReason) return `Manual review: ${decision.manualReviewReason}`;
  return `Drafted for ${decision.recommendedMove.replace(/_/g, " ")}`;
}

function buildFallbackDraft(input: {
  thread: ReplyThread;
  state: ReplyThreadStateRecord;
}): { subject: string; body: string; reason: string } {
  const greeting = input.thread.contactName
    ? `Hi ${input.thread.contactName.split(/\s+/)[0] ?? input.thread.contactName},`
    : "Hi,";
  const latestAsk = input.state.canonicalState.thread.latestUserAsk;
  const latestSummary = input.state.canonicalState.thread.latestInboundSummary;
  const desiredOutcome = input.state.canonicalState.org.desiredOutcome;
  const objective = input.state.latestDecision.objectiveForThisTurn;
  const lines = [
    greeting,
    "",
    latestAsk
      ? `Thanks for the note. I want to respond clearly to your latest question: ${latestAsk}`
      : `Thanks for the note. ${latestSummary || "I wanted to follow up with a clear response."}`,
    objective || desiredOutcome
      ? `${objective || desiredOutcome}`
      : "I can keep this concise and make the next step straightforward if useful.",
  ];

  return {
    subject: input.thread.subject || "Re: Conversation",
    body: lines.filter(Boolean).join("\n"),
    reason: draftReasonFromDecision(input.state.latestDecision),
  };
}

async function generateDraftWithLlm(input: {
  thread: ReplyThread;
  state: ReplyThreadStateRecord;
  history: ReplyThreadHistoryItem[];
}): Promise<{ subject: string; body: string; reason: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = [
    "You write a natural email reply for a brand inbox.",
    "Return strict JSON only.",
    'JSON shape: {"subject":"","body":"","reason":""}',
    "Use only the provided context.",
    "Do not invent facts or promises.",
    "Keep the reply human, concise, and specific.",
    "Keep the existing thread subject unless a clearer reply subject is genuinely necessary.",
    "Do not output placeholder tokens, bracketed variables, or fake signatures like [Your Name].",
    "Only use a signer name if it is explicitly grounded in context. Otherwise end the email without a signature block.",
    "",
    `Context JSON:\n${JSON.stringify({
      thread: {
        subject: input.thread.subject,
        sourceType: input.thread.sourceType,
        contactEmail: input.thread.contactEmail,
        contactName: input.thread.contactName,
        contactCompany: input.thread.contactCompany,
      },
      state: input.state.canonicalState,
      decision: input.state.latestDecision,
      recentHistory: input.history.slice(-8),
    })}`,
  ].join("\n");

  try {
    const model = resolveLlmModel("reply_thread_draft_generate", {
      prompt,
      legacyModelEnv: process.env.REPLY_THREAD_DRAFT_MODEL,
    });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        text: { format: { type: "json_object" } },
        max_output_tokens: 1200,
      }),
    });
    const raw = await response.text();
    if (!response.ok) return null;
    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    const parsed = asRecord(JSON.parse(extractOutputText(payload)));
    const subject = sanitizeDraftSubject(shortText(parsed.subject, 180)) || input.thread.subject || "Re: Conversation";
    const body = sanitizeDraftBody(String(parsed.body ?? "").trim());
    if (containsDraftPlaceholderToken(subject) || containsDraftPlaceholderToken(body)) {
      return null;
    }
    if (!body) return null;
    return {
      subject,
      body,
      reason: sanitizeAiText(shortText(parsed.reason, 180)) || draftReasonFromDecision(input.state.latestDecision),
    };
  } catch {
    return null;
  }
}

export async function syncReplyThreadState(input: {
  threadId: string;
  decisionHint?: SyncDecisionHint;
}): Promise<ReplyThreadStateRecord | null> {
  const thread = await getReplyThread(input.threadId);
  if (!thread) return null;
  const { drafts } = await listReplyThreadsByBrand(thread.brandId, { includeEval: true });
  const latestDraft =
    drafts
      .filter((draft) => draft.threadId === thread.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  const compiled = await compileCanonicalState({
    thread,
    latestDraft,
    decisionHint: input.decisionHint,
  });
  if (!compiled) return null;
  return await upsertReplyThreadState({
    threadId: thread.id,
    brandId: thread.brandId,
    runId: thread.runId,
    canonicalState: compiled.canonicalState,
    latestDecision: compiled.latestDecision,
    latestDraftMeta: compiled.latestDraftMeta,
    sourcesUsed: compiled.canonicalState.audit.sourcesUsed,
  });
}

export async function generateReplyThreadDraft(input: {
  threadId: string;
}): Promise<ReplyDraft | null> {
  const detail = await getReplyThreadDetail(input.threadId);
  if (!detail?.state) return null;
  if (["stay_silent", "respect_opt_out"].includes(detail.state.latestDecision.recommendedMove)) {
    return null;
  }

  const existingDraft =
    detail.drafts.find((draft) => draft.status === "draft") ??
    detail.drafts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ??
    null;
  const generated =
    (await generateDraftWithLlm({
      thread: detail.thread,
      state: detail.state,
      history: detail.history,
    })) ?? buildFallbackDraft({ thread: detail.thread, state: detail.state });

  const saved =
    existingDraft && existingDraft.status === "draft"
      ? await updateReplyDraft(existingDraft.id, {
          subject: generated.subject,
          body: generated.body,
          reason: generated.reason,
        })
      : await createReplyDraft({
          threadId: detail.thread.id,
          brandId: detail.thread.brandId,
          runId: detail.thread.runId,
          subject: generated.subject,
          body: generated.body,
          reason: generated.reason,
        });

  if (saved) {
    await syncReplyThreadState({ threadId: detail.thread.id });
  }

  return saved;
}

export async function getReplyThreadDetail(threadId: string): Promise<ReplyThreadDetail | null> {
  const thread = await getReplyThread(threadId);
  if (!thread) return null;
  let state = await getReplyThreadState(thread.id);
  if (!state) {
    state = await syncReplyThreadState({ threadId: thread.id });
  }
  const run = thread.runId ? await getOutreachRun(thread.runId) : null;
  const [runLeads, runMessages, replyMessages, inbox] = await Promise.all([
    run ? listRunLeads(run.id) : Promise.resolve([]),
    run ? listRunMessages(run.id) : Promise.resolve([]),
    run ? listReplyMessagesByRun(run.id) : listReplyMessagesByThread(thread.id),
    listReplyThreadsByBrand(thread.brandId, { includeEval: true }),
  ]);
  const feedback = await listReplyThreadFeedback(thread.id);
  const lead = thread.leadId ? runLeads.find((item) => item.id === thread.leadId) ?? null : null;
  const history =
    run && thread.leadId
      ? buildThreadHistory({
          threadId: thread.id,
          leadId: thread.leadId,
          runMessages,
          replyMessages,
        })
      : buildReplyOnlyHistory({
          threadId: thread.id,
          replyMessages,
        });
  return {
    thread: state
      ? {
          ...thread,
          stateSummary: {
            currentStage: state.canonicalState.thread.currentStage,
            recommendedMove: state.latestDecision.recommendedMove,
            confidence: state.latestDecision.confidence,
            autopilotOk: state.latestDecision.autopilotOk,
            manualReviewReason: state.latestDecision.manualReviewReason,
            latestUserAsk: state.canonicalState.thread.latestUserAsk,
            progressScore: state.canonicalState.thread.progressScore,
          },
        }
      : thread,
    state,
    history,
    drafts: inbox.drafts
      .filter((draft) => draft.threadId === thread.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    feedback,
    lead,
    run: run
      ? {
          id: run.id,
          status: run.status,
          accountId: run.accountId,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        }
      : null,
  };
}
