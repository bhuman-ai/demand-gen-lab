import fs from "fs";
import path from "path";

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

async function main() {
  loadLocalEnv();
  const { listBrands } = await import("@/lib/factory-data");
  const { listOutreachAccounts, getBrandOutreachAssignment } = await import("@/lib/outreach-data");
  const { getOutreachAccountFromEmail, getOutreachGmailUiLoginState } = await import("@/lib/outreach-account-helpers");
  const { resolveGmailUiUserDataDir } = await import("@/lib/gmail-ui-profile");

  const accounts = (await listOutreachAccounts()).filter(
    (account) =>
      account.provider === "mailpool" &&
      account.accountType !== "mailbox" &&
      account.config.mailbox.deliveryMethod === "gmail_ui"
  );

  const brands = await listBrands();
  const brandAssignments = new Map<string, string[]>();
  for (const brand of brands) {
    const assignment = await getBrandOutreachAssignment(brand.id);
    if (!assignment) continue;
    for (const accountId of assignment.accountIds.length ? assignment.accountIds : [assignment.accountId]) {
      const bucket = brandAssignments.get(accountId) ?? [];
      bucket.push(brand.name);
      brandAssignments.set(accountId, bucket);
    }
  }

  const rows = accounts
    .map((account) => {
      const loginState = getOutreachGmailUiLoginState(account);
      const userDataDir = resolveGmailUiUserDataDir({
        profileRoot: String(process.env.GMAIL_UI_PROFILE_ROOT ?? "").trim(),
        existingUserDataDir: account.config.mailbox.gmailUiUserDataDir,
        email: getOutreachAccountFromEmail(account),
      }).userDataDir;
      const needsLogin = account.config.mailpool.status === "active" && loginState !== "ready";
      return {
        accountId: account.id,
        fromEmail: getOutreachAccountFromEmail(account),
        brands: brandAssignments.get(account.id) ?? [],
        mailpoolStatus: account.config.mailpool.status,
        gmailUiLoginState: loginState,
        gmailUiLoginCheckedAt: account.config.mailbox.gmailUiLoginCheckedAt,
        gmailUiLoginMessage: account.config.mailbox.gmailUiLoginMessage,
        userDataDir,
        needsLogin,
        openCommand: `npm run gmail-ui:open -- --account-id ${account.id} --sync-mailpool-credentials --ignore-configured-proxy`,
        checkCommand: `npm run gmail-ui:check -- --account-id ${account.id} --ignore-configured-proxy`,
      };
    })
    .sort((left, right) => {
      if (left.needsLogin !== right.needsLogin) return left.needsLogin ? -1 : 1;
      if (left.mailpoolStatus !== right.mailpoolStatus) return left.mailpoolStatus === "active" ? -1 : 1;
      return left.fromEmail.localeCompare(right.fromEmail);
    });

  console.log(
    JSON.stringify(
      {
        total: rows.length,
        needsLogin: rows.filter((row) => row.needsLogin).length,
        ready: rows.filter((row) => row.gmailUiLoginState === "ready").length,
        rows,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
