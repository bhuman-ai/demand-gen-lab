import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const TABLE_INTERNAL_CRON_RUNS = "demanddev_internal_cron_runs";

function envFlag(name: string) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] ?? "").trim().toLowerCase());
}

export function isInternalCronAuthorized(request: Request) {
  if (envFlag("LASTB2B_AUTOMATION_STOPPED")) return false;
  const tokens = [process.env.OUTREACH_CRON_TOKEN, process.env.CRON_SECRET]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (!tokens.length) return true;
  const header = request.headers.get("authorization") ?? "";
  return tokens.some((token) => header === `Bearer ${token}`);
}

export function cronErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal cron task failed.";
}

type SettledCronTaskSuccess<T> = {
  name: string;
  ok: true;
  durationMs: number;
  value: T;
};

type SettledCronTaskFailure = {
  name: string;
  ok: false;
  durationMs: number;
  error: string;
};

export type SettledCronTaskResult<T> = SettledCronTaskSuccess<T> | SettledCronTaskFailure;

export async function runCronTask<T>(
  name: string,
  task: () => Promise<T>,
  options: { timeoutMs?: number } = {}
): Promise<SettledCronTaskResult<T>> {
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    const value =
      typeof options.timeoutMs === "number" && options.timeoutMs > 0
        ? await Promise.race<T>([
            task(),
            new Promise<T>((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error(`${name} timed out after ${options.timeoutMs}ms`)),
                options.timeoutMs
              );
              timeout.unref?.();
            }),
          ])
        : await task();

    return {
      name,
      ok: true,
      durationMs: Date.now() - startedAt,
      value,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: cronErrorMessage(error),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function jsonSafe(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}

export async function recordInternalCronRun(input: {
  taskName: string;
  route: string;
  ok: boolean;
  durationMs: number;
  details?: unknown;
  error?: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from(TABLE_INTERNAL_CRON_RUNS)
      .insert({
        id: `cron_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        task_name: input.taskName,
        route: input.route,
        ok: input.ok,
        duration_ms: Math.max(0, Math.round(Number(input.durationMs) || 0)),
        details: jsonSafe(input.details),
        error: String(input.error ?? "").trim(),
      })
      .select("*")
      .single();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}
