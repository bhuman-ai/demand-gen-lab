import { access, mkdir } from "fs/promises";
import * as path from "path";

type GmailUiSendParams = {
  userDataDir: string;
  chromeProfileDirectory?: string;
  browserChannel?: string;
  proxyUrl?: string;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
  expectedFrom?: string;
  recipient: string;
  subject: string;
  body: string;
  screenshotDir?: string;
};

type GmailUiSendResult = {
  ok: boolean;
  providerMessageId: string;
  error: string;
};

const SEND_BUTTON_SELECTOR =
  'div[role="button"][data-tooltip^="Send"], button[aria-label^="Send"], div[role="button"][aria-label^="Send"], div[role="button"][data-tooltip*="Send"], div[role="button"][aria-label*="Send"]';
const COMPOSE_OPEN_SELECTOR =
  'input[name="subjectbox"], div[aria-label="Message Body"], div[role="textbox"][g_editable="true"]';
const TO_INPUT_SELECTOR =
  'input[aria-label="To recipients"], input[peoplekit-id], textarea[aria-label="To"], div[aria-label="To"] input';
const COMPOSE_DIALOG_SELECTOR = 'div[role="dialog"]:has(input[name="subjectbox"])';
const DISCARD_DRAFT_SELECTOR =
  'img[aria-label^="Discard draft"], div[aria-label^="Discard draft"], button[aria-label^="Discard draft"]';

function isRetryableProxyFailure(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("connect tunnel failed") ||
    normalized.includes("err_tunnel_connection_failed") ||
    normalized.includes("err_proxy_connection_failed") ||
    normalized.includes("err_no_supported_proxies") ||
    normalized.includes("bandwidthlimit") ||
    normalized.includes("402 payment required") ||
    normalized.includes("proxy")
  );
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveProxyServer(params: GmailUiSendParams) {
  const host = params.proxyHost?.trim();
  const port = Number(params.proxyPort ?? 0) || 0;
  if (host && port) {
    return {
      server: `http://${host}:${port}`,
      username: params.proxyUsername?.trim() || undefined,
      password: params.proxyPassword?.trim() || undefined,
    };
  }

  const directUrl = params.proxyUrl?.trim();
  if (!directUrl) return null;
  try {
    const parsed = new URL(directUrl);
    return {
      server: `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`,
      username: parsed.username ? decodeURIComponent(parsed.username) : params.proxyUsername?.trim() || undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : params.proxyPassword?.trim() || undefined,
    };
  } catch {
    return {
      server: directUrl,
      username: params.proxyUsername?.trim() || undefined,
      password: params.proxyPassword?.trim() || undefined,
    };
  }
}

function resolveChromeExecutablePath() {
  return String(process.env.GMAIL_UI_EXECUTABLE_PATH ?? process.env.CHROME_EXECUTABLE_PATH ?? "").trim();
}

function ensureDisplayEnv() {
  if (String(process.env.DISPLAY ?? "").trim()) return;
  const configured = String(process.env.GMAIL_UI_DISPLAY ?? "").trim();
  process.env.DISPLAY = configured || ":99";
}

async function ensureGmailReady(page: any) {
  await page.goto("https://mail.google.com/mail/u/0/#inbox", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const composeSelector =
    'div[gh="cm"], [role="button"][gh="cm"], [role="button"][aria-label^="Compose"], div[role="button"]:has-text("Compose")';

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await page.locator(composeSelector).first().isVisible().catch(() => false)) {
      return;
    }

    const currentUrl = String(page.url() ?? "");
    const title = String((await page.title().catch(() => "")) ?? "");
    if (
      currentUrl.includes("accounts.google.com") ||
      currentUrl.includes("workspace.google.com") ||
      currentUrl.includes("/gmail/") ||
      title.toLowerCase().includes("sign in")
    ) {
      throw new Error("Gmail UI profile is not fully logged in. Open the mailbox in Chrome first, then retry.");
    }

    await page.waitForTimeout(3000);
    if (attempt >= 1) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    }
  }

  throw new Error("Gmail inbox is not ready. Compose button was not found.");
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
    const openDialogs = await page.locator(COMPOSE_DIALOG_SELECTOR).count().catch(() => 0);
    if (openDialogs <= 0) return;
    const discardButton = page.locator(DISCARD_DRAFT_SELECTOR).last();
    if (await discardButton.isVisible().catch(() => false)) {
      await discardButton.click().catch(() => {});
      await page.waitForTimeout(250).catch(() => {});
      continue;
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(250).catch(() => {});
  }
}

async function openCompose(page: any) {
  const compose = page
    .locator(
      'div[gh="cm"], [role="button"][gh="cm"], [role="button"][aria-label^="Compose"], div[role="button"]:has-text("Compose")'
    )
    .first();

  await compose.waitFor({ state: "visible", timeout: 30000 });
  await dismissGmailOverlays(page);

  try {
    await compose.click({ timeout: 5000 });
  } catch {
    await compose.click({ force: true });
  }

  const subject = page.locator('input[name="subjectbox"]').last();
  if (!(await subject.isVisible().catch(() => false))) {
    await page.keyboard.press("c").catch(() => {});
  }
  await subject.waitFor({ state: "visible", timeout: 30000 });
}

async function verifyFromAddress(page: any, expectedFrom: string) {
  if (!expectedFrom.trim()) return;
  const fromInput = page.locator('input[aria-label*="From"], input[name="from"]').last();
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
  const dialog = page.locator(COMPOSE_DIALOG_SELECTOR).last();
  if ((await dialog.count().catch(() => 0)) > 0) {
    return dialog;
  }
  return page.locator("body");
}

async function readSelectedRecipientEmails(composeRoot: any) {
  const values = await composeRoot
    .evaluate((root: HTMLElement) => {
      const emails = new Set<string>();
      const addEmails = (raw: string | null) => {
        if (!raw) return;
        const matches = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
        for (const match of matches) emails.add(match.toLowerCase());
      };

      root.querySelectorAll("[email], [data-hovercard-id], [aria-label], [title]").forEach((element) => {
        addEmails(element.getAttribute("email"));
        addEmails(element.getAttribute("data-hovercard-id"));
        addEmails(element.getAttribute("aria-label"));
        addEmails(element.getAttribute("title"));
        addEmails(element.textContent);
      });

      return Array.from(emails);
    })
    .catch(() => []);
  return Array.isArray(values) ? values.map((value) => normalizeEmail(String(value))) : [];
}

async function hasSelectedRecipient(composeRoot: any, recipient: string) {
  const normalizedRecipient = normalizeEmail(recipient);
  if (!normalizedRecipient) return false;
  const selectedEmails = await readSelectedRecipientEmails(composeRoot);
  return selectedEmails.includes(normalizedRecipient);
}

async function fillToRecipient(page: any, recipient: string) {
  const composeRoot = await latestComposeRoot(page);
  if (await hasSelectedRecipient(composeRoot, recipient)) {
    return;
  }

  const toInput = composeRoot.locator(TO_INPUT_SELECTOR).last();
  const selectedDescription = String((await toInput.getAttribute("aria-description").catch(() => "")) ?? "");
  if (selectedDescription.toLowerCase().includes("selected")) {
    const selectedEmails = await readSelectedRecipientEmails(composeRoot);
    if (!selectedEmails.length || selectedEmails.includes(normalizeEmail(recipient))) {
      return;
    }
    throw new Error(`Compose window already has a different recipient selected: ${selectedEmails.join(", ")}`);
  }

  await toInput.waitFor({ state: "visible", timeout: 30000 });
  await toInput.fill(recipient);
  await page.keyboard.press("Tab").catch(() => {});
}

async function fillCompose(page: any, input: { recipient: string; subject: string; body: string; expectedFrom?: string }) {
  await closeOpenComposeWindows(page);
  await openCompose(page);
  await verifyFromAddress(page, input.expectedFrom ?? "");
  await dismissGmailOverlays(page, { useEscape: false });

  await fillToRecipient(page, input.recipient);

  const subjectInput = page.locator('input[name="subjectbox"]').last();
  await subjectInput.fill(input.subject);

  const bodyInput = page.locator('div[aria-label="Message Body"], div[role="textbox"][g_editable="true"]').last();
  await bodyInput.waitFor({ state: "visible", timeout: 30000 });
  await bodyInput.click({ force: true }).catch(() => {});
  await bodyInput.fill(input.body);
}

async function isComposeStillOpen(page: any) {
  return page.locator(COMPOSE_OPEN_SELECTOR).last().isVisible().catch(() => false);
}

async function visibleGmailSendError(page: any) {
  const candidates = [
    'div[role="alert"]',
    'div[aria-live="assertive"]',
    'span:has-text("Please specify at least one recipient")',
    'span:has-text("Address not found")',
    'span:has-text("Invalid")',
    'span:has-text("Message not sent")',
  ];
  for (const selector of candidates) {
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

function isSuccessfulGmailSendStatus(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    normalized === "message sent" ||
    normalized.startsWith("message sent ") ||
    (normalized.includes("message sent") &&
      (normalized.includes("undo") || normalized.includes("view message")))
  );
}

async function waitForSendConfirmation(page: any) {
  const toast = page.locator("text=Message sent").first();
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (await toast.isVisible().catch(() => false)) {
      return;
    }
    if (!(await isComposeStillOpen(page))) {
      return;
    }
    await dismissGmailOverlays(page, { useEscape: false });
    const sendError = await visibleGmailSendError(page);
    if (sendError) {
      if (isSuccessfulGmailSendStatus(sendError)) {
        return;
      }
      if (isIgnorableGmailSendPrompt(sendError)) {
        await dismissGmailOverlays(page, { useEscape: false });
        await page.waitForTimeout(500).catch(() => {});
        continue;
      }
      throw new Error(`Gmail did not send the draft: ${sendError}`);
    }
    await page.waitForTimeout(1000).catch(() => {});
  }

  if (!(await isComposeStillOpen(page))) {
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

async function sendCompose(page: any, onSendAttempt?: () => void) {
  await dismissGmailOverlays(page, { useEscape: false });
  const sendButton = page.locator(SEND_BUTTON_SELECTOR).first();
  const sendVisible = await sendButton.isVisible().catch(() => false);
  if (sendVisible) {
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
        await page.keyboard.press("Control+Enter");
        onSendAttempt?.();
      }
    }
  } else {
    await page.keyboard.press("Control+Enter");
    onSendAttempt?.();
  }
  await waitForSendConfirmation(page);
}

export async function validateGmailUiMailboxConfig(input: {
  userDataDir: string;
  browserChannel?: string;
}) {
  const userDataDir = input.userDataDir.trim();
  if (!userDataDir) {
    return { ok: false, message: "Gmail UI user data dir is missing" };
  }
  if (!(await pathExists(userDataDir))) {
    return { ok: false, message: `Gmail UI user data dir does not exist: ${userDataDir}` };
  }
  return {
    ok: true,
    message: `Gmail UI profile ready at ${userDataDir}${input.browserChannel ? ` via ${input.browserChannel}` : ""}`,
  };
}

export async function sendGmailUiMessage(params: GmailUiSendParams): Promise<GmailUiSendResult> {
  if (process.env.VERCEL) {
    return {
      ok: false,
      providerMessageId: "",
      error: "Gmail UI delivery is only available in the local operator runtime.",
    };
  }

  const userDataDir = params.userDataDir.trim();
  if (!userDataDir) {
    return { ok: false, providerMessageId: "", error: "Gmail UI user data dir is missing" };
  }
  if (!(await pathExists(userDataDir))) {
    return {
      ok: false,
      providerMessageId: "",
      error: `Gmail UI user data dir does not exist: ${userDataDir}`,
    };
  }

  const screenshotDir =
    params.screenshotDir?.trim() || path.join(process.cwd(), "output", "playwright", "gmail-ui-send");
  await mkdir(screenshotDir, { recursive: true });
  ensureDisplayEnv();

  const playwright = await import("@playwright/test");
  const chromium = (playwright as any).chromium;
  const executablePath = resolveChromeExecutablePath();
  const configuredProxy = resolveProxyServer(params);

  const runAttempt = async (
    proxy: Record<string, unknown> | null,
    suffix: string,
    allowReopen = true
  ): Promise<GmailUiSendResult> => {
    let context: any = null;
    let page: any = null;
    let sendAttempted = false;
    try {
      const launchOptions: Record<string, unknown> = {
        headless: false,
        viewport: { width: 1440, height: 980 },
        args: params.chromeProfileDirectory?.trim()
          ? [`--profile-directory=${params.chromeProfileDirectory.trim()}`]
          : [],
        proxy: proxy ?? undefined,
      };
      if (executablePath) {
        launchOptions.executablePath = executablePath;
      } else {
        launchOptions.channel = params.browserChannel?.trim() || "chrome";
      }
      context = await chromium.launchPersistentContext(userDataDir, launchOptions);
      page = context.pages()[0] ?? (await context.newPage());
      await ensureGmailReady(page);
      await fillCompose(page, {
        recipient: params.recipient.trim(),
        subject: params.subject.trim(),
        body: params.body.trim(),
        expectedFrom: params.expectedFrom?.trim() || "",
      });
      await sendCompose(page, () => {
        sendAttempted = true;
      });
      return {
        ok: true,
        providerMessageId: `gmail_ui_${Date.now().toString(36)}`,
        error: "",
      };
    } catch (error) {
      if (allowReopen && !sendAttempted && isPageClosedError(error)) {
        await context?.close().catch(() => {});
        context = null;
        return runAttempt(proxy, `${suffix}-reopened`, false);
      }
      const failurePath = path.join(screenshotDir, `gmail-ui-failure-${suffix}-${Date.now()}.png`);
      await page?.screenshot({ path: failurePath, fullPage: true }).catch(() => {});
      return {
        ok: false,
        providerMessageId: "",
        error: `${error instanceof Error ? error.message : String(error)}${page ? ` | screenshot: ${failurePath}` : ""}`,
      };
    } finally {
      await context?.close().catch(() => {});
    }
  };

  const firstAttempt = await runAttempt(configuredProxy, configuredProxy ? "proxy" : "direct");
  if (firstAttempt.ok || !configuredProxy || !isRetryableProxyFailure(firstAttempt.error)) {
    return firstAttempt;
  }

  const fallbackAttempt = await runAttempt(null, "direct-fallback");
  if (fallbackAttempt.ok) {
    return fallbackAttempt;
  }

  return {
    ok: false,
    providerMessageId: "",
    error: `${firstAttempt.error} | fallback_without_proxy_failed: ${fallbackAttempt.error}`,
  };
}
