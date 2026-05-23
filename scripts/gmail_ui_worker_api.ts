/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFile as execFileCallback } from "child_process";
import { mkdir, rm } from "fs/promises";
import fs from "fs";
import http from "http";
import path from "path";
import { chromium } from "playwright";
import { promisify } from "util";
import { runBuyShazamCommentLikesPurchase } from "@/lib/buyshazam-ui-purchase";

type SessionStep =
  | "opening"
  | "account_picker"
  | "confirm_identity"
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
  started: boolean;
};

type AdvanceInput = {
  otp?: string;
  password?: string;
  ignoreConfiguredProxy?: boolean;
  refreshMailpoolCredentials?: boolean;
  proxyRotationAttempted?: boolean;
};

type SendInput = AdvanceInput & {
  recipient?: string;
  subject?: string;
  body?: string;
  expectedFrom?: string;
};

type SendResult = {
  ok: boolean;
  accountId: string;
  fromEmail: string;
  providerMessageId: string;
  error: string;
  sentVerified?: boolean;
  sentVerification?: SentVerificationResult;
  screenshotPath: string;
  currentUrl: string;
  title: string;
  updatedAt: string;
};

type MailboxSearchInput = AdvanceInput & {
  query?: string;
};

type MailboxSearchResult = {
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

type SentVerificationInput = AdvanceInput & {
  recipient?: string;
  subject?: string;
  body?: string;
};

type SentVerificationResult = {
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

type SentVerificationResponse = {
  ok: boolean;
  accountId: string;
  fromEmail: string;
  verification: SentVerificationResult;
  screenshotPath: string;
  currentUrl: string;
  title: string;
  updatedAt: string;
};

type ExpectedSentMessage = {
  recipient: string;
  subject: string;
  body: string;
};

type AccountBundle = {
  account: any;
  secrets: any;
  gmailUiPassword: string;
  gmailUiAuthCode: string;
};

const sessions = new Map<string, SessionHandle>();
const SCREENSHOT_DIR = path.join(process.cwd(), "output", "playwright", "gmail-ui-worker");
const IDLE_TTL_MS = 15 * 60 * 1000;
const COMPOSE_SELECTOR =
  'div[gh="cm"], [role="button"][gh="cm"], [role="button"][aria-label^="Compose"], div[role="button"]:has-text("Compose")';
const SEND_BUTTON_SELECTOR =
  'div[role="button"][data-tooltip^="Send"], button[aria-label^="Send"], div[role="button"][aria-label^="Send"], div[role="button"][data-tooltip*="Send"], div[role="button"][aria-label*="Send"], button:has-text("Send"), div[role="button"]:has-text("Send")';
const DOM_SEND_BUTTON_SELECTOR =
  '[data-tooltip^="Send"], button[aria-label^="Send"], [aria-label^="Send"], [data-tooltip*="Send"]';
const COMPOSE_OPEN_SELECTOR =
  'input[name="subjectbox"], div[aria-label="Message Body"], div[role="textbox"][g_editable="true"]';
const TO_INPUT_SELECTOR =
  'input[aria-label="To recipients"], input[peoplekit-id], textarea[aria-label="To"], div[aria-label="To"] input';
const INBOX_SHELL_SELECTOR = [
  '[role="main"]',
  '[role="navigation"]',
  '[aria-label*="Inbox"]',
  '[aria-label*="Mail"]',
  'input[aria-label*="Search in mail"]',
  'input[placeholder="Search mail"]',
].join(", ");
const COMPOSE_DIALOG_SELECTOR = 'div[role="dialog"]:has(input[name="subjectbox"])';
const COMPOSE_SUBJECT_SELECTOR = 'input[name="subjectbox"]';
const COMPOSE_BODY_SELECTOR = 'div[aria-label="Message Body"], div[role="textbox"][g_editable="true"]';
const COMPOSE_RECIPIENT_SELECTOR = [
  TO_INPUT_SELECTOR,
  'input[aria-label*="Recipients"]',
  'textarea[aria-label*="Recipients"]',
  'input[placeholder*="Recipients"]',
].join(", ");
const DOM_COMPOSE_RECIPIENT_SELECTOR = [
  'input[aria-label="To recipients"]',
  'input[peoplekit-id]',
  'textarea[aria-label="To"]',
  'div[aria-label="To"] input',
  'input[aria-label*="Recipients"]',
  'textarea[aria-label*="Recipients"]',
  'input[placeholder*="Recipients"]',
].join(", ");
const COMPOSE_ROOT_MARKER = "data-lastb2b-compose-root";
const DISCARD_DRAFT_SELECTOR =
  'img[aria-label^="Discard draft"], div[aria-label^="Discard draft"], button[aria-label^="Discard draft"]';
const OTP_FIELD_SELECTORS = [
  'input[autocomplete="one-time-code"]',
  'input[name="totpPin"]',
  'input[type="tel"]',
  'input[inputmode="numeric"]',
  'input[aria-label*="code" i]',
];
const execFile = promisify(execFileCallback);

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

async function lastVisible(root: any, selector: string) {
  const locator = root.locator(selector);
  const count = await locator.count().catch(() => 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }
  return null;
}

function interactionContexts(page: any) {
  const frames = typeof page.frames === "function" ? page.frames() : [];
  return [page, ...frames];
}

async function settlePage(page: any) {
  await page.waitForTimeout(1200).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
}

function looksLikeGoogleSessionUrl(currentUrl: string) {
  return (
    currentUrl.startsWith("https://mail.google.com/") ||
    currentUrl.startsWith("https://accounts.google.com/") ||
    currentUrl.startsWith("https://workspace.google.com/")
  );
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listProfileProcessIds(userDataDir: string) {
  try {
    const { stdout } = await execFile("pgrep", ["-f", "--", `--user-data-dir=${userDataDir}`]);
    return stdout
      .split(/\s+/)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);
  } catch (error: any) {
    if (error?.code === 1) {
      return [];
    }
    throw error;
  }
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function releaseProfileLock(userDataDir: string) {
  const pids = await listProfileProcessIds(userDataDir);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const remaining = pids.filter((pid) => isPidAlive(pid));
    if (!remaining.length) break;
    await sleep(300);
    if (attempt === 9) {
      for (const pid of remaining) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
  }

  for (const lockName of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    await rm(path.join(userDataDir, lockName), { force: true }).catch(() => {});
  }
}

async function moveToGoogleLogin(page: any) {
  const currentUrl = String(page.url() ?? "");
  const title = String((await page.title().catch(() => "")) ?? "");
  const bodyText = String((await page.locator("body").innerText().catch(() => "")) ?? "").toLowerCase();
  const looksLikeMarketingPage =
    currentUrl.includes("workspace.google.com/intl/") ||
    title.toLowerCase().includes("secure, ai-powered email for everyone") ||
    (currentUrl.includes("workspace.google.com") && bodyText.includes("sign in"));
  if (!looksLikeMarketingPage) {
    return false;
  }

  await page
    .goto(
      "https://accounts.google.com/ServiceLogin?service=mail&continue=https%3A%2F%2Fmail.google.com%2Fmail%2Fu%2F0%2F%23inbox",
      {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      }
    )
    .catch(() => {});
  await settlePage(page);
  return true;
}

async function detectSessionStep(page: any): Promise<Omit<SessionSnapshot, "ok" | "accountId" | "fromEmail" | "updatedAt" | "screenshotPath">> {
  const currentUrl = String(page.url() ?? "");
  const title = String((await page.title().catch(() => "")) ?? "");
  const titleLower = title.toLowerCase();
  const bodyText = String((await page.locator("body").innerText().catch(() => "")) ?? "").toLowerCase();
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

  const inboxShellVisible =
    currentUrl.includes("mail.google.com/mail/") &&
    !currentUrl.includes("accounts.google.com") &&
    !currentUrl.startsWith("chrome-error://") &&
    titleLower.includes("mail") &&
    (
      /#(inbox|all|starred|snoozed|sent|drafts|spam|trash|label|search|settings)/i.test(currentUrl) ||
      currentUrl.includes("tf=cm") ||
      currentUrl.includes("fs=1") ||
      titleLower.includes("compose mail") ||
      bodyText.includes("inbox") ||
      bodyText.includes("compose") ||
      bodyText.includes("search in mail") ||
      bodyText.includes("search mail") ||
      Boolean(
        await firstVisible(page, [
          INBOX_SHELL_SELECTOR,
          '[aria-label*="Inbox"]',
          'a[title*="Inbox"]',
          '[role="main"]',
          '[aria-label*="Mail"]',
        ])
      )
    );
  if (inboxShellVisible) {
    return {
      step: "ready",
      prompt: "Gmail inbox shell is open. This sender profile is logged in.",
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

  const googleAccountNotFound =
    bodyText.includes("couldn’t find your google account") ||
    bodyText.includes("couldn't find your google account") ||
    bodyText.includes("could not find your google account");
  if (googleAccountNotFound) {
    return {
      step: "error",
      prompt: "Google could not find this sender account. The mailbox is not a usable Google login yet.",
      currentUrl,
      title,
      loginState: "error",
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

  const nextVisible = await firstVisible(page, [
    '#identifierNext button',
    '#passwordNext button',
    'button:has-text("Next")',
    'div[role="button"]:has-text("Next")',
  ]);
  const confirmIdentityPrompt =
    currentUrl.includes("/signin/confirmidentifier") ||
    bodyText.includes("verify it’s you") ||
    bodyText.includes("verify it's you") ||
    bodyText.includes("please sign in again to continue to gmail");
  if (nextVisible && confirmIdentityPrompt) {
    return {
      step: "confirm_identity",
      prompt: "Google wants a confirmation click before continuing sign-in.",
      currentUrl,
      title,
      loginState: "login_required",
    };
  }

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

  const googleRejectedBrowser =
    currentUrl.includes("/signin/rejected") ||
    titleLower.includes("couldn") ||
    bodyText.includes("this browser or app may not be secure") ||
    bodyText.includes("try using a different browser");
  if (googleRejectedBrowser) {
    return {
      step: "error",
      prompt:
        "Google rejected this Gmail UI browser as insecure during sign-in. The worker needs a hardened browser launch or a manually bootstrapped profile for this sender.",
      currentUrl,
      title,
      loginState: "error",
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

async function waitForStepAfterSubmit(
  page: any,
  previousStep: SessionStep
): Promise<Omit<SessionSnapshot, "ok" | "accountId" | "fromEmail" | "updatedAt" | "screenshotPath">> {
  let latest = await detectSessionStep(page);
  if (latest.step !== previousStep || latest.loginState === "ready") {
    return latest;
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.waitForTimeout(900).catch(() => {});
    latest = await detectSessionStep(page);
    if (latest.step !== previousStep || latest.loginState === "ready") {
      return latest;
    }
  }

  return latest;
}

async function fillVisibleField(page: any, selectors: string[], value: string) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.click().catch(() => {});
    await locator.fill("").catch(() => {});
    await locator.fill(value).catch(() => {});

    let currentValue = String((await locator.inputValue().catch(() => "")) ?? "");
    if (currentValue.trim() !== value.trim()) {
      await locator.press("Meta+A").catch(() => {});
      await locator.press("Control+A").catch(() => {});
      await locator.pressSequentially(value, { delay: 35 }).catch(() => {});
      currentValue = String((await locator.inputValue().catch(() => "")) ?? "");
    }

    if (currentValue.trim() !== value.trim()) {
      const handle = await locator.elementHandle().catch(() => null);
      if (handle) {
        await page
          .evaluate(
            ({ element, nextValue }: { element: HTMLInputElement | HTMLTextAreaElement | null; nextValue: string }) => {
              const input = element as HTMLInputElement | HTMLTextAreaElement | null;
              if (!input) return;
              input.focus();
              input.value = nextValue;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
            },
            { element: handle, nextValue: value }
          )
          .catch(() => {});
        currentValue = String((await locator.inputValue().catch(() => "")) ?? "");
      }
    }

    await settlePage(page);
    if (currentValue.trim() === value.trim()) {
      return true;
    }
  }
  return false;
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

async function dismissGmailOverlays(page: any, options: { useEscape?: boolean } = {}) {
  if (options.useEscape !== false) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(250).catch(() => {});
  }

  const dismissCandidates = [
    'button:has-text("Got it")',
    'button:has-text("Not now")',
    'button:has-text("No thanks")',
    'div[role="button"]:has-text("No thanks")',
    "text=No thanks",
    "text=OK",
    'button:has-text("Done")',
    'button:has-text("Close")',
    'div[role="button"][aria-label="Close"]',
    'button[aria-label="Close"]',
  ];

  for (const selector of dismissCandidates) {
    const candidate = page.locator(selector).first();
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click().catch(() => {});
      await page.waitForTimeout(250).catch(() => {});
    }
  }
}

async function closeOpenComposeWindows(page: any) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const composeCount = await countVisibleComposeSubjects(page);
    if (composeCount <= 0) return;
    const composeRoot = await latestComposeRoot(page).catch(() => null);
    if (!composeRoot) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(250).catch(() => {});
      continue;
    }
    const discardButton = composeRoot.locator(DISCARD_DRAFT_SELECTOR).last();
    if (await discardButton.isVisible().catch(() => false)) {
      await discardButton.click().catch(() => {});
      await page.waitForTimeout(250).catch(() => {});
      continue;
    }
    const bodyInput = composeRoot.locator(COMPOSE_BODY_SELECTOR).last();
    await bodyInput.click({ force: true }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(250).catch(() => {});
  }
}

async function countVisibleComposeSubjects(page: any) {
  const subjects = page.locator(COMPOSE_SUBJECT_SELECTOR);
  const count = await subjects.count().catch(() => 0);
  let visible = 0;
  for (let index = 0; index < count; index += 1) {
    if (await subjects.nth(index).isVisible().catch(() => false)) {
      visible += 1;
    }
  }
  return visible;
}

async function markLatestComposeRoot(page: any) {
  const subjects = page.locator(COMPOSE_SUBJECT_SELECTOR);
  const count = await subjects.count().catch(() => 0);
  await page
    .evaluate((marker: string) => {
      document.querySelectorAll(`[${marker}]`).forEach((element) => element.removeAttribute(marker));
    }, COMPOSE_ROOT_MARKER)
    .catch(() => {});

  for (let index = count - 1; index >= 0; index -= 1) {
    const subject = subjects.nth(index);
    if (!(await subject.isVisible().catch(() => false))) continue;
    const marked = await subject
      .evaluate(
        (
          input: HTMLElement,
          {
            marker,
            sendSelector,
            bodySelector,
            recipientSelector,
          }: { marker: string; sendSelector: string; bodySelector: string; recipientSelector: string }
        ) => {
          let fallback: HTMLElement | null = input.parentElement;
          for (let current = input.parentElement; current; current = current.parentElement) {
            const hasSend = Boolean(current.querySelector(sendSelector));
            const hasBody = Boolean(current.querySelector(bodySelector));
            const hasRecipient = Boolean(current.querySelector(recipientSelector));
            if (!fallback && (hasBody || hasSend)) {
              fallback = current;
            }
            if (hasSend && hasBody) {
              current.setAttribute(marker, "true");
              return true;
            }
            if (current.getAttribute("role") === "dialog" && (hasSend || hasBody || hasRecipient)) {
              current.setAttribute(marker, "true");
              return true;
            }
          }
          const target = fallback ?? input;
          target.setAttribute(marker, "true");
          return true;
        },
        {
          marker: COMPOSE_ROOT_MARKER,
          sendSelector: DOM_SEND_BUTTON_SELECTOR,
          bodySelector: COMPOSE_BODY_SELECTOR,
          recipientSelector: DOM_COMPOSE_RECIPIENT_SELECTOR,
        }
      )
      .catch(() => false);
    if (marked) {
      return page.locator(`[${COMPOSE_ROOT_MARKER}="true"]`).last();
    }
  }

  return null;
}

async function openCompose(page: any) {
  const compose = page.locator(COMPOSE_SELECTOR).first();
  const initialCount = await countVisibleComposeSubjects(page);

  await compose.waitFor({ state: "visible", timeout: 30000 });
  await dismissGmailOverlays(page);

  try {
    await compose.click({ timeout: 5000 });
  } catch {
    await compose.click({ force: true });
  }

  await page
    .waitForFunction(
      (
        { subjectSelector, expectedCount }: { subjectSelector: string; expectedCount: number }
      ) => {
        const isVisible = (element: Element) => {
          const node = element as HTMLElement;
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        };
        return Array.from(document.querySelectorAll(subjectSelector)).filter(isVisible).length > expectedCount;
      },
      { subjectSelector: COMPOSE_SUBJECT_SELECTOR, expectedCount: initialCount },
      { timeout: 3000 }
    )
    .catch(() => {});

  let composeRoot = await latestComposeRoot(page);
  let subject = composeRoot.locator(COMPOSE_SUBJECT_SELECTOR).last();
  if (!(await subject.isVisible().catch(() => false))) {
    await page.keyboard.press("c").catch(() => {});
    composeRoot = await latestComposeRoot(page);
    subject = composeRoot.locator(COMPOSE_SUBJECT_SELECTOR).last();
  }
  await subject.waitFor({ state: "visible", timeout: 30000 });
  return composeRoot;
}

async function openPrefilledCompose(
  page: any,
  input: { recipient: string; subject: string; body: string }
) {
  const composeUrls = [
    `https://mail.google.com/mail/u/0/?${new URLSearchParams({
      view: "cm",
      fs: "1",
      tf: "1",
      to: input.recipient,
      su: input.subject,
      body: input.body,
    }).toString()}`,
  ];

  for (const url of composeUrls) {
    await page
      .goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      })
      .catch(() => {});
    await settlePage(page);
    await page
      .waitForFunction(
        (
          {
            sendSelector,
          }: { sendSelector: string }
        ) => {
          const isVisible = (element: Element | null) => {
            if (!element) return false;
            const node = element as HTMLElement;
            const style = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
          };
          return isVisible(document.querySelector(sendSelector));
        },
        {
          sendSelector: DOM_SEND_BUTTON_SELECTOR,
        },
        { timeout: 8000 }
      )
      .catch(() => {});

    const composeRoot = await latestComposeRoot(page).catch(() => null);
    if (composeRoot) {
      const subjectInput = composeRoot.locator(COMPOSE_SUBJECT_SELECTOR).last();
      if (await subjectInput.isVisible().catch(() => false)) {
        return composeRoot;
      }
    }

    const currentUrl = String(page.url() ?? "");
    if (currentUrl.startsWith("chrome-error://")) {
      continue;
    }

    const title = String((await page.title().catch(() => "")) ?? "");
    const isComposeMailPage =
      currentUrl.includes("fs=1") ||
      currentUrl.includes("tf=cm") ||
      title.toLowerCase().includes("compose mail");
    if (isComposeMailPage) {
      return page.locator("body");
    }
  }

  return null;
}

async function verifyFromAddress(composeRoot: any, expectedFrom: string) {
  if (!expectedFrom.trim()) return;
  const fromInput = composeRoot.locator('input[aria-label*="From"], input[name="from"]').last();
  if (await fromInput.isVisible().catch(() => false)) {
    const current = String((await fromInput.inputValue().catch(() => "")) ?? "").trim().toLowerCase();
    if (current && current !== expectedFrom.trim().toLowerCase()) {
      throw new Error(`Compose window from-address mismatch. Expected ${expectedFrom}, got ${current}`);
    }
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

async function latestComposeRoot(page: any) {
  const composeRoot = await markLatestComposeRoot(page);
  if (composeRoot) {
    return composeRoot;
  }
  throw new Error("Gmail compose root could not be resolved.");
}

async function readSelectedRecipientEmails(composeRoot: any) {
  const values = await composeRoot
    .evaluate((root: HTMLElement, { bodySelector, subjectSelector }: { bodySelector: string; subjectSelector: string }) => {
      const emails = new Set<string>();
      const addEmails = (raw: string | null) => {
        if (!raw) return;
        const matches = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
        for (const match of matches) emails.add(match.toLowerCase());
      };

      const clone = root.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(bodySelector).forEach((element) => element.remove());
      clone.querySelectorAll(subjectSelector).forEach((element) => element.remove());

      clone.querySelectorAll("[email], [data-hovercard-id], [aria-label], [title]").forEach((element) => {
        addEmails(element.getAttribute("email"));
        addEmails(element.getAttribute("data-hovercard-id"));
        addEmails(element.getAttribute("aria-label"));
        addEmails(element.getAttribute("title"));
        addEmails(element.textContent);
      });

      return Array.from(emails);
    }, { bodySelector: COMPOSE_BODY_SELECTOR, subjectSelector: COMPOSE_SUBJECT_SELECTOR })
    .catch(() => []);
  return Array.isArray(values) ? values.map((value) => normalizeEmail(String(value))) : [];
}

async function hasSelectedRecipient(composeRoot: any, recipient: string) {
  const normalizedRecipient = normalizeEmail(recipient);
  if (!normalizedRecipient) return false;
  const selectedEmails = await readSelectedRecipientEmails(composeRoot);
  return selectedEmails.includes(normalizedRecipient);
}

async function resolveRecipientInput(composeRoot: any, page: any) {
  let toInput = composeRoot.locator(COMPOSE_RECIPIENT_SELECTOR).last();
  if (await toInput.isVisible().catch(() => false)) {
    return toInput;
  }

  const recipientLabel = composeRoot.locator('text=/^Recipients$|^To$/').first();
  if (await recipientLabel.isVisible().catch(() => false)) {
    await recipientLabel.click({ force: true }).catch(() => {});
    await page.waitForTimeout(250).catch(() => {});
  }

  toInput = composeRoot.locator(COMPOSE_RECIPIENT_SELECTOR).last();
  return toInput;
}

async function fillToRecipient(composeRoot: any, page: any, recipient: string) {
  if (await hasSelectedRecipient(composeRoot, recipient)) {
    return;
  }

  const toInput = await resolveRecipientInput(composeRoot, page);
  const selectedDescription = String((await toInput.getAttribute("aria-description").catch(() => "")) ?? "");
  if (selectedDescription.toLowerCase().includes("selected")) {
    const selectedEmails = await readSelectedRecipientEmails(composeRoot);
    if (!selectedEmails.length || selectedEmails.includes(normalizeEmail(recipient))) {
      return;
    }
    throw new Error(`Compose window already has a different recipient selected: ${selectedEmails.join(", ")}`);
  }

  await toInput.waitFor({ state: "visible", timeout: 30000 });
  await toInput.click({ force: true }).catch(() => {});
  await page.waitForTimeout(150).catch(() => {});
  await toInput.press("Meta+A").catch(() => {});
  await toInput.press("Control+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await toInput.pressSequentially(recipient, { delay: 25 }).catch(() => {});
  await page.keyboard.press("Enter").catch(() => {});
  await page.waitForTimeout(250).catch(() => {});
  if (await hasSelectedRecipient(composeRoot, recipient)) {
    return;
  }
  await page.keyboard.press("Tab").catch(() => {});
  await page.waitForTimeout(150).catch(() => {});
  if (await hasSelectedRecipient(composeRoot, recipient)) {
    return;
  }
  await toInput.click({ force: true }).catch(() => {});
  await toInput.fill("").catch(() => {});
  await toInput.fill(recipient).catch(() => {});
  await page.keyboard.press("Enter").catch(() => {});
  await page.keyboard.press("Tab").catch(() => {});
  await page.waitForTimeout(250).catch(() => {});
  if (!(await hasSelectedRecipient(composeRoot, recipient))) {
    throw new Error(`Gmail did not keep the recipient chip for ${recipient}.`);
  }
}

async function fillCompose(page: any, input: { recipient: string; subject: string; body: string; expectedFrom?: string }) {
  await closeOpenComposeWindows(page);
  let composeRoot = await openPrefilledCompose(page, input).catch(() => null);
  const recipientPrefilled = Boolean(composeRoot);
  if (!composeRoot) {
    composeRoot = await openCompose(page);
  }
  await verifyFromAddress(composeRoot, input.expectedFrom ?? "");
  await dismissGmailOverlays(page, { useEscape: false });

  if (!recipientPrefilled) {
    await fillToRecipient(composeRoot, page, input.recipient);
    const subjectInput = composeRoot.locator(COMPOSE_SUBJECT_SELECTOR).last();
    await subjectInput.fill(input.subject);

    const bodyInput = composeRoot.locator(COMPOSE_BODY_SELECTOR).last();
    await bodyInput.waitFor({ state: "visible", timeout: 30000 });
    await bodyInput.click({ force: true }).catch(() => {});
    await bodyInput.fill(input.body);
  }
  return composeRoot;
}

async function isComposeStillOpen(composeRoot: any) {
  return composeRoot.isVisible().catch(() => false);
}

async function visibleGmailSendError(composeRoot: any, page: any) {
  const candidates = [
    'div[role="alert"]',
    'div[aria-live="assertive"]',
    'span:has-text("Please specify at least one recipient")',
    'span:has-text("Address not found")',
    'span:has-text("Invalid")',
    'span:has-text("Message not sent")',
  ];
  for (const selector of candidates) {
    const locator = composeRoot.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      const text = String((await locator.innerText().catch(() => "")) ?? "").trim();
      if (text) return text;
    }
  }
  const globalCandidates = [
    'div[role="dialog"]:has-text("Please specify at least one recipient")',
    'div[role="alertdialog"]:has-text("Please specify at least one recipient")',
    'div[role="alert"]:has-text("Message not sent")',
    'div[aria-live="assertive"]:has-text("Message not sent")',
    'text=/Enable desktop notifications/i',
  ];
  for (const selector of globalCandidates) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      const text = String((await locator.innerText().catch(() => "")) ?? "").trim();
      if (text) return text;
    }
  }
  return "";
}

function isIgnorableGmailSendPrompt(text: string) {
  return text.toLowerCase().includes("enable desktop notifications");
}

function isTransientGmailSendStatus(text: string) {
  const normalized = text.toLowerCase();
  return (
    normalized === "sending..." ||
    normalized === "sending" ||
    normalized.startsWith("sending...") ||
    normalized.startsWith("sending ")
  );
}

function isSuccessfulGmailSendStatus(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    normalized === "message sent" ||
    normalized.startsWith("message sent ") ||
    (normalized.includes("message sent") &&
      (normalized.includes("undo") || normalized.includes("view message")))
  );
}

async function isFullScreenComposePage(page: any) {
  const title = String((await page.title().catch(() => "")) ?? "").toLowerCase();
  const currentUrl = String(page.url() ?? "");
  return currentUrl.includes("tf=cm") || currentUrl.includes("fs=1") || title.includes("compose mail");
}

async function resolvePrimarySendButton(page: any, composeRoot: any) {
  const contexts = [composeRoot, ...interactionContexts(page)];
  for (const context of contexts) {
    if (!context || typeof context.locator !== "function") continue;
    const candidates = [
      context.locator('button[aria-label^="Send"]').last(),
      context.locator('div[role="button"][aria-label^="Send"]').last(),
      typeof context.getByRole === "function"
        ? context.getByRole("button", { name: /^Send(?:\b| )/ }).last()
        : null,
      context.locator('button:has-text("Send")').last(),
      context.locator('div[role="button"]:has-text("Send")').last(),
      context.locator(SEND_BUTTON_SELECTOR).last(),
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }
  }

  return null;
}

async function describeVisibleSendControls(page: any, composeRoot: any) {
  const contexts = [composeRoot, ...interactionContexts(page)];
  const results: string[] = [];
  for (const context of contexts) {
    if (!context || typeof context.evaluate !== "function") continue;
    const controls = await context
      .evaluate((root: HTMLElement) => {
        const describeRoot = () => {
          const win = root.ownerDocument.defaultView;
          const frame = win?.frameElement as HTMLElement | null;
          if (!frame) return "main";
          const title = frame.getAttribute("title") ?? "";
          const name = frame.getAttribute("name") ?? "";
          const aria = frame.getAttribute("aria-label") ?? "";
          return `frame:${title || name || aria || "unnamed"}`;
        };
        const isVisible = (element: Element) => {
          const node = element as HTMLElement;
          const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };

      return Array.from(root.querySelectorAll('button, [role="button"]'))
        .filter((element) => isVisible(element))
        .map((element) => {
          const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
          const ariaLabel = (element.getAttribute("aria-label") ?? "").trim();
          const tooltip = (element.getAttribute("data-tooltip") ?? "").trim();
          const disabled =
            element.getAttribute("aria-disabled") === "true" ||
            (element as HTMLButtonElement).disabled === true;
          const rect = (element as HTMLElement).getBoundingClientRect();
          return {
            root: describeRoot(),
            tag: element.tagName.toLowerCase(),
            text,
            ariaLabel,
            tooltip,
            disabled,
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          };
        })
        .filter((entry) => {
          const haystack = `${entry.text} ${entry.ariaLabel} ${entry.tooltip}`.toLowerCase();
          return haystack.includes("send");
        })
        .slice(-8);
      })
      .catch(() => []);
    if (Array.isArray(controls) && controls.length) {
      results.push(...controls.map((entry) => JSON.stringify(entry)));
    }
  }
  return `[${results.join(",")}]`;
}

async function waitForFullScreenComposeReady(page: any, composeRoot: any) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const sendButton = await resolvePrimarySendButton(page, composeRoot);
    if (sendButton && (await sendButton.isVisible().catch(() => false))) {
      return sendButton;
    }
    await dismissGmailOverlays(page, { useEscape: false });
    await page.waitForTimeout(500).catch(() => {});
  }
  return null;
}

async function clickFullScreenComposeSend(page: any) {
  const viewport = page.viewportSize?.() ?? { width: 1440, height: 980 };
  const targetX = Math.round(Math.max(140, Math.min(180, viewport.width * 0.105)));
  const targetY = Math.round(Math.max(120, viewport.height - 38));
  await page.mouse.click(targetX, targetY).catch(() => {});
}

async function triggerFullScreenComposeSend(page: any) {
  await clickFullScreenComposeSend(page);
  await page.waitForTimeout(300).catch(() => {});
  await page.keyboard.press("Alt+KeyS").catch(() => {});
  await page.waitForTimeout(300).catch(() => {});
  await page.keyboard.press("Control+Enter").catch(() => {});
  await page.keyboard.press("Meta+Enter").catch(() => {});
}

async function describeLocator(locator: any) {
  const details = await locator
    .evaluate((element: Element) => {
      const node = element as HTMLElement;
      const rect = node.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
        ariaLabel: (element.getAttribute("aria-label") ?? "").trim(),
        tooltip: (element.getAttribute("data-tooltip") ?? "").trim(),
        role: (element.getAttribute("role") ?? "").trim(),
        disabled:
          element.getAttribute("aria-disabled") === "true" ||
          (element as HTMLButtonElement).disabled === true,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    })
    .catch(() => null);
  return JSON.stringify(details);
}

function gmailSearchPhrase(value: string) {
  return value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function normalizeVisibleText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildSentSearchQuery(expected: ExpectedSentMessage | undefined) {
  const recipient = String(expected?.recipient ?? "").trim().toLowerCase();
  if (!recipient) return "";
  const phrase = gmailSearchPhrase(expected?.body ?? "") || gmailSearchPhrase(expected?.subject ?? "");
  if (!phrase) return "";
  return `in:sent to:${recipient} "${phrase}"`;
}

function excerptAround(text: string, needles: string[], maxLength = 1200) {
  const clean = normalizeVisibleText(text);
  if (clean.length <= maxLength) return clean;
  const lower = clean.toLowerCase();
  const matchIndex = needles
    .map((needle) => lower.indexOf(needle.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (matchIndex === undefined) {
    return `${clean.slice(0, maxLength)}...`;
  }
  const start = Math.max(0, matchIndex - Math.floor(maxLength / 3));
  const end = Math.min(clean.length, start + maxLength);
  return `${start > 0 ? "..." : ""}${clean.slice(start, end)}${end < clean.length ? "..." : ""}`;
}

async function runGmailSearch(page: any, query: string, stopWhen?: (bodyText: string) => boolean) {
  await page
    .goto(`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query.trim())}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    .catch(() => {});
  await settlePage(page);

  let bodyText = "";
  for (let attempt = 0; attempt < 24; attempt += 1) {
    bodyText = normalizeVisibleText(String((await page.locator("body").innerText().catch(() => "")) ?? ""));
    if (bodyText && (stopWhen?.(bodyText) || attempt >= 2)) break;
    await page.waitForTimeout(1000).catch(() => {});
  }
  return {
    bodyText,
    currentUrl: String(page.url() ?? "").trim(),
    title: String((await page.title().catch(() => "")) ?? ""),
  };
}

async function verifyMessageInSentDetailed(
  page: any,
  expected: ExpectedSentMessage | undefined
): Promise<SentVerificationResult> {
  const query = buildSentSearchQuery(expected);
  const checkedAt = new Date().toISOString();
  if (!query || !expected) {
    return {
      verified: false,
      query,
      reason: "recipient and either body or subject are required",
      recipientMatched: false,
      subjectMatched: false,
      phraseMatched: false,
      bodyExcerpt: "",
      currentUrl: String(page.url() ?? "").trim(),
      title: String((await page.title().catch(() => "")) ?? ""),
      checkedAt,
    };
  }

  const recipient = expected.recipient.toLowerCase();
  const subject = gmailSearchPhrase(expected.subject).toLowerCase();
  const phrase = (gmailSearchPhrase(expected.body) || gmailSearchPhrase(expected.subject)).toLowerCase();
  const search = await runGmailSearch(page, query, (bodyText) => {
    const lowerText = bodyText.toLowerCase();
    return (
      lowerText.includes("no messages matched your search") ||
      lowerText.includes("no conversations matched your search") ||
      lowerText.includes("no results found") ||
      (lowerText.includes(recipient) && (lowerText.includes(phrase) || lowerText.includes(subject)))
    );
  });
  const lowerText = search.bodyText.toLowerCase();
  const recipientMatched = lowerText.includes(recipient);
  const subjectMatched = subject ? lowerText.includes(subject) : false;
  const phraseMatched = phrase ? lowerText.includes(phrase) : false;
  const noMessages =
    lowerText.includes("no messages matched your search") ||
    lowerText.includes("no conversations matched your search") ||
    lowerText.includes("no results found");
  const verified = !noMessages && recipientMatched && (phraseMatched || subjectMatched);

  return {
    verified,
    query,
    reason: verified
      ? "matching message found in Sent Mail"
      : noMessages
        ? "Gmail reported no Sent Mail results for the expected message"
        : "Sent Mail search did not show the expected recipient and message phrase",
    recipientMatched,
    subjectMatched,
    phraseMatched,
    bodyExcerpt: excerptAround(search.bodyText, [recipient, phrase, subject].filter(Boolean), 1200),
    currentUrl: search.currentUrl,
    title: search.title,
    checkedAt,
  };
}

async function verifyMessageInSent(page: any, expected: ExpectedSentMessage | undefined) {
  return (await verifyMessageInSentDetailed(page, expected)).verified;
}

async function waitForSendConfirmation(
  page: any,
  composeRoot: any,
  expectedSent?: ExpectedSentMessage
) {
  const startedOnFullScreenCompose = await isFullScreenComposePage(page);
  const toast = page.locator("text=Message sent").first();
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (await toast.isVisible().catch(() => false)) {
      return;
    }
    if (startedOnFullScreenCompose) {
      if (!(await isFullScreenComposePage(page))) {
        return;
      }
    } else if (!(await isComposeStillOpen(composeRoot))) {
      return;
    }
    await dismissGmailOverlays(page, { useEscape: false });
    const sendError = await visibleGmailSendError(composeRoot, page);
    if (sendError) {
      if (isSuccessfulGmailSendStatus(sendError)) {
        return;
      }
      if (isIgnorableGmailSendPrompt(sendError)) {
        await dismissGmailOverlays(page, { useEscape: false });
        await page.waitForTimeout(500).catch(() => {});
        continue;
      }
      if (isTransientGmailSendStatus(sendError)) {
        await page.waitForTimeout(500).catch(() => {});
        continue;
      }
      throw new Error(`Gmail did not send the draft: ${sendError}`);
    }
    await page.waitForTimeout(1000).catch(() => {});
  }

  if (startedOnFullScreenCompose) {
    if (!(await isFullScreenComposePage(page))) {
      return;
    }
    const activeSendButton = await resolvePrimarySendButton(page, composeRoot);
    if (!activeSendButton) {
      return;
    }
    if (await verifyMessageInSent(page, expectedSent)) {
      return;
    }
    const sendControls = await describeVisibleSendControls(page, composeRoot);
    throw new Error(
      `Gmail send confirmation did not appear and the compose window is still open. visibleSendControls=${sendControls}`
    );
  } else if (!(await isComposeStillOpen(composeRoot))) {
    return;
  }
  throw new Error("Gmail send confirmation did not appear and the compose window is still open.");
}

function isPageClosedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("Target page, context or browser has been closed") ||
    message.includes("page, context or browser has been closed") ||
    message.includes("Browser has been closed") ||
    message.includes("Target closed")
  );
}

async function sendCompose(
  page: any,
  composeRoot: any,
  expectedSent: ExpectedSentMessage,
  onSendAttempt?: () => void
) {
  await dismissGmailOverlays(page, { useEscape: false });
  const fullScreenCompose = await isFullScreenComposePage(page);
  const sendButton = fullScreenCompose
    ? await waitForFullScreenComposeReady(page, composeRoot)
    : await resolvePrimarySendButton(page, composeRoot);
  const sendButtonMeta = sendButton ? await describeLocator(sendButton) : "null";
  if (sendButton) {
    try {
      await sendButton.click({ timeout: 5000 });
      onSendAttempt?.();
    } catch (error) {
      if (isPageClosedError(error)) throw error;
      await dismissGmailOverlays(page, { useEscape: false });
      try {
        await sendButton.click({ force: true, timeout: 5000 });
        onSendAttempt?.();
      } catch (forceClickError) {
        if (isPageClosedError(forceClickError)) throw forceClickError;
        try {
          await sendButton.evaluate((node: HTMLElement) => node.click());
          onSendAttempt?.();
        } catch (domClickError) {
          if (isPageClosedError(domClickError)) throw domClickError;
          if (fullScreenCompose) {
            await triggerFullScreenComposeSend(page);
          } else {
            await page.keyboard.press("Control+Enter");
          }
          onSendAttempt?.();
        }
      }
    }
  } else {
    if (fullScreenCompose) {
      await triggerFullScreenComposeSend(page);
    } else {
      await page.keyboard.press("Control+Enter");
    }
    onSendAttempt?.();
  }
  try {
    await waitForSendConfirmation(page, composeRoot, expectedSent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} resolvedSendButton=${sendButtonMeta}`);
  }
}

async function loadAccountBundle(accountId: string, refreshMailpoolCredentials = true): Promise<AccountBundle> {
  const {
    getOutreachAccount,
    getOutreachAccountSecrets,
  } = await import("@/lib/outreach-data");
  const { syncMailpoolOutreachAccountCredentials } = await import("@/lib/mailpool-account-refresh");
  const { getOutreachProvisioningSettingsSecrets } = await import("@/lib/outreach-provider-settings");
  const { getMailpoolMailbox } = await import("@/lib/mailpool-client");

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

  let gmailUiPassword = String(secrets.mailboxPassword ?? "").trim();
  let gmailUiAuthCode = String(secrets.mailboxAuthCode || secrets.mailboxAdminAuthCode || "").trim();
  if (account.provider === "mailpool" && account.config.mailpool.mailboxId.trim()) {
    try {
      const providerSecrets = await getOutreachProvisioningSettingsSecrets();
      const apiKey = String(providerSecrets.mailpoolApiKey ?? "").trim();
      if (apiKey) {
        const mailbox = await getMailpoolMailbox(apiKey, account.config.mailpool.mailboxId.trim());
        gmailUiPassword = String(mailbox.password ?? gmailUiPassword).trim() || gmailUiPassword;
        gmailUiAuthCode =
          String(mailbox.authCode ?? "").trim() ||
          String(mailbox.admin?.authCode ?? "").trim() ||
          gmailUiAuthCode;
      }
    } catch {}
  }

  return { account, secrets, gmailUiPassword, gmailUiAuthCode };
}

async function resolveGmailUiAuthCode(input: {
  accountId: string;
  requestedOtp?: string;
  fallbackOtp?: string;
}) {
  const requestedOtp = String(input.requestedOtp ?? "").trim();
  if (requestedOtp) return requestedOtp;

  const bundle = await loadAccountBundle(input.accountId, true).catch(() => null);
  return (
    String(bundle?.gmailUiAuthCode ?? "").trim() ||
    String(bundle?.secrets?.mailboxAuthCode ?? "").trim() ||
    String(bundle?.secrets?.mailboxAdminAuthCode ?? "").trim() ||
    String(input.fallbackOtp ?? "").trim()
  );
}

async function waitForFreshGmailUiAuthCode(input: {
  accountId: string;
  previousOtp: string;
  fallbackOtp?: string;
}) {
  const previousOtp = String(input.previousOtp ?? "").trim();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(4000);
    const otp = await resolveGmailUiAuthCode({
      accountId: input.accountId,
      fallbackOtp: input.fallbackOtp,
    });
    if (otp && otp !== previousOtp) {
      return otp;
    }
  }
  return "";
}

async function ensureGmailUiDeliveryAccount(account: any) {
  const { updateOutreachAccount } = await import("@/lib/outreach-data");
  const { normalizeGmailUiLoginStatus } = await import("@/lib/gmail-ui-login");
  const { getOutreachAccountFromEmail } = await import("@/lib/outreach-account-helpers");
  const { resolveGmailUiUserDataDir } = await import("@/lib/gmail-ui-profile");
  const { ensureRequiredWebshareProxy } = await import("@/lib/webshare-proxy-assignment");

  const deliveryMethod = String(account.config.mailbox.deliveryMethod ?? "").trim();
  const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
  const isEligibleMailpoolGoogleSender =
    account.provider === "mailpool" &&
    account.accountType !== "mailbox" &&
    String(account.config.mailpool.mailboxType ?? "").trim().toLowerCase() === "google" &&
    Boolean(fromEmail);

  const mailpoolStatus = String(account.config.mailpool.status ?? "").trim().toLowerCase();
  if (isEligibleMailpoolGoogleSender && mailpoolStatus && mailpoolStatus !== "active") {
    throw new Error(`Mailpool sender ${fromEmail} is ${mailpoolStatus}, so Gmail UI login is blocked until Mailpool reports it active.`);
  }

  if (!isEligibleMailpoolGoogleSender && deliveryMethod !== "gmail_ui") {
    return account;
  }

  const existingUserDataDir = String(account.config.mailbox.gmailUiUserDataDir ?? "").trim();
  const { userDataDir, rehomedProfile } = resolveGmailUiUserDataDir({
    profileRoot: String(process.env.GMAIL_UI_PROFILE_ROOT ?? "").trim(),
    existingUserDataDir,
    email: fromEmail,
  });
  if (!userDataDir) {
    throw new Error(`gmailUiUserDataDir missing for ${account.id}.`);
  }

  const needsPromotion = deliveryMethod !== "gmail_ui";
  const missingProfile = !existingUserDataDir;
  if (!needsPromotion && !rehomedProfile && !missingProfile) {
    return ensureRequiredWebshareProxy(account);
  }

  const loginStatus = normalizeGmailUiLoginStatus({
    deliveryMethod: "gmail_ui",
    state: account.config.mailbox.gmailUiLoginState,
    checkedAt: account.config.mailbox.gmailUiLoginCheckedAt,
    message: account.config.mailbox.gmailUiLoginMessage,
    forceLoginRequired: needsPromotion || rehomedProfile || missingProfile,
  });

  const updated = await updateOutreachAccount(account.id, {
    config: {
      mailbox: {
        provider: "gmail",
        deliveryMethod: "gmail_ui",
        email: fromEmail,
        status: account.config.mailpool.status === "active" ? "connected" : "disconnected",
        gmailUiUserDataDir: userDataDir,
        gmailUiProfileDirectory: String(account.config.mailbox.gmailUiProfileDirectory ?? "").trim(),
        gmailUiBrowserChannel:
          String(account.config.mailbox.gmailUiBrowserChannel ?? "chrome").trim() || "chrome",
        gmailUiLoginState: loginStatus.gmailUiLoginState,
        gmailUiLoginCheckedAt: loginStatus.gmailUiLoginCheckedAt,
        gmailUiLoginMessage: loginStatus.gmailUiLoginMessage,
      },
    },
  });

  return ensureRequiredWebshareProxy(updated ?? account);
}

async function getOrCreateSession(accountId: string, input: AdvanceInput) {
  const existing = sessions.get(accountId);
  if (existing && !existing.page.isClosed()) {
    return existing;
  }

  const bundle = await loadAccountBundle(accountId, input.refreshMailpoolCredentials !== false);
  const { getOutreachAccountFromEmail } = await import("@/lib/outreach-account-helpers");
  const { resolveGmailUiUserDataDir } = await import("@/lib/gmail-ui-profile");
  const account = await ensureGmailUiDeliveryAccount(bundle.account);

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
  const profileDirectory = String(account.config.mailbox.gmailUiProfileDirectory ?? "").trim();
  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    ...(profileDirectory ? [`--profile-directory=${profileDirectory}`] : []),
  ];
  const launchOptions = {
    ...(executablePath
      ? { executablePath }
      : { channel: account.config.mailbox.gmailUiBrowserChannel || "chrome" }),
    headless: false,
    viewport: { width: 1440, height: 980 },
    args: launchArgs,
    ignoreDefaultArgs: ["--enable-automation"],
    proxy,
  };
  let context: any;
  try {
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("ProcessSingleton")) {
      throw error;
    }
    await releaseProfileLock(userDataDir);
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  }
  await context
    .addInitScript(() => {
      try {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
      } catch {}
    })
    .catch(() => {});
  const page = context.pages()[0] ?? (await context.newPage());
  const handle: SessionHandle = {
    accountId: account.id,
    fromEmail: getOutreachAccountFromEmail(account).trim().toLowerCase(),
    userDataDir,
    context,
    page,
    updatedAt: new Date().toISOString(),
    screenshotPath: "",
    started: false,
  };
  sessions.set(accountId, handle);
  return handle;
}

async function rotateProxyAndRestartSession(accountId: string, input: AdvanceInput) {
  const { getOutreachAccount } = await import("@/lib/outreach-data");
  const { rotateRequiredWebshareProxy } = await import("@/lib/webshare-proxy-assignment");
  const account = await getOutreachAccount(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} was not found for proxy rotation.`);
  }
  await closeSession(accountId);
  await rotateRequiredWebshareProxy(account);
  return getOrCreateSession(accountId, {
    ...input,
    proxyRotationAttempted: true,
  });
}

async function advanceSession(accountId: string, input: AdvanceInput = {}) {
  let handle = await getOrCreateSession(accountId, input);
  const { secrets, gmailUiPassword, gmailUiAuthCode } = await loadAccountBundle(
    accountId,
    input.refreshMailpoolCredentials !== false
  );

  const currentUrl = String(handle.page.url() ?? "").trim();
  if (!handle.started || !currentUrl || currentUrl === "about:blank" || !looksLikeGoogleSessionUrl(currentUrl)) {
    await handle.page.goto("https://mail.google.com/mail/u/0/#inbox", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    }).catch(() => {});
    await settlePage(handle.page);
    handle.started = true;
  }
  if (
    String(handle.page.url() ?? "").startsWith("chrome-error://") &&
    !input.ignoreConfiguredProxy &&
    !input.proxyRotationAttempted
  ) {
    try {
      handle = await rotateProxyAndRestartSession(accountId, input);
      await handle.page.goto("https://mail.google.com/mail/u/0/#inbox", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      }).catch(() => {});
      await settlePage(handle.page);
      handle.started = true;
    } catch (error) {
      return takeSnapshot(handle, {
        step: "error",
        prompt: `Gmail failed to load through configured proxy, and proxy rotation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        currentUrl: String(handle.page.url() ?? ""),
        title: String((await handle.page.title().catch(() => "")) ?? ""),
        loginState: "error",
      });
    }
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await moveToGoogleLogin(handle.page)) {
      continue;
    }
    const detected = await detectSessionStep(handle.page);
    if (
      detected.currentUrl.startsWith("chrome-error://") &&
      !input.ignoreConfiguredProxy &&
      !input.proxyRotationAttempted
    ) {
      try {
        handle = await rotateProxyAndRestartSession(accountId, input);
        await handle.page.goto("https://mail.google.com/mail/u/0/#inbox", {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        }).catch(() => {});
        await settlePage(handle.page);
        handle.started = true;
        continue;
      } catch (error) {
        return takeSnapshot(handle, {
          step: "error",
          prompt: `Gmail failed to load through configured proxy, and proxy rotation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          currentUrl: detected.currentUrl,
          title: detected.title,
          loginState: "error",
        });
      }
    }

    if (detected.step === "account_picker") {
      const clicked = await clickUseAnotherAccount(handle.page);
      if (clicked) continue;
    }

    if (detected.step === "confirm_identity") {
      await clickNext(handle.page);
      continue;
    }

    if (detected.step === "awaiting_email" && handle.fromEmail) {
      const filled = await fillVisibleField(handle.page, ['input[type="email"]', 'input[name="identifier"]'], handle.fromEmail);
      if (filled) {
        await clickNext(handle.page);
        continue;
      }
    }

    if (detected.step === "awaiting_password") {
      const password = String(input.password ?? "").trim() || gmailUiPassword || secrets.mailboxPassword.trim();
      if (password) {
        const filled = await fillVisibleField(handle.page, ['input[type="password"]', 'input[name="Passwd"]'], password);
        if (filled) {
          await clickNext(handle.page);
          const afterPassword = await waitForStepAfterSubmit(handle.page, "awaiting_password");
          if (afterPassword.loginState === "ready") {
            return takeSnapshot(handle, afterPassword);
          }
          if (afterPassword.step !== "awaiting_password" && afterPassword.step !== "error") {
            continue;
          }
          return takeSnapshot(handle, afterPassword);
        }
      }
    }

    if (detected.step === "awaiting_otp") {
      let lastOtpSnapshot = detected;
      let attemptedOtp = "";
      for (let otpAttempt = 0; otpAttempt < 2; otpAttempt += 1) {
        const otp =
          otpAttempt === 0
            ? await resolveGmailUiAuthCode({
                accountId,
                requestedOtp: input.otp,
                fallbackOtp: gmailUiAuthCode || secrets.mailboxAuthCode.trim(),
              })
            : await waitForFreshGmailUiAuthCode({
                accountId,
                previousOtp: attemptedOtp,
                fallbackOtp: gmailUiAuthCode || secrets.mailboxAuthCode.trim(),
              });
        if (!otp || otp === attemptedOtp) {
          break;
        }
        attemptedOtp = otp;
        const filled = await fillVisibleField(handle.page, OTP_FIELD_SELECTORS, otp);
        if (filled) {
          await clickNext(handle.page);
          const afterOtp = await waitForStepAfterSubmit(handle.page, "awaiting_otp");
          lastOtpSnapshot = afterOtp;
          if (afterOtp.step === "awaiting_otp" && !String(input.otp ?? "").trim() && otpAttempt === 0) {
            continue;
          }
          return takeSnapshot(
            handle,
            afterOtp.step === "awaiting_otp"
              ? {
                  ...afterOtp,
                  prompt: "Google is still asking for the 6-digit code after trying the latest Mailpool code.",
                }
              : afterOtp
          );
        }
      }
      return takeSnapshot(
        handle,
        lastOtpSnapshot.step === "awaiting_otp"
          ? {
              ...lastOtpSnapshot,
              prompt: "Google is asking for the one-time code, but no fresh Mailpool code could be applied.",
            }
          : lastOtpSnapshot
      );
    }

    return takeSnapshot(handle, detected);
  }

  return takeSnapshot(handle, await detectSessionStep(handle.page));
}

async function ensureSessionReadyForSend(accountId: string, input: AdvanceInput = {}) {
  let snapshot = await advanceSession(accountId, input);
  if (snapshot.loginState === "ready") {
    return snapshot;
  }

  for (let attempt = 0; attempt < 7; attempt += 1) {
    await sleep(snapshot.step === "awaiting_otp" ? 1200 : 400);
    snapshot = await advanceSession(accountId, input);
    if (snapshot.loginState === "ready") {
      return snapshot;
    }
    if (snapshot.step === "error") {
      break;
    }
  }

  throw new Error(snapshot.prompt || "Gmail UI login is still required on the worker.");
}

async function navigateSessionToInbox(handle: SessionHandle | null) {
  if (!handle || handle.page.isClosed()) return;
  await handle.page
    .goto("https://mail.google.com/mail/u/0/#inbox", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    .catch(() => {});
  await settlePage(handle.page);
}

async function ensureReadySession(accountId: string, input: AdvanceInput = {}) {
  await navigateSessionToInbox(sessions.get(accountId) ?? null);
  await ensureSessionReadyForSend(accountId, input);
  const handle = sessions.get(accountId) ?? null;
  if (!handle || handle.page.isClosed()) {
    throw new Error("No active Gmail worker session for this sender.");
  }
  const detected = await detectSessionStep(handle.page);
  if (detected.loginState !== "ready") {
    throw new Error(detected.prompt || "Gmail inbox is not ready on the worker.");
  }
  return handle;
}

async function captureSessionPage(handle: SessionHandle, label: string) {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(
    SCREENSHOT_DIR,
    `${handle.accountId}-${label}-${Date.now().toString(36)}.png`
  );
  await handle.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  handle.updatedAt = new Date().toISOString();
  handle.screenshotPath = screenshotPath;
  return {
    screenshotPath,
    currentUrl: String(handle.page.url() ?? "").trim(),
    title: String((await handle.page.title().catch(() => "")) ?? ""),
    updatedAt: handle.updatedAt,
  };
}

async function searchMailbox(accountId: string, input: MailboxSearchInput = {}): Promise<MailboxSearchResult> {
  const query = String(input.query ?? "").trim();
  if (!query) throw new Error("query is required.");
  const handle = await ensureReadySession(accountId, input);
  const search = await runGmailSearch(handle.page, query);
  const page = await captureSessionPage(handle, "search");
  return {
    ok: true,
    accountId: handle.accountId,
    fromEmail: handle.fromEmail,
    query,
    bodyExcerpt: excerptAround(search.bodyText, [query], 3000),
    screenshotPath: page.screenshotPath,
    currentUrl: page.currentUrl,
    title: page.title,
    updatedAt: page.updatedAt,
  };
}

async function verifySentMessage(
  accountId: string,
  input: SentVerificationInput = {}
): Promise<SentVerificationResponse> {
  const recipient = String(input.recipient ?? "").trim().toLowerCase();
  const subject = String(input.subject ?? "").trim();
  const body = String(input.body ?? "").trim();
  if (!recipient || (!subject && !body)) {
    throw new Error("recipient and either subject or body are required.");
  }

  const handle = await ensureReadySession(accountId, input);
  const verification = await verifyMessageInSentDetailed(handle.page, {
    recipient,
    subject,
    body,
  });
  const page = await captureSessionPage(handle, verification.verified ? "sent-verified" : "sent-unverified");
  return {
    ok: true,
    accountId: handle.accountId,
    fromEmail: handle.fromEmail,
    verification,
    screenshotPath: page.screenshotPath,
    currentUrl: page.currentUrl,
    title: page.title,
    updatedAt: page.updatedAt,
  };
}

async function sendMessage(accountId: string, input: SendInput = {}): Promise<SendResult> {
  const recipient = String(input.recipient ?? "").trim().toLowerCase();
  const subject = String(input.subject ?? "").trim();
  const body = String(input.body ?? "").trim();
  const expectedFrom = String(input.expectedFrom ?? "").trim().toLowerCase();
  if (!recipient || !subject || !body) {
    throw new Error("Recipient, subject, and body are required.");
  }

  let lastHandle: SessionHandle | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let sendAttempted = false;
    let handle: SessionHandle | null = null;

    try {
      handle = await ensureReadySession(accountId, input);
      lastHandle = handle;

      await navigateSessionToInbox(handle);

      const detected = await detectSessionStep(handle.page);
      if (detected.loginState !== "ready") {
        throw new Error(detected.prompt || "Gmail inbox is not ready on the worker.");
      }

      const composeRoot = await fillCompose(handle.page, {
        recipient,
        subject,
        body,
        expectedFrom,
      });
      await sendCompose(
        handle.page,
        composeRoot,
        { recipient, subject, body },
        () => {
          sendAttempted = true;
        }
      );

      const sentVerification = await verifyMessageInSentDetailed(handle.page, { recipient, subject, body });
      if (!sentVerification.verified) {
        const page = await captureSessionPage(handle, "send-unverified");
        return {
          ok: false,
          accountId: handle.accountId,
          fromEmail: handle.fromEmail,
          providerMessageId: "",
          error: `Gmail UI send was not verified in Sent Mail for ${recipient}: ${sentVerification.reason}`,
          sentVerified: false,
          sentVerification,
          screenshotPath: page.screenshotPath,
          currentUrl: page.currentUrl,
          title: page.title,
          updatedAt: page.updatedAt,
        };
      }

      await navigateSessionToInbox(handle);
      const page = await captureSessionPage(handle, "send");

      return {
        ok: true,
        accountId: handle.accountId,
        fromEmail: handle.fromEmail,
        providerMessageId: `gmail_ui_${Date.now().toString(36)}`,
        error: "",
        sentVerified: true,
        sentVerification,
        screenshotPath: page.screenshotPath,
        currentUrl: page.currentUrl,
        title: page.title,
        updatedAt: page.updatedAt,
      };
    } catch (error) {
      if (attempt === 0 && !sendAttempted && isPageClosedError(error)) {
        await closeSession(accountId).catch(() => {});
        continue;
      }

      const failedHandle = handle ?? lastHandle;
      if (!failedHandle) {
        throw error;
      }
      const page = await captureSessionPage(failedHandle, "send-failure");

      return {
        ok: false,
        accountId: failedHandle.accountId,
        fromEmail: failedHandle.fromEmail,
        providerMessageId: "",
        error: error instanceof Error ? error.message : "Failed to send Gmail UI message on the worker.",
        sentVerified: false,
        screenshotPath: page.screenshotPath,
        currentUrl: page.currentUrl,
        title: page.title,
        updatedAt: page.updatedAt,
      };
    }
  }

  throw new Error(
    lastHandle
      ? "Gmail UI send failed after reopening a closed browser session."
      : "Gmail UI send failed before a browser session was created."
  );
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

  if (request.method === "POST" && url.pathname === "/buyshazam/purchase") {
    const body = await readJsonBody(request);
    try {
      const result = await runBuyShazamCommentLikesPurchase({
        productUrl: String(body.productUrl ?? "").trim(),
        commentUrl: String(body.commentUrl ?? "").trim(),
      });
      sendJson(response, 200, result as unknown as Record<string, unknown>);
    } catch (err) {
      sendJson(response, 500, { error: err instanceof Error ? err.message : "Failed to run BuyShazam purchase" });
    }
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

  const searchMatch = url.pathname.match(/^\/accounts\/([^/]+)\/search$/);
  if (request.method === "POST" && searchMatch) {
    const body = await readJsonBody(request);
    try {
      const result = await searchMailbox(decodeURIComponent(searchMatch[1]), {
        query: String(body.query ?? "").trim(),
        otp: String(body.otp ?? "").trim(),
        password: String(body.password ?? "").trim(),
        ignoreConfiguredProxy:
          body.ignoreConfiguredProxy === undefined
            ? undefined
            : Boolean(body.ignoreConfiguredProxy),
        refreshMailpoolCredentials: body.refreshMailpoolCredentials !== false,
      });
      sendJson(response, 200, result as unknown as Record<string, unknown>);
    } catch (err) {
      sendJson(response, 500, { error: err instanceof Error ? err.message : "Failed to search Gmail UI mailbox" });
    }
    return;
  }

  const sentVerifyMatch = url.pathname.match(/^\/accounts\/([^/]+)\/sent\/verify$/);
  if (request.method === "POST" && sentVerifyMatch) {
    const body = await readJsonBody(request);
    try {
      const result = await verifySentMessage(decodeURIComponent(sentVerifyMatch[1]), {
        recipient: String(body.recipient ?? "").trim(),
        subject: String(body.subject ?? "").trim(),
        body: String(body.body ?? "").trim(),
        otp: String(body.otp ?? "").trim(),
        password: String(body.password ?? "").trim(),
        ignoreConfiguredProxy:
          body.ignoreConfiguredProxy === undefined
            ? undefined
            : Boolean(body.ignoreConfiguredProxy),
        refreshMailpoolCredentials: body.refreshMailpoolCredentials !== false,
      });
      sendJson(response, 200, result as unknown as Record<string, unknown>);
    } catch (err) {
      sendJson(response, 500, { error: err instanceof Error ? err.message : "Failed to verify Gmail UI sent mail" });
    }
    return;
  }

  const sendMatch = url.pathname.match(/^\/accounts\/([^/]+)\/send$/);
  if (request.method === "POST" && sendMatch) {
    const body = await readJsonBody(request);
    try {
      const result = await sendMessage(decodeURIComponent(sendMatch[1]), {
        recipient: String(body.recipient ?? "").trim(),
        subject: String(body.subject ?? "").trim(),
        body: String(body.body ?? "").trim(),
        expectedFrom: String(body.expectedFrom ?? "").trim(),
        otp: String(body.otp ?? "").trim(),
        password: String(body.password ?? "").trim(),
        ignoreConfiguredProxy:
          body.ignoreConfiguredProxy === undefined
            ? undefined
            : Boolean(body.ignoreConfiguredProxy),
        refreshMailpoolCredentials: body.refreshMailpoolCredentials !== false,
      });
      sendJson(response, 200, result);
    } catch (err) {
      sendJson(response, 500, { error: err instanceof Error ? err.message : "Failed to send Gmail UI message" });
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
