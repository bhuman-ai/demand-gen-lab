import fs from "fs";
import path from "path";

type CliOptions = {
  accountId: string;
  fromEmail: string;
  allActive: boolean;
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
  return {
    accountId: take("--account-id"),
    fromEmail: take("--from-email").trim().toLowerCase(),
    allActive: has("--all-active"),
  };
}

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));

  const { listOutreachAccounts, getOutreachAccountSecrets } = await import("@/lib/outreach-data");
  const { getOutreachAccountFromEmail } = await import("@/lib/outreach-account-helpers");
  const { syncMailpoolOutreachAccountCredentials } = await import("@/lib/mailpool-account-refresh");

  let accounts = await listOutreachAccounts();
  accounts = accounts.filter(
    (row) =>
      row.provider === "mailpool" &&
      row.accountType !== "mailbox" &&
      row.config.mailbox.deliveryMethod === "gmail_ui"
  );

  let targets = accounts;
  if (options.accountId) {
    targets = accounts.filter((row) => row.id === options.accountId);
  } else if (options.fromEmail) {
    targets = accounts.filter((row) => getOutreachAccountFromEmail(row).trim().toLowerCase() === options.fromEmail);
  } else if (!options.allActive) {
    throw new Error("Pass --account-id, --from-email, or --all-active.");
  }

  const rows = [];
  for (const account of targets) {
    const updated = await syncMailpoolOutreachAccountCredentials(account.id);
    const secrets = await getOutreachAccountSecrets(updated.id);
    rows.push({
      accountId: updated.id,
      fromEmail: getOutreachAccountFromEmail(updated),
      mailpoolStatus: updated.config.mailpool.status,
      hasMailboxAuthCode: Boolean(secrets?.mailboxAuthCode.trim()),
      hasMailboxAdminAuthCode: Boolean(secrets?.mailboxAdminAuthCode.trim()),
    });
  }

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
