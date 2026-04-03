type GmailUiWorkerStep =
  | "opening"
  | "account_picker"
  | "awaiting_email"
  | "awaiting_password"
  | "awaiting_otp"
  | "ready"
  | "error"
  | "unknown";

export type GmailUiWorkerSessionSnapshot = {
  ok: boolean;
  accountId: string;
  fromEmail: string;
  step: GmailUiWorkerStep;
  prompt: string;
  currentUrl: string;
  title: string;
  loginState: "login_required" | "ready" | "error";
  screenshotPath: string;
  updatedAt: string;
};

function workerBaseUrl() {
  const baseUrl = String(process.env.GMAIL_UI_WORKER_BASE_URL ?? "").trim();
  if (!baseUrl) {
    throw new Error("GMAIL_UI_WORKER_BASE_URL is not configured.");
  }
  return baseUrl.replace(/\/+$/, "");
}

function workerToken() {
  const token = String(process.env.GMAIL_UI_WORKER_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("GMAIL_UI_WORKER_TOKEN is not configured.");
  }
  return token;
}

async function readJson(response: Response) {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = String(data.error ?? data.message ?? response.statusText).trim() || "Worker request failed";
    throw new Error(message);
  }
  return data;
}

async function workerRequest(
  pathname: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  const response = await fetch(`${workerBaseUrl()}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${workerToken()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  return readJson(response);
}

function parseSnapshot(data: Record<string, unknown>): GmailUiWorkerSessionSnapshot {
  return {
    ok: Boolean(data.ok),
    accountId: String(data.accountId ?? "").trim(),
    fromEmail: String(data.fromEmail ?? "").trim(),
    step: String(data.step ?? "unknown").trim() as GmailUiWorkerStep,
    prompt: String(data.prompt ?? "").trim(),
    currentUrl: String(data.currentUrl ?? "").trim(),
    title: String(data.title ?? "").trim(),
    loginState: String(data.loginState ?? "login_required").trim() as
      | "login_required"
      | "ready"
      | "error",
    screenshotPath: String(data.screenshotPath ?? "").trim(),
    updatedAt: String(data.updatedAt ?? "").trim(),
  };
}

export async function getGmailUiWorkerSession(accountId: string) {
  const data = await workerRequest(`/accounts/${encodeURIComponent(accountId)}`);
  return parseSnapshot(data);
}

export async function advanceGmailUiWorkerSession(
  accountId: string,
  input?: {
    otp?: string;
    password?: string;
    ignoreConfiguredProxy?: boolean;
    refreshMailpoolCredentials?: boolean;
  }
) {
  const data = await workerRequest(`/accounts/${encodeURIComponent(accountId)}/step`, {
    method: "POST",
    body: JSON.stringify({
      otp: String(input?.otp ?? "").trim(),
      password: String(input?.password ?? "").trim(),
      ignoreConfiguredProxy: Boolean(input?.ignoreConfiguredProxy),
      refreshMailpoolCredentials: input?.refreshMailpoolCredentials !== false,
    }),
  });
  return parseSnapshot(data);
}

export async function closeGmailUiWorkerSession(accountId: string) {
  const data = await workerRequest(`/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
  });
  return {
    ok: Boolean(data.ok),
    accountId: String(data.accountId ?? "").trim(),
    closed: Boolean(data.closed),
  };
}
