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

export type GmailUiWorkerSendResult = {
  ok: boolean;
  accountId: string;
  fromEmail: string;
  providerMessageId: string;
  error: string;
  sentVerified: boolean;
  sentVerification: GmailUiWorkerSentVerification | null;
  screenshotPath: string;
  currentUrl: string;
  title: string;
  updatedAt: string;
};

export type GmailUiWorkerSentVerification = {
  verified: boolean;
  query: string;
  reason: string;
  recipientMatched: boolean;
  subjectMatched: boolean;
  phraseMatched: boolean;
  bodyExcerpt: string;
  currentUrl: string;
  title: string;
  checkedAt: string;
};

export type GmailUiWorkerSearchResult = {
  ok: boolean;
  accountId: string;
  fromEmail: string;
  query: string;
  bodyExcerpt: string;
  screenshotPath: string;
  currentUrl: string;
  title: string;
  updatedAt: string;
};

export type GmailUiWorkerSentVerifyResult = {
  ok: boolean;
  accountId: string;
  fromEmail: string;
  verification: GmailUiWorkerSentVerification;
  screenshotPath: string;
  currentUrl: string;
  title: string;
  updatedAt: string;
};

export type GmailUiWorkerHealth = {
  ok: boolean;
  status: string;
  sessions: number;
  baseUrl: string;
};

function inferredWorkerBaseUrl() {
  const explicitBaseUrl = String(process.env.GMAIL_UI_WORKER_BASE_URL ?? "").trim();
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/+$/, "");
  }
  if (process.env.VERCEL) {
    return "";
  }
  const port = String(process.env.GMAIL_UI_WORKER_PORT ?? "").trim();
  if (!port) {
    return "";
  }
  return `http://127.0.0.1:${port}`;
}

export function hasGmailUiWorkerConfig() {
  return Boolean(inferredWorkerBaseUrl() && String(process.env.GMAIL_UI_WORKER_TOKEN ?? "").trim());
}

function workerBaseUrl() {
  const baseUrl = inferredWorkerBaseUrl();
  if (!baseUrl) {
    throw new Error("GMAIL_UI_WORKER_BASE_URL is not configured.");
  }
  return baseUrl;
}

function workerToken() {
  const token = String(process.env.GMAIL_UI_WORKER_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("GMAIL_UI_WORKER_TOKEN is not configured.");
  }
  return token;
}

function workerRequestTimeoutMs() {
  const parsed = Number(process.env.GMAIL_UI_WORKER_REQUEST_TIMEOUT_MS ?? 180_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 180_000;
}

export async function getGmailUiWorkerHealth(): Promise<GmailUiWorkerHealth> {
  const data = await workerRequest("/health", {
    method: "GET",
  });
  return {
    ok: Boolean(data.ok),
    status: String(data.status ?? "unknown").trim() || "unknown",
    sessions: Number(data.sessions ?? 0) || 0,
    baseUrl: workerBaseUrl(),
  };
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), workerRequestTimeoutMs());
  try {
    const response = await fetch(`${workerBaseUrl()}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${workerToken()}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
    return readJson(response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Gmail UI worker request timed out after ${workerRequestTimeoutMs()}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

function parseSentVerification(value: unknown): GmailUiWorkerSentVerification | null {
  const data = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
  if (!data) return null;
  return {
    verified: Boolean(data.verified),
    query: String(data.query ?? "").trim(),
    reason: String(data.reason ?? "").trim(),
    recipientMatched: Boolean(data.recipientMatched),
    subjectMatched: Boolean(data.subjectMatched),
    phraseMatched: Boolean(data.phraseMatched),
    bodyExcerpt: String(data.bodyExcerpt ?? "").trim(),
    currentUrl: String(data.currentUrl ?? "").trim(),
    title: String(data.title ?? "").trim(),
    checkedAt: String(data.checkedAt ?? "").trim(),
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
      ignoreConfiguredProxy: input?.ignoreConfiguredProxy,
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

export async function sendGmailUiWorkerMessage(
  accountId: string,
  input: {
    recipient: string;
    subject: string;
    body: string;
    expectedFrom?: string;
    otp?: string;
    password?: string;
    ignoreConfiguredProxy?: boolean;
    refreshMailpoolCredentials?: boolean;
  }
): Promise<GmailUiWorkerSendResult> {
  const data = await workerRequest(`/accounts/${encodeURIComponent(accountId)}/send`, {
    method: "POST",
    body: JSON.stringify({
      recipient: String(input.recipient ?? "").trim(),
      subject: String(input.subject ?? "").trim(),
      body: String(input.body ?? "").trim(),
      expectedFrom: String(input.expectedFrom ?? "").trim(),
      otp: String(input.otp ?? "").trim(),
      password: String(input.password ?? "").trim(),
      ignoreConfiguredProxy: input.ignoreConfiguredProxy,
      refreshMailpoolCredentials: input.refreshMailpoolCredentials !== false,
    }),
  });
  return {
    ok: Boolean(data.ok),
    accountId: String(data.accountId ?? "").trim(),
    fromEmail: String(data.fromEmail ?? "").trim(),
    providerMessageId: String(data.providerMessageId ?? "").trim(),
    error: String(data.error ?? "").trim(),
    sentVerified: Boolean(data.sentVerified),
    sentVerification: parseSentVerification(data.sentVerification),
    screenshotPath: String(data.screenshotPath ?? "").trim(),
    currentUrl: String(data.currentUrl ?? "").trim(),
    title: String(data.title ?? "").trim(),
    updatedAt: String(data.updatedAt ?? "").trim(),
  };
}

export async function searchGmailUiWorkerMailbox(
  accountId: string,
  input: {
    query: string;
    otp?: string;
    password?: string;
    ignoreConfiguredProxy?: boolean;
    refreshMailpoolCredentials?: boolean;
  }
): Promise<GmailUiWorkerSearchResult> {
  const data = await workerRequest(`/accounts/${encodeURIComponent(accountId)}/search`, {
    method: "POST",
    body: JSON.stringify({
      query: String(input.query ?? "").trim(),
      otp: String(input.otp ?? "").trim(),
      password: String(input.password ?? "").trim(),
      ignoreConfiguredProxy: input.ignoreConfiguredProxy,
      refreshMailpoolCredentials: input.refreshMailpoolCredentials !== false,
    }),
  });
  return {
    ok: Boolean(data.ok),
    accountId: String(data.accountId ?? "").trim(),
    fromEmail: String(data.fromEmail ?? "").trim(),
    query: String(data.query ?? "").trim(),
    bodyExcerpt: String(data.bodyExcerpt ?? "").trim(),
    screenshotPath: String(data.screenshotPath ?? "").trim(),
    currentUrl: String(data.currentUrl ?? "").trim(),
    title: String(data.title ?? "").trim(),
    updatedAt: String(data.updatedAt ?? "").trim(),
  };
}

export async function verifyGmailUiWorkerSentMessage(
  accountId: string,
  input: {
    recipient: string;
    subject?: string;
    body?: string;
    otp?: string;
    password?: string;
    ignoreConfiguredProxy?: boolean;
    refreshMailpoolCredentials?: boolean;
  }
): Promise<GmailUiWorkerSentVerifyResult> {
  const data = await workerRequest(`/accounts/${encodeURIComponent(accountId)}/sent/verify`, {
    method: "POST",
    body: JSON.stringify({
      recipient: String(input.recipient ?? "").trim(),
      subject: String(input.subject ?? "").trim(),
      body: String(input.body ?? "").trim(),
      otp: String(input.otp ?? "").trim(),
      password: String(input.password ?? "").trim(),
      ignoreConfiguredProxy: input.ignoreConfiguredProxy,
      refreshMailpoolCredentials: input.refreshMailpoolCredentials !== false,
    }),
  });
  return {
    ok: Boolean(data.ok),
    accountId: String(data.accountId ?? "").trim(),
    fromEmail: String(data.fromEmail ?? "").trim(),
    verification: parseSentVerification(data.verification) ?? {
      verified: false,
      query: "",
      reason: "Worker did not return verification details.",
      recipientMatched: false,
      subjectMatched: false,
      phraseMatched: false,
      bodyExcerpt: "",
      currentUrl: String(data.currentUrl ?? "").trim(),
      title: String(data.title ?? "").trim(),
      checkedAt: "",
    },
    screenshotPath: String(data.screenshotPath ?? "").trim(),
    currentUrl: String(data.currentUrl ?? "").trim(),
    title: String(data.title ?? "").trim(),
    updatedAt: String(data.updatedAt ?? "").trim(),
  };
}
