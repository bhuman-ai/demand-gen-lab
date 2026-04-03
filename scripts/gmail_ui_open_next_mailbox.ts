import { spawn } from "child_process";
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

function parseArgs(argv: string[]) {
  const args = [...argv];
  const has = (flag: string) => {
    const index = args.indexOf(flag);
    if (index === -1) return false;
    args.splice(index, 1);
    return true;
  };

  return {
    includeUnassigned: has("--include-unassigned"),
  };
}

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));

  const { listBrands } = await import("@/lib/factory-data");
  const { listOutreachAccounts, getBrandOutreachAssignment } = await import("@/lib/outreach-data");
  const { getOutreachAccountFromEmail, getOutreachGmailUiLoginState } = await import(
    "@/lib/outreach-account-helpers"
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

  const nextAccount = (await listOutreachAccounts())
    .filter((account) => {
      if (account.provider !== "mailpool") return false;
      if (account.accountType === "mailbox") return false;
      if (account.config.mailbox.deliveryMethod !== "gmail_ui") return false;
      if (account.config.mailpool.status !== "active") return false;
      if (getOutreachGmailUiLoginState(account) === "ready") return false;
      if (!options.includeUnassigned && !(brandAssignments.get(account.id)?.length ?? 0)) return false;
      return true;
    })
    .sort((left, right) => {
      const leftBrands = (brandAssignments.get(left.id) ?? []).join(" | ");
      const rightBrands = (brandAssignments.get(right.id) ?? []).join(" | ");
      return (
        leftBrands.localeCompare(rightBrands) ||
        getOutreachAccountFromEmail(left).localeCompare(getOutreachAccountFromEmail(right))
      );
    })[0];

  if (!nextAccount) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          message: options.includeUnassigned
            ? "No login-required Gmail UI senders remain."
            : "No assigned login-required Gmail UI senders remain.",
        },
        null,
        2
      )
    );
    return;
  }

  const fromEmail = getOutreachAccountFromEmail(nextAccount);
  const brandsForAccount = brandAssignments.get(nextAccount.id) ?? [];

  console.log(
    JSON.stringify(
      {
        ok: true,
        action: "opening_next_login_required_sender",
        accountId: nextAccount.id,
        fromEmail,
        brands: brandsForAccount,
        command: `npm run gmail-ui:open -- --account-id ${nextAccount.id} --sync-mailpool-credentials --ignore-configured-proxy`,
      },
      null,
      2
    )
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      [
        "tsx",
        "scripts/gmail_ui_open_mailbox.ts",
        "--account-id",
        nextAccount.id,
        "--sync-mailpool-credentials",
        "--ignore-configured-proxy",
      ],
      {
        cwd: process.cwd(),
        stdio: "inherit",
        env: process.env,
      }
    );

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`gmail_ui_open_mailbox exited with code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
