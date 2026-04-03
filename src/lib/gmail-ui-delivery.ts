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

async function fillCompose(page: any, input: { recipient: string; subject: string; body: string; expectedFrom?: string }) {
  await openCompose(page);
  await verifyFromAddress(page, input.expectedFrom ?? "");
  await dismissGmailOverlays(page, { useEscape: false });

  const toInput = page
    .locator(
      'input[aria-label="To recipients"], input[peoplekit-id], textarea[aria-label="To"], div[aria-label="To"] input'
    )
    .first();
  await toInput.waitFor({ state: "visible", timeout: 30000 });
  await toInput.fill(input.recipient);
  await page.keyboard.press("Tab");

  const subjectInput = page.locator('input[name="subjectbox"]').last();
  await subjectInput.fill(input.subject);

  const bodyInput = page.locator('div[aria-label="Message Body"], div[role="textbox"][g_editable="true"]').last();
  await bodyInput.waitFor({ state: "visible", timeout: 30000 });
  await bodyInput.click({ force: true }).catch(() => {});
  await bodyInput.fill(input.body);
}

async function sendCompose(page: any) {
  const sendButton = page
    .locator('div[role="button"][data-tooltip^="Send"], div[role="button"][aria-label*="Send"]')
    .first();
  await sendButton.waitFor({ state: "visible", timeout: 30000 });
  await sendButton.click();
  await page.locator("text=Message sent").first().waitFor({ state: "visible", timeout: 30000 });
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

  const runAttempt = async (proxy: Record<string, unknown> | null, suffix: string): Promise<GmailUiSendResult> => {
    let context: any = null;
    let page: any = null;
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
      await sendCompose(page);
      return {
        ok: true,
        providerMessageId: `gmail_ui_${Date.now().toString(36)}`,
        error: "",
      };
    } catch (error) {
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
