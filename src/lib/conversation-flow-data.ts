import { mkdir, readFile, writeFile } from "fs/promises";
import { createId } from "@/lib/factory-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  ConversationEvent,
  ConversationFlowEdge,
  ConversationFlowGraph,
  ConversationFlowNode,
  ConversationMap,
  ConversationSession,
} from "@/lib/factory-types";

const isVercel = Boolean(process.env.VERCEL);
const STORE_PATH = isVercel
  ? "/tmp/factory_conversation_flow.v1.json"
  : `${process.cwd()}/data/conversation-flow.v1.json`;

const TABLE_MAP = "demanddev_conversation_maps";
const TABLE_SESSION = "demanddev_conversation_sessions";
const TABLE_EVENT = "demanddev_conversation_events";

const nowIso = () => new Date().toISOString();

export class ConversationFlowDataError extends Error {
  status: number;
  hint: string;
  debug: Record<string, unknown>;

  constructor(
    message: string,
    options: { status?: number; hint?: string; debug?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = "ConversationFlowDataError";
    this.status = options.status ?? 500;
    this.hint = options.hint ?? "";
    this.debug = options.debug ?? {};
  }
}

type LocalStore = {
  maps: ConversationMap[];
  sessions: ConversationSession[];
  events: ConversationEvent[];
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

function clampConfidence(value: unknown, fallback = 0.7) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function defaultNode(position: { x: number; y: number }): ConversationFlowNode {
  return {
    id: createId("node"),
    kind: "message",
    title: "Message",
    subject: "Quick question",
    body: "Hi {{firstName}},\n\nQuick question on {{brandName}}.",
    autoSend: true,
    delayMinutes: 0,
    x: position.x,
    y: position.y,
  };
}

function defaultTerminalNode(position: { x: number; y: number }): ConversationFlowNode {
  return {
    id: createId("node"),
    kind: "terminal",
    title: "End",
    subject: "",
    body: "",
    autoSend: false,
    delayMinutes: 0,
    x: position.x,
    y: position.y,
  };
}

export function defaultConversationGraph(): ConversationFlowGraph {
  const start = defaultNode({ x: 60, y: 220 });
  start.title = "Start question";
  start.subject = "Quick question";
  start.body = "Hi {{firstName}},\n\nQuick question: are you currently focused on {{campaignGoal}}?";

  const interest = defaultNode({ x: 420, y: 80 });
  interest.title = "Interest follow-up";
  interest.subject = "Great to hear";
  interest.body = "Great to hear, {{firstName}}.\n\nBased on your note, want a short 10-minute walkthrough?";
  interest.autoSend = true;
  interest.delayMinutes = 0;

  const question = defaultNode({ x: 420, y: 220 });
  question.title = "Question answer";
  question.subject = "Answering your question";
  question.body = "Great question.\n\nHere is the shortest answer for your context: {{shortAnswer}}.";
  question.autoSend = false;

  const objection = defaultNode({ x: 420, y: 360 });
  objection.title = "Objection handling";
  objection.subject = "Makes sense";
  objection.body = "Totally fair.\n\nIf timing is the blocker, would revisiting in a few weeks help?";
  objection.autoSend = false;

  const noReply = defaultNode({ x: 780, y: 220 });
  noReply.title = "No-reply nudge";
  noReply.subject = "Worth a quick check";
  noReply.body = "Just circling back in case this slipped.\n\nShould I close this out for now?";
  noReply.autoSend = true;
  noReply.delayMinutes = 1440;

  const end = defaultTerminalNode({ x: 1120, y: 220 });

  return {
    version: 1,
    maxDepth: 5,
    startNodeId: start.id,
    nodes: [start, interest, question, objection, noReply, end],
    edges: [
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: interest.id,
        trigger: "intent",
        intent: "interest",
        waitMinutes: 0,
        confidenceThreshold: 0.65,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: question.id,
        trigger: "intent",
        intent: "question",
        waitMinutes: 0,
        confidenceThreshold: 0.65,
        priority: 2,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: objection.id,
        trigger: "intent",
        intent: "objection",
        waitMinutes: 0,
        confidenceThreshold: 0.7,
        priority: 3,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: end.id,
        trigger: "intent",
        intent: "unsubscribe",
        waitMinutes: 0,
        confidenceThreshold: 0.5,
        priority: 4,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: noReply.id,
        trigger: "timer",
        intent: "",
        waitMinutes: 1440,
        confidenceThreshold: 0,
        priority: 5,
      },
      {
        id: createId("edge"),
        fromNodeId: noReply.id,
        toNodeId: end.id,
        trigger: "timer",
        intent: "",
        waitMinutes: 2880,
        confidenceThreshold: 0,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: interest.id,
        toNodeId: end.id,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: question.id,
        toNodeId: end.id,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: objection.id,
        toNodeId: end.id,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 1,
      },
    ],
  };
}

function normalizeNode(value: unknown): ConversationFlowNode | null {
  const row = asRecord(value);
  const id = String(row.id ?? "").trim() || createId("node");
  const kind = String(row.kind ?? "message") === "terminal" ? "terminal" : "message";
  const title = String(row.title ?? "").trim() || (kind === "terminal" ? "End" : "Message");
  const subject = String(row.subject ?? "").trim();
  const body = String(row.body ?? "").trim();
  const autoSend = Boolean(row.autoSend ?? true);
  const delayMinutes = Math.max(0, Math.min(10080, Number(row.delayMinutes ?? 0) || 0));
  const x = Number(row.x);
  const y = Number(row.y);

  if (kind === "message" && !body) return null;

  return {
    id,
    kind,
    title,
    subject,
    body,
    autoSend,
    delayMinutes,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

function normalizeEdge(value: unknown): ConversationFlowEdge | null {
  const row = asRecord(value);
  const id = String(row.id ?? "").trim() || createId("edge");
  const fromNodeId = String(row.fromNodeId ?? row.from_node_id ?? "").trim();
  const toNodeId = String(row.toNodeId ?? row.to_node_id ?? "").trim();
  const triggerRaw = String(row.trigger ?? "fallback").trim();
  const trigger = ["intent", "timer", "fallback"].includes(triggerRaw)
    ? (triggerRaw as ConversationFlowEdge["trigger"])
    : "fallback";
  const intentRaw = String(row.intent ?? "").trim();
  const intent = ["question", "interest", "objection", "unsubscribe", "other"].includes(intentRaw)
    ? (intentRaw as ConversationFlowEdge["intent"])
    : "";
  const waitMinutes = Math.max(0, Math.min(10080, Number(row.waitMinutes ?? 0) || 0));
  const confidenceThreshold = clampConfidence(row.confidenceThreshold, 0.7);
  const priority = Math.max(1, Math.min(100, Number(row.priority ?? 1) || 1));

  if (!fromNodeId || !toNodeId) return null;

  return {
    id,
    fromNodeId,
    toNodeId,
    trigger,
    intent,
    waitMinutes,
    confidenceThreshold,
    priority,
  };
}

export function normalizeConversationGraph(value: unknown): ConversationFlowGraph {
  const row = asRecord(value);
  const nodes = asArray(row.nodes).map(normalizeNode).filter((item): item is ConversationFlowNode => Boolean(item));
  const nodeIds = new Set(nodes.map((item) => item.id));
  const edges = asArray(row.edges)
    .map(normalizeEdge)
    .filter((item): item is ConversationFlowEdge => Boolean(item))
    .filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId));

  const fallback = defaultConversationGraph();
  const startNodeIdCandidate = String(row.startNodeId ?? row.start_node_id ?? "").trim();
  const startNodeId = nodeIds.has(startNodeIdCandidate)
    ? startNodeIdCandidate
    : nodes[0]?.id || fallback.startNodeId;
  const maxDepth = Math.max(1, Math.min(5, Number(row.maxDepth ?? fallback.maxDepth) || fallback.maxDepth));

  if (!nodes.length) return fallback;

  return {
    version: 1,
    maxDepth,
    startNodeId,
    nodes,
    edges,
  };
}

function mapMapRow(value: unknown): ConversationMap {
  const row = asRecord(value);
  const fallback = defaultConversationGraph();
  return {
    id: String(row.id ?? createId("flow")),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    campaignId: String(row.campaign_id ?? row.campaignId ?? ""),
    experimentId: String(row.experiment_id ?? row.experimentId ?? ""),
    name: String(row.name ?? "Variant Conversation Flow"),
    status: ["draft", "published", "archived"].includes(String(row.status))
      ? (String(row.status) as ConversationMap["status"])
      : "draft",
    draftGraph: row.draft_graph || row.draftGraph ? normalizeConversationGraph(row.draft_graph ?? row.draftGraph) : fallback,
    publishedGraph: row.published_graph || row.publishedGraph ? normalizeConversationGraph(row.published_graph ?? row.publishedGraph) : fallback,
    publishedRevision: Math.max(0, Number(row.published_revision ?? row.publishedRevision ?? 0) || 0),
    publishedAt: String(row.published_at ?? row.publishedAt ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapSessionRow(value: unknown): ConversationSession {
  const row = asRecord(value);
  return {
    id: String(row.id ?? createId("session")),
    runId: String(row.run_id ?? row.runId ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    campaignId: String(row.campaign_id ?? row.campaignId ?? ""),
    leadId: String(row.lead_id ?? row.leadId ?? ""),
    mapId: String(row.map_id ?? row.mapId ?? ""),
    mapRevision: Math.max(0, Number(row.map_revision ?? row.mapRevision ?? 0) || 0),
    state: ["active", "waiting_manual", "completed", "failed"].includes(String(row.state))
      ? (String(row.state) as ConversationSession["state"])
      : "active",
    currentNodeId: String(row.current_node_id ?? row.currentNodeId ?? ""),
    turnCount: Math.max(0, Number(row.turn_count ?? row.turnCount ?? 0) || 0),
    lastIntent: ["question", "interest", "objection", "unsubscribe", "other"].includes(String(row.last_intent))
      ? (String(row.last_intent) as ConversationSession["lastIntent"])
      : ["question", "interest", "objection", "unsubscribe", "other"].includes(String(row.lastIntent))
        ? (String(row.lastIntent) as ConversationSession["lastIntent"])
        : "",
    lastConfidence: clampConfidence(row.last_confidence ?? row.lastConfidence, 0),
    lastNodeEnteredAt: String(row.last_node_entered_at ?? row.lastNodeEnteredAt ?? nowIso()),
    endedReason: String(row.ended_reason ?? row.endedReason ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapEventRow(value: unknown): ConversationEvent {
  const row = asRecord(value);
  return {
    id: String(row.id ?? createId("flowevt")),
    sessionId: String(row.session_id ?? row.sessionId ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    eventType: String(row.event_type ?? row.eventType ?? ""),
    payload: asRecord(row.payload),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
  };
}

function defaultStore(): LocalStore {
  return {
    maps: [],
    sessions: [],
    events: [],
  };
}

async function readStore(): Promise<LocalStore> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const row = asRecord(parsed);
    return {
      maps: asArray(row.maps).map((item) => mapMapRow(item)),
      sessions: asArray(row.sessions).map((item) => mapSessionRow(item)),
      events: asArray(row.events).map((item) => mapEventRow(item)),
    };
  } catch {
    return defaultStore();
  }
}

async function writeStore(store: LocalStore) {
  if (!isVercel) {
    await mkdir(`${process.cwd()}/data`, { recursive: true });
  }
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

function supabaseConfigured() {
  return Boolean(
    process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY)
  );
}

function mapHintForSupabaseError(error: unknown) {
  const row = asRecord(error);
  const message = String(row.message ?? "").toLowerCase();
  if (message.includes("relation") && message.includes("does not exist")) {
    return "Conversation flow tables are missing. Apply the latest supabase/migrations and redeploy.";
  }
  return "Supabase request failed for conversation flow storage.";
}

export async function getConversationMapByExperiment(
  brandId: string,
  campaignId: string,
  experimentId: string
): Promise<ConversationMap | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MAP)
      .select("*")
      .eq("brand_id", brandId)
      .eq("campaign_id", campaignId)
      .eq("experiment_id", experimentId)
      .maybeSingle();

    if (error && isVercel) {
      throw new ConversationFlowDataError("Failed to load conversation map from Supabase.", {
        status: 500,
        hint: mapHintForSupabaseError(error),
        debug: {
          operation: "getConversationMapByExperiment",
          supabaseConfigured: supabaseConfigured(),
          supabaseError: asRecord(error),
        },
      });
    }

    if (!error && data) return mapMapRow(data);
  }

  const store = await readStore();
  return (
    store.maps.find(
      (item) => item.brandId === brandId && item.campaignId === campaignId && item.experimentId === experimentId
    ) ?? null
  );
}

export async function upsertConversationMapDraft(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
  name?: string;
  draftGraph: unknown;
}): Promise<ConversationMap> {
  const now = nowIso();
  const normalized = normalizeConversationGraph(input.draftGraph);
  const existing = await getConversationMapByExperiment(input.brandId, input.campaignId, input.experimentId);

  const row: ConversationMap = {
    id: existing?.id ?? createId("flow"),
    brandId: input.brandId,
    campaignId: input.campaignId,
    experimentId: input.experimentId,
    name: String(input.name ?? existing?.name ?? "Variant Conversation Flow").trim() || "Variant Conversation Flow",
    status: existing?.status ?? "draft",
    draftGraph: normalized,
    publishedGraph: existing?.publishedGraph ?? normalized,
    publishedRevision: existing?.publishedRevision ?? 0,
    publishedAt: existing?.publishedAt ?? "",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const payload = {
      id: row.id,
      brand_id: row.brandId,
      campaign_id: row.campaignId,
      experiment_id: row.experimentId,
      name: row.name,
      status: row.status,
      draft_graph: row.draftGraph,
      published_graph: row.publishedGraph,
      published_revision: row.publishedRevision,
      published_at: row.publishedAt || null,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };

    const { data, error } = await supabase
      .from(TABLE_MAP)
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();

    if (error && isVercel) {
      throw new ConversationFlowDataError("Failed to save conversation map draft to Supabase.", {
        status: 500,
        hint: mapHintForSupabaseError(error),
        debug: {
          operation: "upsertConversationMapDraft",
          supabaseConfigured: supabaseConfigured(),
          supabaseError: asRecord(error),
        },
      });
    }

    if (!error && data) return mapMapRow(data);
  }

  const store = await readStore();
  const idx = store.maps.findIndex((item) => item.id === row.id);
  if (idx >= 0) {
    store.maps[idx] = row;
  } else {
    store.maps.unshift(row);
  }
  await writeStore(store);
  return row;
}

export async function publishConversationMap(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
}): Promise<ConversationMap | null> {
  const existing = await getConversationMapByExperiment(input.brandId, input.campaignId, input.experimentId);
  if (!existing) return null;

  const now = nowIso();
  const next: ConversationMap = {
    ...existing,
    status: "published",
    publishedGraph: existing.draftGraph,
    publishedRevision: existing.publishedRevision + 1,
    publishedAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MAP)
      .update({
        status: next.status,
        published_graph: next.publishedGraph,
        published_revision: next.publishedRevision,
        published_at: next.publishedAt,
        updated_at: next.updatedAt,
      })
      .eq("id", next.id)
      .select("*")
      .single();

    if (error && isVercel) {
      throw new ConversationFlowDataError("Failed to publish conversation map.", {
        status: 500,
        hint: mapHintForSupabaseError(error),
        debug: {
          operation: "publishConversationMap",
          supabaseConfigured: supabaseConfigured(),
          supabaseError: asRecord(error),
        },
      });
    }

    if (!error && data) return mapMapRow(data);
  }

  const store = await readStore();
  const idx = store.maps.findIndex((item) => item.id === next.id);
  if (idx < 0) return null;
  store.maps[idx] = next;
  await writeStore(store);
  return next;
}

export async function getPublishedConversationMapForExperiment(
  brandId: string,
  campaignId: string,
  experimentId: string
): Promise<ConversationMap | null> {
  const row = await getConversationMapByExperiment(brandId, campaignId, experimentId);
  if (!row) return null;
  if (row.status !== "published" || row.publishedRevision <= 0) return null;
  return row;
}

export async function listConversationSessionsByRun(runId: string): Promise<ConversationSession[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SESSION)
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (!error) {
      return (data ?? []).map((item: unknown) => mapSessionRow(item));
    }
  }

  const store = await readStore();
  return store.sessions.filter((item) => item.runId === runId);
}

export async function getConversationSessionByLead(input: {
  runId: string;
  leadId: string;
}): Promise<ConversationSession | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SESSION)
      .select("*")
      .eq("run_id", input.runId)
      .eq("lead_id", input.leadId)
      .maybeSingle();
    if (!error && data) {
      return mapSessionRow(data);
    }
  }

  const store = await readStore();
  return store.sessions.find((item) => item.runId === input.runId && item.leadId === input.leadId) ?? null;
}

export async function createConversationSession(input: {
  runId: string;
  brandId: string;
  campaignId: string;
  leadId: string;
  mapId: string;
  mapRevision: number;
  startNodeId: string;
}): Promise<ConversationSession> {
  const now = nowIso();
  const session: ConversationSession = {
    id: createId("session"),
    runId: input.runId,
    brandId: input.brandId,
    campaignId: input.campaignId,
    leadId: input.leadId,
    mapId: input.mapId,
    mapRevision: Math.max(1, Number(input.mapRevision || 1)),
    state: "active",
    currentNodeId: input.startNodeId,
    turnCount: 0,
    lastIntent: "",
    lastConfidence: 0,
    lastNodeEnteredAt: now,
    endedReason: "",
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SESSION)
      .insert({
        id: session.id,
        run_id: session.runId,
        brand_id: session.brandId,
        campaign_id: session.campaignId,
        lead_id: session.leadId,
        map_id: session.mapId,
        map_revision: session.mapRevision,
        state: session.state,
        current_node_id: session.currentNodeId,
        turn_count: session.turnCount,
        last_intent: session.lastIntent,
        last_confidence: session.lastConfidence,
        last_node_entered_at: session.lastNodeEnteredAt,
        ended_reason: session.endedReason,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      })
      .select("*")
      .single();
    if (!error && data) return mapSessionRow(data);
  }

  const store = await readStore();
  store.sessions.push(session);
  await writeStore(store);
  return session;
}

export async function updateConversationSession(
  sessionId: string,
  patch: Partial<
    Pick<
      ConversationSession,
      "state" | "currentNodeId" | "turnCount" | "lastIntent" | "lastConfidence" | "lastNodeEnteredAt" | "endedReason"
    >
  >
): Promise<ConversationSession | null> {
  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.state !== undefined) update.state = patch.state;
    if (patch.currentNodeId !== undefined) update.current_node_id = patch.currentNodeId;
    if (patch.turnCount !== undefined) update.turn_count = patch.turnCount;
    if (patch.lastIntent !== undefined) update.last_intent = patch.lastIntent;
    if (patch.lastConfidence !== undefined) update.last_confidence = patch.lastConfidence;
    if (patch.lastNodeEnteredAt !== undefined) update.last_node_entered_at = patch.lastNodeEnteredAt;
    if (patch.endedReason !== undefined) update.ended_reason = patch.endedReason;

    const { data, error } = await supabase
      .from(TABLE_SESSION)
      .update(update)
      .eq("id", sessionId)
      .select("*")
      .maybeSingle();
    if (!error && data) return mapSessionRow(data);
  }

  const store = await readStore();
  const idx = store.sessions.findIndex((item) => item.id === sessionId);
  if (idx < 0) return null;
  store.sessions[idx] = {
    ...store.sessions[idx],
    ...patch,
    updatedAt: now,
  };
  await writeStore(store);
  return store.sessions[idx];
}

export async function createConversationEvent(input: {
  sessionId: string;
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<ConversationEvent> {
  const now = nowIso();
  const event: ConversationEvent = {
    id: createId("flowevt"),
    sessionId: input.sessionId,
    runId: input.runId,
    eventType: input.eventType,
    payload: input.payload,
    createdAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error } = await supabase.from(TABLE_EVENT).insert({
      id: event.id,
      session_id: event.sessionId,
      run_id: event.runId,
      event_type: event.eventType,
      payload: event.payload,
      created_at: event.createdAt,
    });
    if (!error) {
      return event;
    }
  }

  const store = await readStore();
  store.events.unshift(event);
  await writeStore(store);
  return event;
}

export async function listConversationEventsByRun(runId: string, limit = 200): Promise<ConversationEvent[]> {
  const capped = Math.max(1, Math.min(1000, Number(limit || 200)));
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_EVENT)
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(capped);
    if (!error) {
      return (data ?? []).map((item: unknown) => mapEventRow(item));
    }
  }

  const store = await readStore();
  return store.events.filter((item) => item.runId === runId).slice(0, capped);
}
