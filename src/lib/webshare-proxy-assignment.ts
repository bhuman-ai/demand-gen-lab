import type { OutreachAccount, OutreachAccountConfig } from "@/lib/factory-types";
import { listOutreachAccounts, updateOutreachAccount } from "@/lib/outreach-data";
import { pickWebshareProxy } from "@/lib/webshare-client";

function normalizeBooleanEnv(name: string) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] ?? "").trim().toLowerCase());
}

export function wantsWebshareProxy() {
  return normalizeBooleanEnv("WEBSHARE_AUTO_ASSIGN_PROXY");
}

export function accountRequiresWebshareProxy(account: Pick<OutreachAccount, "provider" | "accountType" | "config">) {
  return (
    wantsWebshareProxy() &&
    account.provider === "mailpool" &&
    account.accountType !== "mailbox" &&
    account.config.mailbox.deliveryMethod === "gmail_ui"
  );
}

function proxyKeyFromMailboxConfig(config: OutreachAccountConfig["mailbox"]) {
  const host = String(config.proxyHost ?? "").trim();
  const port = Number(config.proxyPort ?? 0) || 0;
  if (host && port) return `${host}:${port}`;

  const url = String(config.proxyUrl ?? "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname && parsed.port) {
      return `${parsed.hostname}:${parsed.port}`;
    }
  } catch {}
  return "";
}

export async function resolveRequiredWebshareProxyConfig(input?: {
  excludeAccountId?: string;
  currentConfig?: Partial<OutreachAccountConfig["mailbox"]> | null;
}) {
  const currentConfig = input?.currentConfig;
  const currentProxyKey = currentConfig
    ? proxyKeyFromMailboxConfig({
        provider: "gmail",
        deliveryMethod: "gmail_ui",
        email: "",
        status: "disconnected",
        host: "",
        port: 993,
        secure: true,
        smtpHost: "",
        smtpPort: 587,
        smtpSecure: false,
        smtpUsername: "",
        gmailUiUserDataDir: "",
        gmailUiProfileDirectory: "",
        gmailUiBrowserChannel: "chrome",
        gmailUiLoginState: "unknown",
        gmailUiLoginCheckedAt: "",
        gmailUiLoginMessage: "",
        proxyUrl: String(currentConfig?.proxyUrl ?? "").trim(),
        proxyHost: String(currentConfig?.proxyHost ?? "").trim(),
        proxyPort: Number(currentConfig?.proxyPort ?? 0) || 0,
        proxyUsername: String(currentConfig?.proxyUsername ?? "").trim(),
        proxyPassword: String(currentConfig?.proxyPassword ?? "").trim(),
      })
    : "";

  if (currentProxyKey) {
    return {
      proxyUrl: String(currentConfig?.proxyUrl ?? "").trim(),
      proxyHost: String(currentConfig?.proxyHost ?? "").trim(),
      proxyPort: Number(currentConfig?.proxyPort ?? 0) || 0,
      proxyUsername: String(currentConfig?.proxyUsername ?? "").trim(),
      proxyPassword: String(currentConfig?.proxyPassword ?? "").trim(),
    };
  }

  const allAccounts = await listOutreachAccounts();
  const used = new Set<string>();
  for (const row of allAccounts) {
    if (input?.excludeAccountId && row.id === input.excludeAccountId) continue;
    const key = proxyKeyFromMailboxConfig(row.config.mailbox);
    if (key) used.add(key);
  }

  const choice = await pickWebshareProxy(used);
  if (!choice.ok || !choice.proxy) {
    throw new Error(`Webshare proxy auto-assignment failed: ${choice.error || "unknown error"}`);
  }

  return {
    proxyUrl: choice.proxy.url,
    proxyHost: choice.proxy.host,
    proxyPort: choice.proxy.port,
    proxyUsername: choice.proxy.username,
    proxyPassword: choice.proxy.password,
  };
}

export async function ensureRequiredWebshareProxy(account: OutreachAccount) {
  if (!accountRequiresWebshareProxy(account)) {
    return account;
  }

  const currentProxyKey = proxyKeyFromMailboxConfig(account.config.mailbox);
  if (currentProxyKey) {
    return account;
  }

  const proxyConfig = await resolveRequiredWebshareProxyConfig({
    excludeAccountId: account.id,
    currentConfig: account.config.mailbox,
  });
  const updated = await updateOutreachAccount(account.id, {
    config: {
      mailbox: {
        proxyUrl: proxyConfig.proxyUrl,
        proxyHost: proxyConfig.proxyHost,
        proxyPort: proxyConfig.proxyPort,
        proxyUsername: proxyConfig.proxyUsername,
        proxyPassword: proxyConfig.proxyPassword,
      },
    },
  });
  return updated ?? account;
}

export async function rotateRequiredWebshareProxy(account: OutreachAccount) {
  if (!accountRequiresWebshareProxy(account)) {
    return account;
  }

  const currentProxyKey = proxyKeyFromMailboxConfig(account.config.mailbox);
  const allAccounts = await listOutreachAccounts();
  const used = new Set<string>();
  for (const row of allAccounts) {
    if (row.id === account.id) continue;
    const key = proxyKeyFromMailboxConfig(row.config.mailbox);
    if (key) used.add(key);
  }
  if (currentProxyKey) {
    used.add(currentProxyKey);
  }

  const choice = await pickWebshareProxy(used);
  if (!choice.ok || !choice.proxy) {
    throw new Error(`Webshare proxy rotation failed: ${choice.error || "unknown error"}`);
  }

  const updated = await updateOutreachAccount(account.id, {
    config: {
      mailbox: {
        proxyUrl: choice.proxy.url,
        proxyHost: choice.proxy.host,
        proxyPort: choice.proxy.port,
        proxyUsername: choice.proxy.username,
        proxyPassword: choice.proxy.password,
      },
    },
  });
  return updated ?? account;
}
