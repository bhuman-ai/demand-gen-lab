type Env = {
  OUTREACH_TICK_URL?: string;
  OUTBOX_AUTOPILOT_URL?: string;
  OUTREACH_OPS_TICK_URL?: string;
  OUTREACH_OPS_TICK_EVERY_MINUTES?: string;
  OUTREACH_CRON_TOKEN?: string;
  MANUAL_TRIGGER_TOKEN?: string;
};

type ScheduledLikeEvent = {
  cron: string;
};

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type TickResult = {
  name: string;
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
  attemptCount: number;
  elapsedMs: number;
};

const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function nowMs() {
  return Date.now();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonSafe(raw: string) {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldRunEveryMinutes(everyMinutes: number, date = new Date()) {
  return date.getUTCMinutes() % everyMinutes === 0;
}

function isRetryableStatus(status: number) {
  return RETRYABLE_STATUSES.has(status);
}

function isAuthorizedManual(request: Request, env: Env) {
  const expected = String(env.MANUAL_TRIGGER_TOKEN ?? "").trim();
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

async function invokeTickEndpoint(input: {
  name: string;
  url: string;
  env: Env;
  source: string;
}): Promise<TickResult> {
  const started = nowMs();
  const url = input.url.trim();
  const token = String(input.env.OUTREACH_CRON_TOKEN ?? "").trim();

  if (!url) {
    return {
      name: input.name,
      ok: false,
      error: `${input.name} URL is missing`,
      attemptCount: 0,
      elapsedMs: nowMs() - started,
    };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "user-agent": "factory-outreach-cron-worker/1.0",
        },
        body: JSON.stringify({
          source: input.source,
          attempt,
          scheduledAt: new Date().toISOString(),
        }),
      });

      const raw = await response.text();
      if (response.ok) {
        return {
          name: input.name,
          ok: true,
          status: response.status,
          body: parseJsonSafe(raw),
          attemptCount: attempt,
          elapsedMs: nowMs() - started,
        };
      }

      if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) {
        return {
          name: input.name,
          ok: false,
          status: response.status,
          body: parseJsonSafe(raw),
          error: `Tick endpoint returned HTTP ${response.status}`,
          attemptCount: attempt,
          elapsedMs: nowMs() - started,
        };
      }

      await sleep(1000 * attempt);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown fetch failure";
      if (attempt === MAX_ATTEMPTS) {
        return {
          name: input.name,
          ok: false,
          error: message,
          attemptCount: attempt,
          elapsedMs: nowMs() - started,
        };
      }
      await sleep(1000 * attempt);
    }
  }

  return {
    name: input.name,
    ok: false,
    error: "Tick failed after retries",
    attemptCount: MAX_ATTEMPTS,
    elapsedMs: nowMs() - started,
  };
}

function scheduledEndpoints(env: Env, source: string) {
  const outboxUrl = String(env.OUTBOX_AUTOPILOT_URL ?? "").trim();
  const opsUrl = String(env.OUTREACH_OPS_TICK_URL ?? "").trim();
  const legacyUrl = String(env.OUTREACH_TICK_URL ?? "").trim();
  const opsEveryMinutes = positiveInt(env.OUTREACH_OPS_TICK_EVERY_MINUTES, 15);
  const endpoints: Array<{ name: string; url: string; source: string }> = [];

  if (outboxUrl) {
    endpoints.push({ name: "outbox_autopilot", url: outboxUrl, source });
  }
  if (opsUrl && shouldRunEveryMinutes(opsEveryMinutes)) {
    endpoints.push({ name: "outreach_ops_tick", url: opsUrl, source });
  }
  if (!endpoints.length && legacyUrl) {
    endpoints.push({ name: "legacy_outreach_tick", url: legacyUrl, source });
  }
  return endpoints;
}

async function invokeScheduledTicks(env: Env, source: string): Promise<TickResult[]> {
  const endpoints = scheduledEndpoints(env, source);
  if (!endpoints.length) {
    return [{
      name: "scheduler",
      ok: false,
      error: "No tick endpoint URLs are configured",
      attemptCount: 0,
      elapsedMs: 0,
    }];
  }

  const results: TickResult[] = [];
  for (const endpoint of endpoints) {
    results.push(await invokeTickEndpoint({ ...endpoint, env }));
  }
  return results;
}

const worker = {
  async scheduled(event: ScheduledLikeEvent, env: Env, ctx: WorkerExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const results = await invokeScheduledTicks(env, `cron:${event.cron}`);
        console.log(JSON.stringify({ source: "scheduled", results }));
      })()
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "factory-outreach-cron",
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/run") {
      if (!isAuthorizedManual(request, env)) {
        return Response.json(
          {
            error: "unauthorized",
            hint: "Use Authorization: Bearer <MANUAL_TRIGGER_TOKEN>",
          },
          { status: 401 }
        );
      }

      const results = await invokeScheduledTicks(env, "manual:/run");
      const ok = results.every((result) => result.ok);
      return Response.json({ ok, results }, { status: ok ? 200 : 500 });
    }

    return Response.json(
      {
        ok: false,
        error: "not_found",
        routes: ["/health", "/run"],
      },
      { status: 404 }
    );
  },
};

export default worker;
