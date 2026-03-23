import { mkdir, readFile, writeFile } from "fs/promises";
import { createId } from "@/lib/factory-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  OperatorAction,
  OperatorActionStatus,
  OperatorApproval,
  OperatorMemory,
  OperatorMessage,
  OperatorRun,
  OperatorThread,
} from "@/lib/operator-types";

type OperatorStore = {
  threads: OperatorThread[];
  messages: OperatorMessage[];
  runs: OperatorRun[];
  actions: OperatorAction[];
  approvals: OperatorApproval[];
  memory: OperatorMemory[];
};

const isVercel = Boolean(process.env.VERCEL);
const OPERATOR_PATH = isVercel
  ? "/tmp/factory_operator.v1.json"
  : `${process.cwd()}/data/operator.v1.json`;

const TABLE_THREAD = "demanddev_operator_threads";
const TABLE_MESSAGE = "demanddev_operator_messages";
const TABLE_RUN = "demanddev_operator_runs";
const TABLE_ACTION = "demanddev_operator_actions";
const TABLE_APPROVAL = "demanddev_operator_approvals";
const TABLE_MEMORY = "demanddev_operator_memory";

const nowIso = () => new Date().toISOString();

export class OperatorDataError extends Error {
  status: number;
  hint: string;
  debug: Record<string, unknown>;

  constructor(
    message: string,
    options: { status?: number; hint?: string; debug?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = "OperatorDataError";
    this.status = options.status ?? 500;
    this.hint = options.hint ?? "";
    this.debug = options.debug ?? {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function defaultStore(): OperatorStore {
  return {
    threads: [],
    messages: [],
    runs: [],
    actions: [],
    approvals: [],
    memory: [],
  };
}

async function readLocalStore(): Promise<OperatorStore> {
  try {
    const raw = await readFile(OPERATOR_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<OperatorStore>;
    return {
      threads: Array.isArray(parsed.threads) ? parsed.threads : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [],
      memory: Array.isArray(parsed.memory) ? parsed.memory : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      await mkdir(OPERATOR_PATH.split("/").slice(0, -1).join("/"), { recursive: true });
      await writeFile(OPERATOR_PATH, JSON.stringify(defaultStore(), null, 2), "utf8");
      return defaultStore();
    }
    throw error;
  }
}

async function writeLocalStore(store: OperatorStore) {
  await mkdir(OPERATOR_PATH.split("/").slice(0, -1).join("/"), { recursive: true });
  await writeFile(OPERATOR_PATH, JSON.stringify(store, null, 2), "utf8");
}

function mapThreadRow(input: unknown): OperatorThread {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    userId: String(row.user_id ?? row.userId ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    title: String(row.title ?? "").trim(),
    status: String(row.status ?? "active").trim() === "archived" ? "archived" : "active",
    lastSummary: String(row.last_summary ?? row.lastSummary ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
    archivedAt: String(row.archived_at ?? row.archivedAt ?? ""),
  };
}

function mapMessageRow(input: unknown): OperatorMessage {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    threadId: String(row.thread_id ?? row.threadId ?? "").trim(),
    role:
      String(row.role ?? "assistant").trim() === "user"
        ? "user"
        : String(row.role ?? "").trim() === "tool"
          ? "tool"
          : String(row.role ?? "").trim() === "system"
            ? "system"
            : "assistant",
    kind: ((): OperatorMessage["kind"] => {
      const kind = String(row.kind ?? "message").trim();
      return [
        "message",
        "tool_call",
        "tool_result",
        "approval_request",
        "receipt",
        "system_note",
      ].includes(kind)
        ? (kind as OperatorMessage["kind"])
        : "message";
    })(),
    content: asRecord(row.content),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
  };
}

function mapRunRow(input: unknown): OperatorRun {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    threadId: String(row.thread_id ?? row.threadId ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    status: ((): OperatorRun["status"] => {
      const status = String(row.status ?? "running").trim();
      return ["running", "completed", "failed", "canceled"].includes(status)
        ? (status as OperatorRun["status"])
        : "running";
    })(),
    model: String(row.model ?? "").trim(),
    contextSnapshot: asRecord(row.context_snapshot ?? row.contextSnapshot),
    plan: asArray(row.plan) as Array<Record<string, unknown>>,
    errorText: String(row.error_text ?? row.errorText ?? "").trim(),
    startedAt: String(row.started_at ?? row.startedAt ?? nowIso()),
    completedAt: String(row.completed_at ?? row.completedAt ?? ""),
  };
}

function mapActionRow(input: unknown): OperatorAction {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    runId: String(row.run_id ?? row.runId ?? "").trim(),
    toolName: String(row.tool_name ?? row.toolName ?? "").trim() as OperatorAction["toolName"],
    riskLevel: ((): OperatorAction["riskLevel"] => {
      const risk = String(row.risk_level ?? row.riskLevel ?? "read").trim();
      return ["read", "safe_write", "guarded_write", "blocked"].includes(risk)
        ? (risk as OperatorAction["riskLevel"])
        : "read";
    })(),
    approvalMode: ((): OperatorAction["approvalMode"] => {
      const mode = String(row.approval_mode ?? row.approvalMode ?? "none").trim();
      return ["none", "confirm", "blocked"].includes(mode)
        ? (mode as OperatorAction["approvalMode"])
        : "none";
    })(),
    status: ((): OperatorAction["status"] => {
      const status = String(row.status ?? "proposed").trim();
      return [
        "proposed",
        "awaiting_approval",
        "running",
        "completed",
        "failed",
        "canceled",
        "blocked",
      ].includes(status)
        ? (status as OperatorAction["status"])
        : "proposed";
    })(),
    input: asRecord(row.input),
    preview: asRecord(row.preview),
    result: asRecord(row.result),
    undoPayload: asRecord(row.undo_payload ?? row.undoPayload),
    errorText: String(row.error_text ?? row.errorText ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapApprovalRow(input: unknown): OperatorApproval {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    actionId: String(row.action_id ?? row.actionId ?? "").trim(),
    requestedByUserId: String(row.requested_by_user_id ?? row.requestedByUserId ?? "").trim(),
    decidedByUserId: String(row.decided_by_user_id ?? row.decidedByUserId ?? "").trim(),
    decision: String(row.decision ?? "approved").trim() === "rejected" ? "rejected" : "approved",
    note: String(row.note ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
  };
}

function mapMemoryRow(input: unknown): OperatorMemory {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    scopeType: String(row.scope_type ?? row.scopeType ?? "account").trim() as OperatorMemory["scopeType"],
    scopeId: String(row.scope_id ?? row.scopeId ?? "").trim(),
    memoryKey: String(row.memory_key ?? row.memoryKey ?? "").trim(),
    value: asRecord(row.value),
    source: String(row.source ?? "operator").trim(),
    confidence: Number(row.confidence ?? 1) || 1,
    sensitivity:
      String(row.sensitivity ?? "normal").trim() === "sensitive" ? "sensitive" : "normal",
    lastVerifiedAt: String(row.last_verified_at ?? row.lastVerifiedAt ?? ""),
    expiresAt: String(row.expires_at ?? row.expiresAt ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

export async function listOperatorThreads(input: {
  userId?: string;
  brandId?: string;
  status?: OperatorThread["status"];
} = {}): Promise<OperatorThread[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase.from(TABLE_THREAD).select("*").order("updated_at", { ascending: false });
    if (input.userId?.trim()) query = query.eq("user_id", input.userId.trim());
    if (input.brandId?.trim()) query = query.eq("brand_id", input.brandId.trim());
    if (input.status?.trim()) query = query.eq("status", input.status.trim());
    const { data, error } = await query;
    if (!error) {
      return (data ?? []).map((row: unknown) => mapThreadRow(row));
    }
    if (isVercel) {
      throw new OperatorDataError("Failed to list Operator threads from Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_THREAD, supabaseError: error.message },
      });
    }
  }

  const store = await readLocalStore();
  return store.threads
    .filter((thread) => !input.userId?.trim() || thread.userId === input.userId.trim())
    .filter((thread) => !input.brandId?.trim() || thread.brandId === input.brandId.trim())
    .filter((thread) => !input.status?.trim() || thread.status === input.status)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getOperatorThread(threadId: string): Promise<OperatorThread | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase.from(TABLE_THREAD).select("*").eq("id", threadId).maybeSingle();
    if (!error && data) return mapThreadRow(data);
    if (error && isVercel) {
      throw new OperatorDataError("Failed to load Operator thread from Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_THREAD, threadId, supabaseError: error.message },
      });
    }
  }
  const store = await readLocalStore();
  return store.threads.find((thread) => thread.id === threadId) ?? null;
}

export async function createOperatorThread(input: {
  userId?: string;
  brandId?: string;
  title?: string;
  status?: OperatorThread["status"];
  lastSummary?: string;
}): Promise<OperatorThread> {
  const row: OperatorThread = {
    id: createId("opth"),
    userId: String(input.userId ?? "").trim(),
    brandId: String(input.brandId ?? "").trim(),
    title: String(input.title ?? "").trim(),
    status: input.status === "archived" ? "archived" : "active",
    lastSummary: String(input.lastSummary ?? "").trim(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    archivedAt: "",
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_THREAD)
      .insert({
        id: row.id,
        user_id: row.userId || null,
        brand_id: row.brandId || null,
        title: row.title,
        status: row.status,
        last_summary: row.lastSummary,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        archived_at: row.archivedAt || null,
      })
      .select("*")
      .maybeSingle();
    if (!error && data) return mapThreadRow(data);
    if (error && isVercel) {
      throw new OperatorDataError("Failed to create Operator thread in Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_THREAD, supabaseError: error.message },
      });
    }
  }

  const store = await readLocalStore();
  store.threads.unshift(row);
  await writeLocalStore(store);
  return row;
}

export async function updateOperatorThread(
  threadId: string,
  patch: Partial<Pick<OperatorThread, "title" | "status" | "lastSummary" | "archivedAt">>
): Promise<OperatorThread | null> {
  const existing = await getOperatorThread(threadId);
  if (!existing) return null;

  const next: OperatorThread = {
    ...existing,
    title: patch.title !== undefined ? String(patch.title ?? "").trim() : existing.title,
    status: patch.status ?? existing.status,
    lastSummary: patch.lastSummary !== undefined ? String(patch.lastSummary ?? "").trim() : existing.lastSummary,
    archivedAt: patch.archivedAt !== undefined ? String(patch.archivedAt ?? "").trim() : existing.archivedAt,
    updatedAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_THREAD)
      .update({
        title: next.title,
        status: next.status,
        last_summary: next.lastSummary,
        archived_at: next.archivedAt || null,
        updated_at: next.updatedAt,
      })
      .eq("id", threadId)
      .select("*")
      .maybeSingle();
    if (!error && data) return mapThreadRow(data);
    if (error && isVercel) {
      throw new OperatorDataError("Failed to update Operator thread in Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_THREAD, threadId, supabaseError: error.message },
      });
    }
  }

  const store = await readLocalStore();
  store.threads = store.threads.map((thread) => (thread.id === threadId ? next : thread));
  await writeLocalStore(store);
  return next;
}

export async function listOperatorMessages(threadId: string): Promise<OperatorMessage[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MESSAGE)
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (!error) return (data ?? []).map((row: unknown) => mapMessageRow(row));
    if (isVercel) {
      throw new OperatorDataError("Failed to list Operator messages from Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_MESSAGE, threadId, supabaseError: error.message },
      });
    }
  }
  const store = await readLocalStore();
  return store.messages
    .filter((message) => message.threadId === threadId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function createOperatorMessage(input: {
  threadId: string;
  role: OperatorMessage["role"];
  kind: OperatorMessage["kind"];
  content: Record<string, unknown>;
}): Promise<OperatorMessage> {
  const row: OperatorMessage = {
    id: createId("opmsg"),
    threadId: input.threadId,
    role: input.role,
    kind: input.kind,
    content: input.content,
    createdAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MESSAGE)
      .insert({
        id: row.id,
        thread_id: row.threadId,
        role: row.role,
        kind: row.kind,
        content: row.content,
        created_at: row.createdAt,
      })
      .select("*")
      .maybeSingle();
    if (!error && data) return mapMessageRow(data);
    if (error && isVercel) {
      throw new OperatorDataError("Failed to create Operator message in Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_MESSAGE, supabaseError: error.message },
      });
    }
  }

  const store = await readLocalStore();
  store.messages.push(row);
  await writeLocalStore(store);
  return row;
}

export async function createOperatorRun(input: {
  threadId: string;
  brandId?: string;
  model?: string;
  contextSnapshot?: Record<string, unknown>;
  plan?: Array<Record<string, unknown>>;
}): Promise<OperatorRun> {
  const row: OperatorRun = {
    id: createId("oprun"),
    threadId: input.threadId,
    brandId: String(input.brandId ?? "").trim(),
    status: "running",
    model: String(input.model ?? "").trim(),
    contextSnapshot: input.contextSnapshot ?? {},
    plan: input.plan ?? [],
    errorText: "",
    startedAt: nowIso(),
    completedAt: "",
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_RUN)
      .insert({
        id: row.id,
        thread_id: row.threadId,
        brand_id: row.brandId || null,
        status: row.status,
        model: row.model,
        context_snapshot: row.contextSnapshot,
        plan: row.plan,
        error_text: row.errorText,
        started_at: row.startedAt,
        completed_at: null,
      })
      .select("*")
      .maybeSingle();
    if (!error && data) return mapRunRow(data);
    if (error && isVercel) {
      throw new OperatorDataError("Failed to create Operator run in Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_RUN, supabaseError: error.message },
      });
    }
  }

  const store = await readLocalStore();
  store.runs.unshift(row);
  await writeLocalStore(store);
  return row;
}

export async function updateOperatorRun(
  runId: string,
  patch: Partial<Pick<OperatorRun, "status" | "plan" | "contextSnapshot" | "errorText" | "completedAt">>
): Promise<OperatorRun | null> {
  const supabase = getSupabaseAdmin();
  let existing: OperatorRun | null = null;
  if (supabase) {
    const { data } = await supabase.from(TABLE_RUN).select("*").eq("id", runId).maybeSingle();
    existing = data ? mapRunRow(data) : null;
  }
  if (!existing) {
    const store = await readLocalStore();
    existing = store.runs.find((run) => run.id === runId) ?? null;
  }
  if (!existing) return null;

  const next: OperatorRun = {
    ...existing,
    status: patch.status ?? existing.status,
    plan: patch.plan ?? existing.plan,
    contextSnapshot: patch.contextSnapshot ?? existing.contextSnapshot,
    errorText: patch.errorText !== undefined ? String(patch.errorText ?? "").trim() : existing.errorText,
    completedAt: patch.completedAt !== undefined ? String(patch.completedAt ?? "").trim() : existing.completedAt,
  };

  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_RUN)
      .update({
        status: next.status,
        plan: next.plan,
        context_snapshot: next.contextSnapshot,
        error_text: next.errorText,
        completed_at: next.completedAt || null,
      })
      .eq("id", runId)
      .select("*")
      .maybeSingle();
    if (!error && data) return mapRunRow(data);
    if (error && isVercel) {
      throw new OperatorDataError("Failed to update Operator run in Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_RUN, runId, supabaseError: error.message },
      });
    }
  }

  const store = await readLocalStore();
  store.runs = store.runs.map((run) => (run.id === runId ? next : run));
  await writeLocalStore(store);
  return next;
}

export async function getOperatorRun(runId: string): Promise<OperatorRun | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase.from(TABLE_RUN).select("*").eq("id", runId).maybeSingle();
    if (!error && data) return mapRunRow(data);
    if (error && isVercel) {
      throw new OperatorDataError("Failed to load Operator run from Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_RUN, runId, supabaseError: error.message },
      });
    }
  }

  const store = await readLocalStore();
  return store.runs.find((run) => run.id === runId) ?? null;
}

export async function getOperatorAction(actionId: string): Promise<OperatorAction | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase.from(TABLE_ACTION).select("*").eq("id", actionId).maybeSingle();
    if (!error && data) return mapActionRow(data);
    if (error && isVercel) {
      throw new OperatorDataError("Failed to load Operator action from Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_ACTION, actionId, supabaseError: error.message },
      });
    }
  }
  const store = await readLocalStore();
  return store.actions.find((action) => action.id === actionId) ?? null;
}

export async function listOperatorActionsByThread(threadId: string): Promise<OperatorAction[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data: runs, error: runsError } = await supabase
      .from(TABLE_RUN)
      .select("id")
      .eq("thread_id", threadId);
    if (!runsError) {
      const runIds = (runs ?? [])
        .map((row) => String((row as Record<string, unknown>).id ?? "").trim())
        .filter(Boolean);
      if (!runIds.length) return [];
      const { data, error } = await supabase
        .from(TABLE_ACTION)
        .select("*")
        .in("run_id", runIds)
        .order("created_at", { ascending: true });
      if (!error) return (data ?? []).map((row: unknown) => mapActionRow(row));
      if (isVercel) {
        throw new OperatorDataError("Failed to list Operator actions from Supabase.", {
          status: 500,
          hint: "Apply the Operator migrations, then redeploy.",
          debug: { table: TABLE_ACTION, threadId, supabaseError: error.message },
        });
      }
    } else if (isVercel) {
      throw new OperatorDataError("Failed to list Operator runs from Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_RUN, threadId, supabaseError: runsError.message },
      });
    }
  }

  const store = await readLocalStore();
  const runIds = new Set(store.runs.filter((run) => run.threadId === threadId).map((run) => run.id));
  return store.actions
    .filter((action) => runIds.has(action.runId))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function createOperatorAction(input: {
  runId: string;
  toolName: OperatorAction["toolName"];
  riskLevel: OperatorAction["riskLevel"];
  approvalMode: OperatorAction["approvalMode"];
  status?: OperatorActionStatus;
  input?: Record<string, unknown>;
  preview?: Record<string, unknown>;
}): Promise<OperatorAction> {
  const row: OperatorAction = {
    id: createId("opact"),
    runId: input.runId,
    toolName: input.toolName,
    riskLevel: input.riskLevel,
    approvalMode: input.approvalMode,
    status:
      input.status ??
      (input.approvalMode === "confirm"
        ? "awaiting_approval"
        : input.approvalMode === "blocked"
          ? "blocked"
          : "proposed"),
    input: input.input ?? {},
    preview: input.preview ?? {},
    result: {},
    undoPayload: {},
    errorText: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ACTION)
      .insert({
        id: row.id,
        run_id: row.runId,
        tool_name: row.toolName,
        risk_level: row.riskLevel,
        approval_mode: row.approvalMode,
        status: row.status,
        input: row.input,
        preview: row.preview,
        result: row.result,
        undo_payload: row.undoPayload,
        error_text: row.errorText,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      })
      .select("*")
      .maybeSingle();
    if (!error && data) return mapActionRow(data);
    if (error && isVercel) {
      throw new OperatorDataError("Failed to create Operator action in Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_ACTION, supabaseError: error.message },
      });
    }
  }

  const store = await readLocalStore();
  store.actions.push(row);
  await writeLocalStore(store);
  return row;
}

export async function updateOperatorAction(
  actionId: string,
  patch: Partial<Pick<OperatorAction, "status" | "preview" | "result" | "undoPayload" | "errorText">>
): Promise<OperatorAction | null> {
  const existing = await getOperatorAction(actionId);
  if (!existing) return null;

  const next: OperatorAction = {
    ...existing,
    status: patch.status ?? existing.status,
    preview: patch.preview ?? existing.preview,
    result: patch.result ?? existing.result,
    undoPayload: patch.undoPayload ?? existing.undoPayload,
    errorText: patch.errorText !== undefined ? String(patch.errorText ?? "").trim() : existing.errorText,
    updatedAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ACTION)
      .update({
        status: next.status,
        preview: next.preview,
        result: next.result,
        undo_payload: next.undoPayload,
        error_text: next.errorText,
        updated_at: next.updatedAt,
      })
      .eq("id", actionId)
      .select("*")
      .maybeSingle();
    if (!error && data) return mapActionRow(data);
    if (error && isVercel) {
      throw new OperatorDataError("Failed to update Operator action in Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_ACTION, actionId, supabaseError: error.message },
      });
    }
  }

  const store = await readLocalStore();
  store.actions = store.actions.map((action) => (action.id === actionId ? next : action));
  await writeLocalStore(store);
  return next;
}

export async function createOperatorApproval(input: {
  actionId: string;
  requestedByUserId?: string;
  decidedByUserId?: string;
  decision: OperatorApproval["decision"];
  note?: string;
}): Promise<OperatorApproval> {
  const row: OperatorApproval = {
    id: createId("opapp"),
    actionId: input.actionId,
    requestedByUserId: String(input.requestedByUserId ?? "").trim(),
    decidedByUserId: String(input.decidedByUserId ?? "").trim(),
    decision: input.decision,
    note: String(input.note ?? "").trim(),
    createdAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_APPROVAL)
      .insert({
        id: row.id,
        action_id: row.actionId,
        requested_by_user_id: row.requestedByUserId || null,
        decided_by_user_id: row.decidedByUserId || null,
        decision: row.decision,
        note: row.note,
        created_at: row.createdAt,
      })
      .select("*")
      .maybeSingle();
    if (!error && data) return mapApprovalRow(data);
    if (error && isVercel) {
      throw new OperatorDataError("Failed to create Operator approval in Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_APPROVAL, supabaseError: error.message },
      });
    }
  }

  const store = await readLocalStore();
  store.approvals.push(row);
  await writeLocalStore(store);
  return row;
}

export async function listOperatorMemory(input: {
  scopeType?: OperatorMemory["scopeType"];
  scopeId?: string;
} = {}): Promise<OperatorMemory[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase.from(TABLE_MEMORY).select("*").order("updated_at", { ascending: false });
    if (input.scopeType?.trim()) query = query.eq("scope_type", input.scopeType.trim());
    if (input.scopeId?.trim()) query = query.eq("scope_id", input.scopeId.trim());
    const { data, error } = await query;
    if (!error) return (data ?? []).map((row: unknown) => mapMemoryRow(row));
    if (isVercel) {
      throw new OperatorDataError("Failed to list Operator memory from Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_MEMORY, supabaseError: error.message },
      });
    }
  }

  const store = await readLocalStore();
  return store.memory
    .filter((row) => !input.scopeType?.trim() || row.scopeType === input.scopeType)
    .filter((row) => !input.scopeId?.trim() || row.scopeId === input.scopeId.trim())
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function upsertOperatorMemory(input: {
  scopeType: OperatorMemory["scopeType"];
  scopeId: string;
  memoryKey: string;
  value: Record<string, unknown>;
  source?: string;
  confidence?: number;
  sensitivity?: OperatorMemory["sensitivity"];
  lastVerifiedAt?: string;
  expiresAt?: string;
}): Promise<OperatorMemory> {
  const existing = (await listOperatorMemory({ scopeType: input.scopeType, scopeId: input.scopeId }))
    .find((row) => row.memoryKey === input.memoryKey) ?? null;

  const row: OperatorMemory = {
    id: existing?.id ?? createId("opmem"),
    scopeType: input.scopeType,
    scopeId: input.scopeId.trim(),
    memoryKey: input.memoryKey.trim(),
    value: input.value,
    source: String(input.source ?? existing?.source ?? "operator").trim(),
    confidence: Number(input.confidence ?? existing?.confidence ?? 1) || 1,
    sensitivity: input.sensitivity ?? existing?.sensitivity ?? "normal",
    lastVerifiedAt: String(input.lastVerifiedAt ?? existing?.lastVerifiedAt ?? "").trim(),
    expiresAt: String(input.expiresAt ?? existing?.expiresAt ?? "").trim(),
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MEMORY)
      .upsert(
        {
          id: row.id,
          scope_type: row.scopeType,
          scope_id: row.scopeId,
          memory_key: row.memoryKey,
          value: row.value,
          source: row.source,
          confidence: row.confidence,
          sensitivity: row.sensitivity,
          last_verified_at: row.lastVerifiedAt || null,
          expires_at: row.expiresAt || null,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
        },
        { onConflict: "scope_type,scope_id,memory_key" }
      )
      .select("*")
      .maybeSingle();
    if (!error && data) return mapMemoryRow(data);
    if (error && isVercel) {
      throw new OperatorDataError("Failed to upsert Operator memory in Supabase.", {
        status: 500,
        hint: "Apply the Operator migrations, then redeploy.",
        debug: { table: TABLE_MEMORY, supabaseError: error.message },
      });
    }
  }

  const store = await readLocalStore();
  const index = store.memory.findIndex(
    (entry) =>
      entry.scopeType === row.scopeType &&
      entry.scopeId === row.scopeId &&
      entry.memoryKey === row.memoryKey
  );
  if (index >= 0) {
    store.memory[index] = row;
  } else {
    store.memory.unshift(row);
  }
  await writeLocalStore(store);
  return row;
}
