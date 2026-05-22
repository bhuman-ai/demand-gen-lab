import { mkdir, readFile } from "fs/promises";
import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";

type CliOptions = {
  csvPath: string;
  profileDir: string;
  userDataDir: string;
  chromeProfileDirectory: string;
  limit: number;
  send: boolean;
  expectedFrom: string;
  pauseMs: number;
  startAt: number;
  subjectColumn: string;
  bodyColumn: string;
  emailColumn: string;
  screenshotDir: string;
  browserChannel: string;
  browserPath: string;
  proxyUrl: string;
  proxyHost: string;
  proxyPort: number;
  proxyUsername: string;
  proxyPassword: string;
};

type SendRow = {
  lineNumber: number;
  email: string;
  subject: string;
  body: string;
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

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  const take = (flag: string, fallback = "") => {
    const index = args.indexOf(flag);
    if (index === -1) return fallback;
    const value = args[index + 1] ?? "";
    args.splice(index, 2);
    return value;
  };
  const has = (flag: string) => {
    const index = args.indexOf(flag);
    if (index === -1) return false;
    args.splice(index, 1);
    return true;
  };

  const csvPath = take("--csv");
  if (!csvPath) {
    throw new Error("Missing --csv <path>");
  }

  const profileDir =
    take("--profile-dir") || path.join(process.cwd(), "data", "gmail-ui-profile", "default");
  const userDataDir = take("--user-data-dir") || profileDir;
  const chromeProfileDirectory = take("--chrome-profile-directory");
  const screenshotDir =
    take("--screenshot-dir") || path.join(process.cwd(), "output", "playwright", "gmail-ui-send");

  return {
    csvPath: path.resolve(csvPath),
    profileDir: path.resolve(profileDir),
    userDataDir: path.resolve(userDataDir),
    chromeProfileDirectory: chromeProfileDirectory.trim(),
    limit: Math.max(1, Number(take("--limit", "1")) || 1),
    send: has("--send"),
    expectedFrom: take("--expected-from"),
    pauseMs: Math.max(0, Number(take("--pause-ms", "45000")) || 45000),
    startAt: Math.max(0, Number(take("--start-at", "0")) || 0),
    subjectColumn: take("--subject-col", "subject"),
    bodyColumn: take("--body-col", "body"),
    emailColumn: take("--email-col", "email"),
    screenshotDir: path.resolve(screenshotDir),
    browserChannel: take("--browser-channel", "chrome"),
    browserPath: take("--browser-path"),
    proxyUrl: take("--proxy-url"),
    proxyHost: take("--proxy-host"),
    proxyPort: Math.max(0, Number(take("--proxy-port", "0")) || 0),
    proxyUsername: take("--proxy-username"),
    proxyPassword: take("--proxy-password"),
  };
}

function resolveChromeExecutablePath(options: CliOptions) {
  return (
    options.browserPath.trim() ||
    String(process.env.GMAIL_UI_EXECUTABLE_PATH ?? process.env.CHROME_EXECUTABLE_PATH ?? "").trim()
  );
}

function resolveProxy(options: CliOptions) {
  if (options.proxyHost.trim() && options.proxyPort) {
    return {
      server: `http://${options.proxyHost.trim()}:${options.proxyPort}`,
      username: options.proxyUsername.trim() || undefined,
      password: options.proxyPassword.trim() || undefined,
    };
  }
  if (!options.proxyUrl.trim()) return undefined;
  try {
    const parsed = new URL(options.proxyUrl.trim());
    return {
      server: `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`,
      username: parsed.username ? decodeURIComponent(parsed.username) : options.proxyUsername.trim() || undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : options.proxyPassword.trim() || undefined,
    };
  } catch {
    return {
      server: options.proxyUrl.trim(),
      username: options.proxyUsername.trim() || undefined,
      password: options.proxyPassword.trim() || undefined,
    };
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\r") {
      continue;
    }
    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((candidate) => candidate.length > 1 || candidate[0]?.trim());
}

async function loadRows(options: CliOptions): Promise<SendRow[]> {
  const raw = await readFile(options.csvPath, "utf8");
  const csv = parseCsv(raw);
  const header = csv[0] ?? [];
  const subjectIndex = header.indexOf(options.subjectColumn);
  const bodyIndex = header.indexOf(options.bodyColumn);
  const emailIndex = header.indexOf(options.emailColumn);

  if (emailIndex === -1 || subjectIndex === -1 || bodyIndex === -1) {
    throw new Error(
      `CSV must include columns ${options.emailColumn}, ${options.subjectColumn}, ${options.bodyColumn}`
    );
  }

  return csv
    .slice(1)
    .map((row, index) => ({
      lineNumber: index + 2,
      email: String(row[emailIndex] ?? "").trim(),
      subject: String(row[subjectIndex] ?? "").trim(),
      body: String(row[bodyIndex] ?? "").replace(/\r\n/g, "\n").trim(),
    }))
    .filter((row) => row.email && row.subject && row.body);
}

async function promptEnter(question: string) {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(question);
  } finally {
    rl.close();
  }
}

async function ensureGmailReady(page: Page) {
  await page.goto("https://mail.google.com/mail/u/0/#inbox", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const composeLocator = () =>
    page.locator('div[gh="cm"], [role="button"][gh="cm"], [role="button"][aria-label^="Compose"], div[role="button"]:has-text("Compose")').first();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const composeVisible = await page
      .locator('div[gh="cm"], [role="button"][gh="cm"], [role="button"][aria-label^="Compose"], div[role="button"]:has-text("Compose")')
      .first()
      .isVisible()
      .catch(() => false);
    if (composeVisible) return;

    const signInPage = page.url().includes("accounts.google.com");
    if (signInPage) {
      await promptEnter(
        "Complete Gmail login in the browser window for the sending mailbox, then press Enter here to continue."
      );
      await page.goto("https://mail.google.com/mail/u/0/#inbox", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      continue;
    }

    const publicGmailPage =
      page.url().includes("workspace.google.com") ||
      page.url().includes("/gmail/") ||
      (await page.title()).toLowerCase().includes("gmail:");
    if (publicGmailPage && attempt >= 1) {
      await promptEnter(
        "The automation browser is open on Gmail. Log into the sending mailbox in that window, then press Enter here to continue."
      );
      await page.goto("https://mail.google.com/mail/u/0/#inbox", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      continue;
    }

    await page.waitForTimeout(5000);
    if (await composeLocator().isVisible().catch(() => false)) return;
    if (attempt >= 2) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    }
  }

  const composeVisible = await page
    .locator('div[gh="cm"], [role="button"][gh="cm"], [role="button"][aria-label^="Compose"], div[role="button"]:has-text("Compose")')
    .first()
    .isVisible()
    .catch(() => false);
  if (!composeVisible) {
    const bodyExcerpt = (
      ((await page.locator("body").innerText().catch(() => "")) || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 600)
    );
    throw new Error(
      `Gmail inbox is not ready. Compose button was not found. url=${page.url()} title=${await page.title()} body=${bodyExcerpt}`
    );
  }
}

async function openCompose(page: Page) {
  const composeButton = page
    .locator(
      'div[gh="cm"], [role="button"][gh="cm"], [role="button"][aria-label^="Compose"], div[role="button"]:has-text("Compose")'
    )
    .first();
  await composeButton.waitFor({ state: "visible", timeout: 30000 });
  try {
    await dismissGmailOverlays(page);
  } catch {}
  const subject = page.locator('input[name="subjectbox"]').last();
  const openViaShortcut = async () => {
    await page.keyboard.press("c").catch(() => {});
    await page.waitForTimeout(500);
  };
  try {
    await composeButton.click({ timeout: 5000 });
  } catch {
    try {
      await composeButton.click({ force: true });
    } catch {
      await openViaShortcut();
    }
  }
  if (!(await subject.isVisible().catch(() => false))) {
    await openViaShortcut();
  }
  if (!(await subject.isVisible().catch(() => false))) {
    await composeButton.evaluate((node) => (node as HTMLElement).click()).catch(() => {});
    await page.waitForTimeout(500);
  }
  await subject.waitFor({ state: "visible", timeout: 30000 });
}

async function dismissGmailOverlays(page: Page, options: { useEscape?: boolean } = {}) {
  if (options.useEscape !== false) {
    try {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    } catch {}
  }
  for (let step = 0; step < 4; step += 1) {
    const smartFeatures = page.locator('text=Turn on smart features to get more out of Gmail, Chat, and Meet').first();
    if (!(await smartFeatures.isVisible().catch(() => false))) break;
    const turnOffOption = page.locator('text=Turn off smart features').first();
    if (await turnOffOption.isVisible().catch(() => false)) {
      await turnOffOption.click().catch(() => {});
      await page.waitForTimeout(300);
    }
    const nextButton = page.locator('button:has-text("Next"), div[role="button"]:has-text("Next")').last();
    if (await nextButton.isVisible().catch(() => false)) {
      await nextButton.click().catch(() => {});
      await page.waitForTimeout(500);
      continue;
    }
    const doneButton = page.locator('button:has-text("Done"), div[role="button"]:has-text("Done")').last();
    if (await doneButton.isVisible().catch(() => false)) {
      await doneButton.click().catch(() => {});
      await page.waitForTimeout(500);
      continue;
    }
    break;
  }
  for (let step = 0; step < 6; step += 1) {
    const nextButton = page.locator('button:has-text("Next"), div[role="button"]:has-text("Next")').last();
    const gotItButton = page.locator('button:has-text("Got it"), div[role="button"]:has-text("Got it")').last();
    const doneButton = page.locator('button:has-text("Done"), div[role="button"]:has-text("Done")').last();
    const noThanksButton = page.locator('button:has-text("No thanks"), div[role="button"]:has-text("No thanks")').last();
    const closeButton = page
      .locator('button[aria-label="Close"], div[role="button"][aria-label="Close"], button:has(svg)')
      .first();

    if (await gotItButton.isVisible().catch(() => false)) {
      await gotItButton.click().catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    if (await doneButton.isVisible().catch(() => false)) {
      await doneButton.click().catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    if (await noThanksButton.isVisible().catch(() => false)) {
      await noThanksButton.click().catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    if (await nextButton.isVisible().catch(() => false)) {
      await nextButton.click().catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click().catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    break;
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
      await page.waitForTimeout(250);
    }
  }
}

async function closeOpenComposeWindows(page: Page) {
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

async function verifyFromAddress(page: Page, expectedFrom: string) {
  if (!expectedFrom.trim()) return;
  const fromInput = page.locator('input[aria-label*="From"], input[name="from"]').last();
  if (await fromInput.isVisible().catch(() => false)) {
    const value = ((await fromInput.inputValue().catch(() => "")) || "").trim().toLowerCase();
    if (value && value !== expectedFrom.trim().toLowerCase()) {
      throw new Error(`Compose window from-address mismatch. Expected ${expectedFrom}, got ${value}`);
    }
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

async function latestComposeRoot(page: Page) {
  const dialog = page.locator(COMPOSE_DIALOG_SELECTOR).last();
  if ((await dialog.count().catch(() => 0)) > 0) {
    return dialog;
  }
  return page.locator("body");
}

async function readSelectedRecipientEmails(composeRoot: Locator) {
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

async function hasSelectedRecipient(composeRoot: Locator, recipient: string) {
  const normalizedRecipient = normalizeEmail(recipient);
  if (!normalizedRecipient) return false;
  const selectedEmails = await readSelectedRecipientEmails(composeRoot);
  return selectedEmails.includes(normalizedRecipient);
}

async function fillToRecipient(page: Page, recipient: string) {
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

async function fillCompose(page: Page, row: SendRow, expectedFrom: string) {
  await closeOpenComposeWindows(page);
  await openCompose(page);
  await verifyFromAddress(page, expectedFrom);
  await dismissGmailOverlays(page, { useEscape: false });

  await fillToRecipient(page, row.email);

  const subject = page.locator('input[name="subjectbox"]').last();
  await subject.fill(row.subject);

  const body = page.locator('div[aria-label="Message Body"], div[role="textbox"][g_editable="true"]').last();
  await dismissGmailOverlays(page, { useEscape: false });
  try {
    await body.click({ timeout: 5000 });
  } catch {
    await body.click({ force: true });
  }
  await body.fill(row.body);
}

async function isComposeStillOpen(page: Page) {
  return page.locator(COMPOSE_OPEN_SELECTOR).last().isVisible().catch(() => false);
}

async function visibleGmailSendError(page: Page) {
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

async function waitForSendConfirmation(page: Page) {
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

async function sendCompose(page: Page, onSendAttempt?: () => void) {
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

async function closeCompose(page: Page) {
  const discard = page.locator('img[aria-label^="Discard draft"], div[aria-label^="Discard draft"]').first();
  if (await discard.isVisible().catch(() => false)) {
    await discard.click();
    return;
  }
  await page.keyboard.press("Escape");
}

async function main() {
  loadLocalEnv();
  ensureDisplayEnv();
  const options = parseArgs(process.argv.slice(2));
  const rows = await loadRows(options);
  const selected = rows.slice(options.startAt, options.startAt + options.limit);
  if (!selected.length) {
    throw new Error("No sendable rows found in the selected range.");
  }

  await mkdir(options.profileDir, { recursive: true });
  await mkdir(options.screenshotDir, { recursive: true });

  let context: BrowserContext;
  const executablePath = resolveChromeExecutablePath(options);
  const proxy = resolveProxy(options);
  try {
    context = await chromium.launchPersistentContext(options.userDataDir, {
      ...(executablePath ? { executablePath } : { channel: options.browserChannel }),
      headless: false,
      viewport: { width: 1440, height: 980 },
      args: options.chromeProfileDirectory ? [`--profile-directory=${options.chromeProfileDirectory}`] : [],
      proxy,
    });
  } catch {
    context = await chromium.launchPersistentContext(options.userDataDir, {
      ...(executablePath ? { executablePath } : {}),
      headless: false,
      viewport: { width: 1440, height: 980 },
      args: options.chromeProfileDirectory ? [`--profile-directory=${options.chromeProfileDirectory}`] : [],
      proxy,
    });
  }
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await ensureGmailReady(page);
    console.log(
      JSON.stringify({
        mode: options.send ? "send" : "preview",
        csvPath: options.csvPath,
        rows: selected.length,
        profileDir: options.profileDir,
      })
    );

    for (let index = 0; index < selected.length; index += 1) {
      const row = selected[index];
      console.log(
        JSON.stringify({
          event: "compose_start",
          index: options.startAt + index,
          lineNumber: row.lineNumber,
          email: row.email,
          subject: row.subject,
        })
      );
      await fillCompose(page, row, options.expectedFrom);

      if (!options.send) {
        const screenshotPath = path.join(
          options.screenshotDir,
          `gmail-preview-${String(index + 1).padStart(2, "0")}.png`
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(JSON.stringify({ event: "preview_ready", screenshotPath }));
        await promptEnter("Preview is ready in Gmail. Press Enter to discard this draft and continue.");
        await closeCompose(page);
        continue;
      }

      await sendCompose(page);
      console.log(JSON.stringify({ event: "sent", email: row.email, subject: row.subject }));
      if (index < selected.length - 1 && options.pauseMs > 0) {
        await page.waitForTimeout(options.pauseMs);
      }
    }
  } catch (error) {
    const failurePath = path.join(
      options.screenshotDir,
      `gmail-failure-${Date.now()}.png`
    );
    await page.screenshot({ path: failurePath, fullPage: true }).catch(() => {});
    console.error(
      `${error instanceof Error ? error.message : String(error)}\nFailure screenshot: ${failurePath}`
    );
    process.exit(1);
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
