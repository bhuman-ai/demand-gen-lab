type Env = {
  OUTREACH_TICK_URL: string;
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

function isRetryableStatus(status: number) {
  return RETRYABLE_STATUSES.has(status);
}

function isAuthorizedManual(request: Request, env: Env) {
  const expected = String(env.MANUAL_TRIGGER_TOKEN ?? "").trim();
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

async function invokeOutreachTick(env: Env, source: string): Promise<TickResult> {
  const started = nowMs();
  const url = String(env.OUTREACH_TICK_URL ?? "").trim();
  const token = String(env.OUTREACH_CRON_TOKEN ?? "").trim();

  if (!url) {
    return {
      ok: false,
      error: "OUTREACH_TICK_URL is missing",
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
          source,
          attempt,
          scheduledAt: new Date().toISOString(),
        }),
      });

      const raw = await response.text();
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          body: parseJsonSafe(raw),
          attemptCount: attempt,
          elapsedMs: nowMs() - started,
        };
      }

      if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) {
        return {
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
    ok: false,
    error: "Tick failed after retries",
    attemptCount: MAX_ATTEMPTS,
    elapsedMs: nowMs() - started,
  };
}

const worker = {
  async scheduled(event: ScheduledLikeEvent, env: Env, ctx: WorkerExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const result = await invokeOutreachTick(env, `cron:${event.cron}`);
        console.log(JSON.stringify({ source: "scheduled", result }));
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

      const result = await invokeOutreachTick(env, "manual:/run");
      return Response.json(result, { status: result.ok ? 200 : 500 });
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
