export function isInternalCronAuthorized(request: Request) {
  const token =
    String(process.env.OUTREACH_CRON_TOKEN ?? "").trim() ||
    String(process.env.CRON_SECRET ?? "").trim();
  if (!token) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
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

  try {
    const value =
      typeof options.timeoutMs === "number" && options.timeoutMs > 0
        ? await Promise.race<T>([
            task(),
            new Promise<T>((_, reject) => {
              setTimeout(() => reject(new Error(`${name} timed out after ${options.timeoutMs}ms`)), options.timeoutMs);
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
  }
}
