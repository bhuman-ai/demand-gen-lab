import { mkdir } from "fs/promises";
import path from "path";
import { listBrands } from "@/lib/factory-data";
import type { DomainRow, OutreachAccount } from "@/lib/factory-types";
import { normalizeGmailUiLoginStatus } from "@/lib/gmail-ui-login";
import { resolveGmailUiUserDataDir } from "@/lib/gmail-ui-profile";
import { getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import {
  getBrandOutreachAssignment,
  listOutreachAccounts,
  setBrandOutreachAssignment,
  updateOutreachAccount,
} from "@/lib/outreach-data";
import { enrichBrandWithSenderHealth } from "@/lib/sender-health";
import {
  buildSenderRoutingSignalFromDomainRow,
  rankSenderRoutingSignals,
} from "@/lib/sender-routing";
import { ensureRequiredWebshareProxy } from "@/lib/webshare-proxy-assignment";

type Candidate = {
  account: OutreachAccount;
  domainRow: DomainRow;
};

export type BrandGmailUiSyncRow = {
  brandId: string;
  brandName: string;
  fromEmail: string;
  accountId: string;
  accountStatus: string;
  mailpoolStatus: string;
  proxyHost: string;
  userDataDir: string;
  warning: string;
};

export type BrandGmailUiSyncResult = {
  profileRoot: string;
  brandCount: number;
  results: BrandGmailUiSyncRow[];
  warnings: string[];
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isGoogleMailpoolAccount(account: OutreachAccount) {
  return (
    account.provider === "mailpool" &&
    account.accountType !== "mailbox" &&
    account.config.mailpool.mailboxType === "google" &&
    Boolean(getOutreachAccountFromEmail(account))
  );
}

function isMailpoolSenderDomain(row: DomainRow) {
  return row.role === "sender" && row.provider === "mailpool" && Boolean(String(row.fromEmail ?? "").trim());
}

function localPart(email: string) {
  return normalizeEmail(email).split("@")[0] ?? "";
}

function scoreCandidate(candidate: Candidate, currentAssignmentId: string) {
  let score = 0;
  if (candidate.account.id === currentAssignmentId) score += 10;
  if (candidate.domainRow.dnsStatus === "verified") score += 40;
  if (candidate.account.config.mailpool.status === "active") score += 60;
  if (candidate.account.status === "active") score += 20;

  const part = localPart(candidate.domainRow.fromEmail ?? "");
  if (part === "hello") score += 12;
  if (part === "team") score += 8;
  if (part === "help") score += 6;
  if (part.startsWith("research")) score -= 2;

  return score;
}

function assignedAccountIds(assignment: Awaited<ReturnType<typeof getBrandOutreachAssignment>>) {
  return Array.from(
    new Set(
      [
        assignment?.accountId ?? "",
        ...(assignment?.accountIds ?? []),
      ]
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
    )
  );
}

export async function syncBrandGmailUiAssignments(options?: {
  brandIds?: string[];
}): Promise<BrandGmailUiSyncResult> {
  const profileRoot =
    String(process.env.GMAIL_UI_PROFILE_ROOT ?? "").trim() ||
    path.join(process.cwd(), "data", "gmail-ui-profiles");
  await mkdir(profileRoot, { recursive: true });

  const brandFilter = new Set(
    (options?.brandIds ?? []).map((brandId) => String(brandId ?? "").trim()).filter(Boolean)
  );
  const brands = (await listBrands()).filter((brand) => !brandFilter.size || brandFilter.has(brand.id));
  const accounts = await listOutreachAccounts();
  const accountById = new Map(accounts.map((account) => [account.id, account] as const));
  const accountByFromEmail = new Map<string, OutreachAccount[]>();
  for (const account of accounts) {
    const fromEmail = normalizeEmail(getOutreachAccountFromEmail(account));
    if (!fromEmail) continue;
    const bucket = accountByFromEmail.get(fromEmail) ?? [];
    bucket.push(account);
    accountByFromEmail.set(fromEmail, bucket);
  }

  const results: BrandGmailUiSyncRow[] = [];
  const warnings: string[] = [];

  for (const brand of brands) {
    const assignment = await getBrandOutreachAssignment(brand.id);
    const enrichedBrand = await enrichBrandWithSenderHealth(brand).catch(() => brand);
    const senderDomains = enrichedBrand.domains.filter(isMailpoolSenderDomain);
    if (!senderDomains.length) continue;

    const candidates: Candidate[] = senderDomains.flatMap((domainRow) => {
      const fromEmail = normalizeEmail(String(domainRow.fromEmail ?? ""));
      const matches = (accountByFromEmail.get(fromEmail) ?? []).filter(isGoogleMailpoolAccount);
      return matches.map((account) => ({ account, domainRow }));
    });

    if (!candidates.length) {
      warnings.push(`${brand.name}: no Mailpool Google sender account found`);
      continue;
    }

    const currentAssignmentId =
      candidates.find((candidate) => candidate.account.status === "active")?.account.id ?? "";
    const refreshedCandidates = candidates;

    refreshedCandidates.sort(
      (left, right) => scoreCandidate(right, currentAssignmentId) - scoreCandidate(left, currentAssignmentId)
    );
    const chosen = refreshedCandidates[0];
    if (!chosen) continue;

    const fromEmail = normalizeEmail(getOutreachAccountFromEmail(chosen.account));
    const { userDataDir, rehomedProfile } = resolveGmailUiUserDataDir({
      profileRoot,
      existingUserDataDir: chosen.account.config.mailbox.gmailUiUserDataDir,
      email: fromEmail,
    });
    await mkdir(userDataDir, { recursive: true });

    const loginStatus = normalizeGmailUiLoginStatus({
      deliveryMethod: "gmail_ui",
      state: chosen.account.config.mailbox.gmailUiLoginState,
      checkedAt: chosen.account.config.mailbox.gmailUiLoginCheckedAt,
      message: chosen.account.config.mailbox.gmailUiLoginMessage,
      forceLoginRequired: rehomedProfile,
    });

    const updated = await updateOutreachAccount(chosen.account.id, {
      status: "active",
      config: {
        mailbox: {
          provider: "gmail",
          deliveryMethod: "gmail_ui",
          email: fromEmail,
          status: chosen.account.config.mailpool.status === "active" ? "connected" : "disconnected",
          gmailUiUserDataDir: userDataDir,
          gmailUiProfileDirectory: "",
          gmailUiBrowserChannel: "chrome",
          gmailUiLoginState: loginStatus.gmailUiLoginState,
          gmailUiLoginCheckedAt: loginStatus.gmailUiLoginCheckedAt,
          gmailUiLoginMessage: loginStatus.gmailUiLoginMessage,
        },
      },
    });

    if (!updated) {
      warnings.push(`${brand.name}: failed to update account ${chosen.account.id}`);
      continue;
    }
    const proxied = await ensureRequiredWebshareProxy(updated).catch((error) => {
      warnings.push(
        `${brand.name}: ${error instanceof Error ? error.message : "proxy assignment failed"}`
      );
      return updated;
    });

    const currentPrimaryAccount = assignment?.accountId
      ? accountById.get(assignment.accountId) ?? null
      : null;
    if (
      currentPrimaryAccount &&
      currentPrimaryAccount.id !== proxied.id &&
      currentPrimaryAccount.status === "active" &&
      !isGoogleMailpoolAccount(currentPrimaryAccount)
    ) {
      const currentMailboxAccountId =
        assignment?.mailboxAccountId && assignment.mailboxAccountId !== proxied.id
          ? assignment.mailboxAccountId
          : currentPrimaryAccount.id;
      await setBrandOutreachAssignment(brand.id, {
        accountId: currentPrimaryAccount.id,
        accountIds: [currentPrimaryAccount.id],
        mailboxAccountId: currentMailboxAccountId,
      });
      warnings.push(
        `${brand.name}: kept existing non-Gmail sender ${getOutreachAccountFromEmail(
          currentPrimaryAccount
        )} instead of Gmail UI sender ${fromEmail}.`
      );
      continue;
    }

    const signalsByAccountId = new Map(
      enrichedBrand.domains
        .map((row) => buildSenderRoutingSignalFromDomainRow(row))
        .filter((signal): signal is NonNullable<ReturnType<typeof buildSenderRoutingSignalFromDomainRow>> =>
          Boolean(signal)
        )
        .map((signal) => [signal.senderAccountId, signal] as const)
    );
    const chosenSignal = signalsByAccountId.get(proxied.id) ?? null;
    const currentSignals = assignedAccountIds(assignment)
      .map((accountId) => signalsByAccountId.get(accountId) ?? null)
      .filter((signal): signal is NonNullable<typeof signal> => Boolean(signal));
    const bestCurrentSignal =
      rankSenderRoutingSignals(currentSignals).find((signal) => signal.automationStatus !== "attention") ??
      rankSenderRoutingSignals(currentSignals)[0] ??
      null;
    const preferredSignal = rankSenderRoutingSignals(
      [bestCurrentSignal, chosenSignal].filter((signal): signal is NonNullable<typeof signal> => Boolean(signal))
    )[0] ?? null;
    const assignmentSignal =
      preferredSignal && preferredSignal.senderAccountId !== proxied.id && preferredSignal.automationStatus !== "attention"
        ? preferredSignal
        : chosenSignal;

    if (assignmentSignal) {
      await setBrandOutreachAssignment(brand.id, {
        accountId: assignmentSignal.senderAccountId,
        accountIds: [assignmentSignal.senderAccountId],
        mailboxAccountId: assignmentSignal.senderAccountId,
      });
      if (assignmentSignal.senderAccountId !== proxied.id) {
        warnings.push(
          `${brand.name}: kept healthier sender ${assignmentSignal.fromEmail} instead of Gmail UI sender ${fromEmail}.`
        );
      }
    } else {
      await setBrandOutreachAssignment(brand.id, {
        accountId: proxied.id,
        accountIds: [proxied.id],
        mailboxAccountId: proxied.id,
      });
    }

    for (const candidate of refreshedCandidates.slice(1)) {
      if (candidate.account.id === proxied.id) continue;
      if (candidate.account.status !== "inactive") {
        await updateOutreachAccount(candidate.account.id, { status: "inactive" });
      }
    }

    const warning =
      proxied.config.mailpool.status === "active"
        ? ""
        : "Mailpool mailbox is not active yet; sender is configured but not ready to send.";
    if (warning) {
      warnings.push(`${brand.name}: ${warning}`);
    }

    results.push({
      brandId: brand.id,
      brandName: brand.name,
      fromEmail,
      accountId: proxied.id,
      accountStatus: proxied.status,
      mailpoolStatus: proxied.config.mailpool.status,
      proxyHost: proxied.config.mailbox.proxyHost,
      userDataDir,
      warning,
    });
  }

  return {
    profileRoot,
    brandCount: results.length,
    results,
    warnings,
  };
}
