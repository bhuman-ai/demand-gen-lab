import { mkdir } from "fs/promises";
import path from "path";
import { listBrands } from "@/lib/factory-data";
import type { DomainRow, OutreachAccount } from "@/lib/factory-types";
import { normalizeGmailUiLoginStatus } from "@/lib/gmail-ui-login";
import { resolveGmailUiUserDataDir } from "@/lib/gmail-ui-profile";
import { getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import {
  listOutreachAccounts,
  setBrandOutreachAssignment,
  updateOutreachAccount,
} from "@/lib/outreach-data";
import { pickWebshareProxy } from "@/lib/webshare-client";

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

function proxyKey(account: OutreachAccount) {
  const host = String(account.config.mailbox.proxyHost ?? "").trim();
  const port = Number(account.config.mailbox.proxyPort ?? 0) || 0;
  if (!host || !port) return "";
  return `${host}:${port}`;
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
  const accountByFromEmail = new Map<string, OutreachAccount[]>();
  const usedProxyKeys = new Set<string>();

  for (const account of accounts) {
    const fromEmail = normalizeEmail(getOutreachAccountFromEmail(account));
    if (!fromEmail) continue;
    const bucket = accountByFromEmail.get(fromEmail) ?? [];
    bucket.push(account);
    accountByFromEmail.set(fromEmail, bucket);

    const currentProxyKey = proxyKey(account);
    if (currentProxyKey) usedProxyKeys.add(currentProxyKey);
  }

  const results: BrandGmailUiSyncRow[] = [];
  const warnings: string[] = [];

  for (const brand of brands) {
    const senderDomains = brand.domains.filter(isMailpoolSenderDomain);
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

    let proxyHost = chosen.account.config.mailbox.proxyHost.trim();
    let proxyPort = Number(chosen.account.config.mailbox.proxyPort ?? 0) || 0;
    let proxyUsername = chosen.account.config.mailbox.proxyUsername.trim();
    let proxyPassword = chosen.account.config.mailbox.proxyPassword.trim();
    let proxyUrl = chosen.account.config.mailbox.proxyUrl.trim();

    if (!proxyHost || !proxyPort) {
      const picked = await pickWebshareProxy(usedProxyKeys);
      if (!picked.ok || !picked.proxy) {
        warnings.push(`${brand.name}: ${picked.error || "proxy assignment failed"}`);
      } else {
        proxyHost = picked.proxy.host;
        proxyPort = picked.proxy.port;
        proxyUsername = picked.proxy.username;
        proxyPassword = picked.proxy.password;
        proxyUrl = picked.proxy.url;
        usedProxyKeys.add(`${proxyHost}:${proxyPort}`);
      }
    }

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
          proxyUrl,
          proxyHost,
          proxyPort,
          proxyUsername,
          proxyPassword,
        },
      },
    });

    if (!updated) {
      warnings.push(`${brand.name}: failed to update account ${chosen.account.id}`);
      continue;
    }

    await setBrandOutreachAssignment(brand.id, {
      accountId: updated.id,
      mailboxAccountId: updated.id,
    });

    for (const candidate of refreshedCandidates.slice(1)) {
      if (candidate.account.id === updated.id) continue;
      if (candidate.account.status !== "inactive") {
        await updateOutreachAccount(candidate.account.id, { status: "inactive" });
      }
    }

    const warning =
      updated.config.mailpool.status === "active"
        ? ""
        : "Mailpool mailbox is not active yet; sender is configured but not ready to send.";
    if (warning) {
      warnings.push(`${brand.name}: ${warning}`);
    }

    results.push({
      brandId: brand.id,
      brandName: brand.name,
      fromEmail,
      accountId: updated.id,
      accountStatus: updated.status,
      mailpoolStatus: updated.config.mailpool.status,
      proxyHost: updated.config.mailbox.proxyHost,
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
