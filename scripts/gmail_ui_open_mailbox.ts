import { mkdir } from "fs/promises";
import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { chromium } from "playwright";

type CliOptions = {
  accountId: string;
  fromEmail: string;
  syncMailpoolCredentials: boolean;
  ignoreConfiguredProxy: boolean;
  browserPath: string;
  browserChannel: string;
  screenshotDir: string;
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

  const accountId = take("--account-id");
  const fromEmail = take("--from-email").trim().toLowerCase();
  if (!accountId && !fromEmail) {
    throw new Error("Pass --account-id <id> or --from-email <email>.");
  }

  return {
    accountId,
    fromEmail,
    syncMailpoolCredentials: has("--sync-mailpool-credentials"),
    ignoreConfiguredProxy: has("--ignore-configured-proxy"),
    browserPath: take("--browser-path"),
    browserChannel: take("--browser-channel", "chrome"),
    screenshotDir: path.resolve(
      take("--screenshot-dir") || path.join(process.cwd(), "output", "playwright", "gmail-ui-open")
    ),
  };
}

function resolveExecutablePath(options: CliOptions) {
  return (
    options.browserPath.trim() ||
    String(process.env.GMAIL_UI_EXECUTABLE_PATH ?? process.env.CHROME_EXECUTABLE_PATH ?? "").trim()
  );
}

function ensureDisplayEnv() {
  if (String(process.env.DISPLAY ?? "").trim()) return;
  const configured = String(process.env.GMAIL_UI_DISPLAY ?? "").trim();
  process.env.DISPLAY = configured || ":99";
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

async function promptEnter(question: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return new Promise<void>((resolve) => {
      process.on("SIGINT", () => resolve());
      process.on("SIGTERM", () => resolve());
    });
  }
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(question);
  } finally {
    rl.close();
  }
}

async function main() {
  loadLocalEnv();
  ensureDisplayEnv();
  const options = parseArgs(process.argv.slice(2));

  const {
    listOutreachAccounts,
    getOutreachAccount,
    getOutreachAccountSecrets,
    updateOutreachAccount,
  } = await import("@/lib/outreach-data");
  const { getOutreachAccountFromEmail } = await import("@/lib/outreach-account-helpers");
  const { syncMailpoolOutreachAccountCredentials } = await import("@/lib/mailpool-account-refresh");
  const { inspectGmailUiSession, normalizeGmailUiLoginStatus, persistGmailUiSessionCheck } = await import("@/lib/gmail-ui-login");
  const { resolveGmailUiUserDataDir } = await import("@/lib/gmail-ui-profile");

  let account = options.accountId ? await getOutreachAccount(options.accountId) : null;
  if (!account && options.fromEmail) {
    const accounts = await listOutreachAccounts();
    account =
      accounts.find((row) => getOutreachAccountFromEmail(row).trim().toLowerCase() === options.fromEmail) ?? null;
  }
  if (!account) {
    throw new Error("Outreach account not found.");
  }

  if (options.syncMailpoolCredentials && account.provider === "mailpool") {
    account = await syncMailpoolOutreachAccountCredentials(account.id);
  }

  if (account.config.mailbox.deliveryMethod !== "gmail_ui") {
    throw new Error(`Account ${account.id} is not configured for gmail_ui delivery.`);
  }

  const { userDataDir, rehomedProfile } = resolveGmailUiUserDataDir({
    profileRoot: String(process.env.GMAIL_UI_PROFILE_ROOT ?? "").trim(),
    existingUserDataDir: account.config.mailbox.gmailUiUserDataDir,
    email: getOutreachAccountFromEmail(account),
  });
  if (!userDataDir) {
    throw new Error(`gmailUiUserDataDir missing for ${account.id}.`);
  }
  if (rehomedProfile) {
    const loginStatus = normalizeGmailUiLoginStatus({
      deliveryMethod: "gmail_ui",
      state: account.config.mailbox.gmailUiLoginState,
      checkedAt: account.config.mailbox.gmailUiLoginCheckedAt,
      message: account.config.mailbox.gmailUiLoginMessage,
      forceLoginRequired: true,
    });
    const updated = await updateOutreachAccount(account.id, {
      config: {
        mailbox: {
          provider: "gmail",
          deliveryMethod: "gmail_ui",
          gmailUiUserDataDir: userDataDir,
          gmailUiLoginState: loginStatus.gmailUiLoginState,
          gmailUiLoginCheckedAt: loginStatus.gmailUiLoginCheckedAt,
          gmailUiLoginMessage: loginStatus.gmailUiLoginMessage,
        },
      },
    });
    if (updated) {
      account = updated;
    }
  }
  await mkdir(userDataDir, { recursive: true });
  await mkdir(options.screenshotDir, { recursive: true });

  const secrets = await getOutreachAccountSecrets(account.id);
  const executablePath = resolveExecutablePath(options);
  const proxy = options.ignoreConfiguredProxy ? undefined : resolveProxy(account.config.mailbox);
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(executablePath ? { executablePath } : { channel: options.browserChannel || account.config.mailbox.gmailUiBrowserChannel || "chrome" }),
    headless: false,
    viewport: { width: 1440, height: 980 },
    args: account.config.mailbox.gmailUiProfileDirectory.trim()
      ? [`--profile-directory=${account.config.mailbox.gmailUiProfileDirectory.trim()}`]
      : [],
    proxy,
  });
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto("https://mail.google.com/mail/u/0/#inbox", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const screenshotPath = path.join(
      options.screenshotDir,
      `${account.id}-${Date.now().toString(36)}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const sessionCheck = await inspectGmailUiSession(page);
    await persistGmailUiSessionCheck(account.id, sessionCheck).catch(() => {});

    console.log(
      JSON.stringify(
        {
          accountId: account.id,
          fromEmail: getOutreachAccountFromEmail(account),
          mailpoolStatus: account.config.mailpool.status,
          userDataDir,
          ignoreConfiguredProxy: options.ignoreConfiguredProxy,
          proxyHost: account.config.mailbox.proxyHost,
          proxyPort: account.config.mailbox.proxyPort,
          hasMailboxPassword: Boolean(secrets?.mailboxPassword.trim()),
          hasMailboxAuthCode: Boolean(secrets?.mailboxAuthCode.trim()),
          hasMailboxAdminPassword: Boolean(secrets?.mailboxAdminPassword.trim()),
          hasMailboxAdminAuthCode: Boolean(secrets?.mailboxAdminAuthCode.trim()),
          currentUrl: sessionCheck.currentUrl,
          gmailUiLoginState: sessionCheck.state,
          gmailUiLoginMessage: sessionCheck.summary,
          screenshotPath,
        },
        null,
        2
      )
    );

    await promptEnter(
      "Browser is open on the mailbox profile. Complete login/checks in the browser, then press Enter or Ctrl+C here to close it."
    );
    const finalCheck = await inspectGmailUiSession(page).catch(() => null);
    if (finalCheck) {
      await persistGmailUiSessionCheck(account.id, finalCheck).catch(() => {});
    }
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
