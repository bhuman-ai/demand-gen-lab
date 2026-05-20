import { randomBytes } from "crypto";
import type { DeliverabilityProbeTarget } from "@/lib/factory-types";
import {
  createForwardEmailAlias,
  deleteForwardEmailAlias,
  generateForwardEmailAliasPassword,
  getForwardEmailProbeConfig,
  type ForwardEmailProbeConfig,
} from "@/lib/forward-email-client";
import { decryptJson, encryptJson } from "@/lib/outreach-encryption";

type ForwardEmailProbeSecret = {
  password: string;
};

function nowPlusHours(hours: number) {
  return new Date(Date.now() + Math.max(1, hours) * 60 * 60 * 1000).toISOString();
}

function safeToken(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

function aliasName(input: {
  config: ForwardEmailProbeConfig;
  probeToken: string;
  index: number;
}) {
  const suffix = randomBytes(3).toString("hex");
  const probeToken = safeToken(input.probeToken) || "probe";
  const prefix = safeToken(input.config.aliasPrefix) || "lastb2b-probe";
  return `${prefix}-${probeToken}-${input.index + 1}-${suffix}`.slice(0, 63);
}

export function decryptForwardEmailProbePassword(target: DeliverabilityProbeTarget) {
  return decryptJson<ForwardEmailProbeSecret>(
    String(target.imapPasswordEncrypted ?? ""),
    { password: "" }
  ).password.trim();
}

export function getForwardEmailTargetId(aliasId: string) {
  return `forward_email:${aliasId}`;
}

export function isForwardEmailProbeTarget(target: Pick<DeliverabilityProbeTarget, "provider" | "accountId">) {
  return target.provider === "forward_email" || String(target.accountId ?? "").startsWith("forward_email:");
}

export async function allocateForwardEmailProbeTargets(input: {
  probeToken: string;
  count?: number;
}): Promise<{ config: ForwardEmailProbeConfig; targets: DeliverabilityProbeTarget[] } | null> {
  const config = getForwardEmailProbeConfig();
  if (!config) return null;
  const targetCount = Math.max(1, Math.min(config.targetCount, Math.round(Number(input.count ?? config.targetCount) || 1)));
  const targets: DeliverabilityProbeTarget[] = [];

  try {
    for (let index = 0; index < targetCount; index += 1) {
      let aliasId = "";
      try {
        const alias = await createForwardEmailAlias({
          config,
          name: aliasName({ config, probeToken: input.probeToken, index }),
          description: `LastB2B deliverability probe ${input.probeToken}`,
          labels: ["lastb2b", "deliverability-probe"],
          hasImap: true,
        });
        aliasId = alias.id || alias.name;
        const credentials = await generateForwardEmailAliasPassword({
          config,
          aliasId,
        });
        const username = credentials.username || alias.email;
        if (!credentials.password.trim() || !username.trim()) {
          throw new Error(`Forward Email alias ${alias.email} did not return IMAP credentials`);
        }
        targets.push({
          provider: "forward_email",
          accountId: getForwardEmailTargetId(aliasId),
          email: alias.email,
          forwardEmailDomain: alias.domain,
          forwardEmailAliasId: alias.id,
          forwardEmailAliasName: alias.name,
          imapHost: config.imapHost,
          imapPort: config.imapPort,
          imapSecure: config.imapSecure,
          imapUsername: username,
          imapPasswordEncrypted: encryptJson({ password: credentials.password.trim() }),
          expiresAt: nowPlusHours(config.aliasTtlHours),
        });
      } catch (error) {
        if (aliasId) {
          await deleteForwardEmailAlias({ config, aliasId }).catch(() => undefined);
        }
        throw error;
      }
    }
  } catch (error) {
    await releaseForwardEmailProbeTargets(targets);
    throw error;
  }

  return { config, targets };
}

export async function releaseForwardEmailProbeTarget(target: DeliverabilityProbeTarget) {
  if (!isForwardEmailProbeTarget(target)) return false;
  const config = getForwardEmailProbeConfig();
  const aliasId = String(target.forwardEmailAliasId ?? target.forwardEmailAliasName ?? "").trim();
  if (!config || !aliasId) return false;
  await deleteForwardEmailAlias({ config, aliasId });
  return true;
}

export async function releaseForwardEmailProbeTargets(targets: DeliverabilityProbeTarget[]) {
  await Promise.all(
    targets
      .filter((target) => isForwardEmailProbeTarget(target))
      .map((target) => releaseForwardEmailProbeTarget(target).catch(() => false))
  );
}
