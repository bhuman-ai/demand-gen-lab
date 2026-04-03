import { mkdir } from "fs/promises";
import fs from "fs";
import http from "http";
import path from "path";
import { chromium } from "playwright";

type SessionStep =
  | "opening"
  | "account_picker"
  | "awaiting_email"
  | "awaiting_password"
  | "awaiting_otp"
  | "ready"
  | "error"
  | "unknown";

type SessionSnapshot = {
  ok: boolean;
  accountId: string;
  fromEmail: string;
  step: SessionStep;
  prompt: string;
  currentUrl: string;
  title: string;
  loginState: "login_required" | "ready" | "error";
  screenshotPath: string;
  updatedAt: string;
};

type SessionHandle = {
  accountId: string;
  fromEmail: string;
  userDataDir: string;
  context: any;
  page: any;
  updatedAt: string;
  screenshotPath: string;
};

type AdvanceInput = {
  otp?: string;
  password?: string;
  ignoreConfiguredProxy?: boolean;
  refreshMailpoolCredentials?: boolean;
};

const sessions = new Map<string, SessionHandle>();
const SCREENSHOT_DIR = path.join(process.cwd(), "output", "playwright", "gmail-ui-worker");
const IDLE_TTL_MS = 15 * 60 * 1000;
const COMPOSE_SELECTOR =
  'div[gh="cm"], [role="button"][gh="cm"], [role="button"][aria-label^="Compose"], div[role="button"]:has-text("Compose")';

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    if (process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "").trim();
  }
}

function ensureDisplayEnv() {
  if (String(process.env.DISPLAY ?? "").trim()) return;
  const configured = String(process.env.GMAIL_UI_DISPLAY ?? "").trim();
  process.env.DISPLAY = configured || ":99";
}

function workerToken() {
  return String(process.env.GMAIL_UI_WORKER_TOKEN ?? "").trim();
}

function listenHost() {
  return String(process.env.GMAIL_UI_WORKER_HOST ?? "0.0.0.0").trim();
}

function listenPort() {
  return Number(process.env.GMAIL_UI_WORKER_PORT ?? 8788) || 8788;
}

function resolveExecutablePath() {
  return String(process.env.GMAIL_UI_EXECUTABLE_PATH ?? process.env.CHROME_EXECUTABLE_PATH ?? "").trim();
}

function defaultIgnoreConfiguredProxy() {
  const value = String(process.env.GMAIL_UI_WORKER_IGNORE_CONFIGURED_PROXY ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function readJsonBody(request: http.IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(response: http.ServerResponse, status: number, data: Record<string, unknown>) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(data));
}

function resolveProxy(config: {
  proxyUrl: string;
  proxyHost: string;
  proxyPort: number;
  proxyUsername: string;
  proxyPassword: string;
}) {
  if (config.proxyHost.trim() && config.proxyPort) {
    return {
      server: `http://${config.proxyHost.trim()}:${config.proxyPort}`,
      username: config.proxyUsername.trim() || undefined,
      password: config.proxyPassword.trim() || undefined,
    };
  }
  if (!config.proxyUrl.trim()) return undefined;
  try {
    const parsed = new URL(config.proxyUrl.trim());
    return {
      server: `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`,
      username: parsed.username ? decodeURIComponent(parsed.username) : config.proxyUsername.trim() || undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : config.proxyPassword.trim() || undefined,
    };
  } catch {
    return {
      server: config.proxyUrl.trim(),
      username: config.proxyUsername.trim() || undefined,
      password: config.proxyPassword.trim() || undefined,
    };
  }
}

async function firstVisible(page: any, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function settlePage(page: any) {
  await page.waitForTimeout(1200).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
}

async function detectSessionStep(page: any): Promise<Omit<SessionSnapshot, "ok" | "accountId" | "fromEmail" | "updatedAt" | "screenshotPath">> {
  const currentUrl = String(page.url() ?? "");
  const title = String((await page.title().catch(() => "")) ?? "");
  const composeVisible = await page.locator(COMPOSE_SELECTOR).first().isVisible().catch(() => false);

  if (composeVisible) {
    return {
      step: "ready",
      prompt: "Gmail inbox is open. This sender profile is logged in.",
      currentUrl,
      title,
      loginState: "ready",
    };
  }

  if (
    await firstVisible(page, [
      'button:has-text("Use another account")',
      'div[role="button"]:has-text("Use another account")',
      'div[role="link"]:has-text("Use another account")',
    ])
  ) {
    return {
      step: "account_picker",
      prompt: "Google is showing an account chooser. Continue with this sender account.",
      currentUrl,
      title,
      loginState: "login_required",
    };
  }

  if (
    await firstVisible(page, [
      'input[type="email"]',
      'input[name="identifier"]',
    ])
  ) {
    return {
      step: "awaiting_email",
      prompt: "Google is asking for the Gmail address.",
      currentUrl,
      title,
      loginState: "login_required",
    };
  }

  if (
    await firstVisible(page, [
      'input[type="password"]',
      'input[name="Passwd"]',
    ])
  ) {
    return {
      step: "awaiting_password",
      prompt: "Google is asking for the password.",
      currentUrl,
      title,
      loginState: "login_required",
    };
  }

  const bodyText = String((await page.locator("body").innerText().catch(() => "")) ?? "").toLowerCase();
  const otpInput = await firstVisible(page, [
    'input[autocomplete="one-time-code"]',
    'input[name="totpPin"]',
    'input[type="tel"]',
    'input[inputmode="numeric"]',
    'input[aria-label*="code" i]',
  ]);
  const otpPrompt =
    otpInput ||
    [
      "enter the code",
      "verification code",
      "google authenticator",
      "2-step verification",
      "two-step verification",
      "enter a code",
      "verify it",
      "verify it's you",
      "verify it’s you",
    ].some((phrase) => bodyText.includes(phrase));
  if (otpPrompt) {
    return {
      step: "awaiting_otp",
      prompt: "Google is asking for the one-time code for this sender.",
      currentUrl,
      title,
      loginState: "login_required",
    };
  }

  if (
    currentUrl.includes("accounts.google.com") ||
    bodyText.includes("choose an account") ||
    bodyText.includes("to continue to gmail")
  ) {
    return {
      step: "unknown",
      prompt: "Google login is still in progress for this sender.",
      currentUrl,
      title,
      loginState: "login_required",
    };
  }

  return {
    step: "error",
    prompt: "The worker opened Chrome, but the Gmail session did not reach the inbox or a recognized login step.",
    currentUrl,
    title,
    loginState: "error",
  };
}

async function clickNext(page: any) {
  const nextButton = await firstVisible(page, [
    '#identifierNext button',
    '#passwordNext button',
    'button:has-text("Next")',
    'div[role="button"]:has-text("Next")',
  ]);
  if (nextButton) {
    await nextButton.click().catch(() => {});
    await settlePage(page);
    return;
  }
  await page.keyboard.press("Enter").catch(() => {});
  await settlePage(page);
}

async function fillVisibleField(page: any, selectors: string[], value: string) {
  const locator = await firstVisible(page, selectors);
  if (!locator) return false;
  await locator.click().catch(() => {});
  await locator.fill(value).catch(() => {});
  await settlePage(page);
  return true;
}

async function clickUseAnotherAccount(page: any) {
  const locator = await firstVisible(page, [
    'button:has-text("Use another account")',
    'div[role="button"]:has-text("Use another account")',
    'div[role="link"]:has-text("Use another account")',
  ]);
  if (!locator) return false;
  await locator.click().catch(() => {});
  await settlePage(page);
  return true;
}

async function persistSnapshot(accountId: string, snapshot: SessionSnapshot) {
  const { persistGmailUiSessionCheck } = await import("@/lib/gmail-ui-login");
  await persistGmailUiSessionCheck(accountId, {
    state: snapshot.loginState,
    summary: snapshot.prompt,
    currentUrl: snapshot.currentUrl,
    title: snapshot.title,
    composeVisible: snapshot.loginState === "ready",
  }).catch(() => {});
}

async function takeSnapshot(handle: SessionHandle, snapshot: Omit<SessionSnapshot, "ok" | "accountId" | "fromEmail" | "updatedAt" | "screenshotPath">) {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(
    SCREENSHOT_DIR,
    `${handle.accountId}-${Date.now().toString(36)}.png`
  );
  await handle.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  handle.updatedAt = new Date().toISOString();
  handle.screenshotPath = screenshotPath;
  const result: SessionSnapshot = {
    ok: snapshot.step === "ready",
    accountId: handle.accountId,
    fromEmail: handle.fromEmail,
    step: snapshot.step,
    prompt: snapshot.prompt,
    currentUrl: snapshot.currentUrl,
    title: snapshot.title,
    loginState: snapshot.loginState,
    screenshotPath,
    updatedAt: handle.updatedAt,
  };
  await persistSnapshot(handle.accountId, result);
  return result;
}

async function loadAccountBundle(accountId: string, refreshMailpoolCredentials = true) {
  const {
    getOutreachAccount,
    getOutreachAccountSecrets,
  } = await import("@/lib/outreach-data");
  const { syncMailpoolOutreachAccountCredentials } = await import("@/lib/mailpool-account-refresh");

  let account = await getOutreachAccount(accountId);
  if (!account) {
    throw new Error("Outreach account not found.");
  }

  if (refreshMailpoolCredentials && account.provider === "mailpool") {
    account = await syncMailpoolOutreachAccountCredentials(account.id);
  }

  const secrets = await getOutreachAccountSecrets(accountId);
  if (!secrets) {
    throw new Error("Outreach account credentials are missing.");
  }

  return { account, secrets };
}

async function getOrCreateSession(accountId: string, input: AdvanceInput) {
  const existing = sessions.get(accountId);
  if (existing && !existing.page.isClosed()) {
    return existing;
  }

  const { account } = await loadAccountBundle(accountId, input.refreshMailpoolCredentials !== false);
  const { getOutreachAccountFromEmail } = await import("@/lib/outreach-account-helpers");
  const { resolveGmailUiUserDataDir } = await import("@/lib/gmail-ui-profile");

  if (account.config.mailbox.deliveryMethod !== "gmail_ui") {
    throw new Error(`Account ${account.id} is not configured for gmail_ui delivery.`);
  }

  const { userDataDir } = resolveGmailUiUserDataDir({
    profileRoot: String(process.env.GMAIL_UI_PROFILE_ROOT ?? "").trim(),
    existingUserDataDir: account.config.mailbox.gmailUiUserDataDir,
    email: getOutreachAccountFromEmail(account),
  });
  if (!userDataDir) {
    throw new Error(`gmailUiUserDataDir missing for ${account.id}.`);
  }
  await mkdir(userDataDir, { recursive: true });

  const ignoreConfiguredProxy = input.ignoreConfiguredProxy ?? defaultIgnoreConfiguredProxy();
  const executablePath = resolveExecutablePath();
  const proxy = ignoreConfiguredProxy ? undefined : resolveProxy(account.config.mailbox);
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(executablePath
      ? { executablePath }
      : { channel: account.config.mailbox.gmailUiBrowserChannel || "chrome" }),
    headless: false,
    viewport: { width: 1440, height: 980 },
    args: account.config.mailbox.gmailUiProfileDirectory.trim()
      ? [`--profile-directory=${account.config.mailbox.gmailUiProfileDirectory.trim()}`]
      : [],
    proxy,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const handle: SessionHandle = {
    accountId: account.id,
    fromEmail: getOutreachAccountFromEmail(account).trim().toLowerCase(),
    userDataDir,
    context,
    page,
    updatedAt: new Date().toISOString(),
    screenshotPath: "",
  };
  sessions.set(accountId, handle);
  return handle;
}

async function advanceSession(accountId: string, input: AdvanceInput = {}) {
  const handle = await getOrCreateSession(accountId, input);
  const { account, secrets } = await loadAccountBundle(accountId, input.refreshMailpoolCredentials !== false);

  await handle.page.goto("https://mail.google.com/mail/u/0/#inbox", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  }).catch(() => {});
  await settlePage(handle.page);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const detected = await detectSessionStep(handle.page);

    if (detected.step === "account_picker") {
      const clicked = await clickUseAnotherAccount(handle.page);
      if (clicked) continue;
    }

    if (detected.step === "awaiting_email" && handle.fromEmail) {
      const filled = await fillVisibleField(handle.page, ['input[type="email"]', 'input[name="identifier"]'], handle.fromEmail);
      if (filled) {
        await clickNext(handle.page);
        continue;
      }
    }

    if (detected.step === "awaiting_password") {
      const password = String(input.password ?? "").trim() || secrets.mailboxPassword.trim();
      if (password) {
        const filled = await fillVisibleField(handle.page, ['input[type="password"]', 'input[name="Passwd"]'], password);
        if (filled) {
          await clickNext(handle.page);
          continue;
        }
      }
    }

    if (detected.step === "awaiting_otp") {
      const otp = String(input.otp ?? "").trim();
      if (otp) {
        const filled = await fillVisibleField(handle.page, [
          'input[autocomplete="one-time-code"]',
          'input[name="totpPin"]',
          'input[type="tel"]',
          'input[inputmode="numeric"]',
          'input[aria-label*="code" i]',
        ], otp);
        if (filled) {
          await clickNext(handle.page);
          continue;
        }
      }
    }

    return takeSnapshot(handle, detected);
  }

  return takeSnapshot(handle, await detectSessionStep(handle.page));
}

async function getSessionSnapshot(accountId: string) {
  const handle = sessions.get(accountId);
  if (!handle || handle.page.isClosed()) {
    throw new Error("No active Gmail worker session for this sender.");
  }
  return takeSnapshot(handle, await detectSessionStep(handle.page));
}

async function closeSession(accountId: string) {
  const handle = sessions.get(accountId);
  if (!handle) {
    return { ok: true, accountId, closed: false };
  }
  sessions.delete(accountId);
  await handle.context.close().catch(() => {});
  return { ok: true, accountId, closed: true };
}

function authorize(request: http.IncomingMessage) {
  const expected = workerToken();
  if (!expected) return true;
  const header = String(request.headers.authorization ?? "").trim();
  return header === `Bearer ${expected}`;
}

async function route(request: http.IncomingMessage, response: http.ServerResponse) {
  if (!authorize(request)) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, status: "ok", sessions: sessions.size });
    return;
  }

  const accountMatch = url.pathname.match(/^\/accounts\/([^/]+)$/);
  if (request.method === "GET" && accountMatch) {
    try {
      const snapshot = await getSessionSnapshot(decodeURIComponent(accountMatch[1]));
      sendJson(response, 200, snapshot);
    } catch (err) {
      sendJson(response, 404, { error: err instanceof Error ? err.message : "Session not found" });
    }
    return;
  }

  if (request.method === "DELETE" && accountMatch) {
    try {
      const result = await closeSession(decodeURIComponent(accountMatch[1]));
      sendJson(response, 200, result);
    } catch (err) {
      sendJson(response, 500, { error: err instanceof Error ? err.message : "Failed to close session" });
    }
    return;
  }

  const stepMatch = url.pathname.match(/^\/accounts\/([^/]+)\/step$/);
  if (request.method === "POST" && stepMatch) {
    const body = await readJsonBody(request);
    try {
      const snapshot = await advanceSession(decodeURIComponent(stepMatch[1]), {
        otp: String(body.otp ?? "").trim(),
        password: String(body.password ?? "").trim(),
        ignoreConfiguredProxy:
          body.ignoreConfiguredProxy === undefined
            ? undefined
            : Boolean(body.ignoreConfiguredProxy),
        refreshMailpoolCredentials: body.refreshMailpoolCredentials !== false,
      });
      sendJson(response, 200, snapshot);
    } catch (err) {
      sendJson(response, 500, { error: err instanceof Error ? err.message : "Failed to advance Gmail session" });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function cleanupIdleSessions() {
  const now = Date.now();
  for (const [accountId, handle] of sessions) {
    const updatedAt = new Date(handle.updatedAt).getTime();
    if (!updatedAt || now - updatedAt < IDLE_TTL_MS) continue;
    await closeSession(accountId).catch(() => {});
  }
}

async function main() {
  loadLocalEnv();
  ensureDisplayEnv();
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const server = http.createServer((request, response) => {
    void route(request, response);
  });
  server.listen(listenPort(), listenHost(), () => {
    console.log(
      JSON.stringify(
        {
          ok: true,
          service: "gmail-ui-worker-api",
          host: listenHost(),
          port: listenPort(),
        },
        null,
        2
      )
    );
  });

  setInterval(() => {
    void cleanupIdleSessions();
  }, 60_000).unref();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
