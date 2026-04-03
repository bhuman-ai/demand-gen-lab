import { mkdir, readFile } from "fs/promises";
import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { chromium, type BrowserContext, type Page } from "playwright";

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

async function fillCompose(page: Page, row: SendRow, expectedFrom: string) {
  await openCompose(page);
  await verifyFromAddress(page, expectedFrom);
  await dismissGmailOverlays(page, { useEscape: false });

  const toInput = page
    .locator(
      'input[aria-label="To recipients"], input[peoplekit-id], textarea[aria-label="To"], div[aria-label="To"] input'
    )
    .first();
  await toInput.waitFor({ state: "visible", timeout: 30000 });
  await toInput.fill(row.email);
  await page.keyboard.press("Tab");

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

async function sendCompose(page: Page) {
  const sendButton = page
    .locator(
      'div[role="button"][data-tooltip^="Send"], div[role="button"][aria-label*="Send"], [command="Files"]'
    )
    .first();
  await sendButton.waitFor({ state: "visible", timeout: 30000 });
  await sendButton.click();
  await page.locator("text=Message sent").first().waitFor({ state: "visible", timeout: 30000 });
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
