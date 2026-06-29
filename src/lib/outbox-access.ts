import "server-only";

import { getRequestAuthSession } from "@/lib/auth-server";

const DEFAULT_OUTBOX_MANUAL_TESTER_EMAILS = ["don@bhuman.ai"];

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function configuredManualTesterEmails() {
  const raw = String(process.env.OUTBOX_MANUAL_TESTER_EMAILS ?? "").trim();
  const source = raw || DEFAULT_OUTBOX_MANUAL_TESTER_EMAILS.join(",");
  return Array.from(
    new Set(
      source
        .split(",")
        .map(normalizeEmail)
        .filter(Boolean)
    )
  );
}

export function isOutboxManualTesterEmail(email: unknown) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return configuredManualTesterEmails().includes(normalized);
}

export async function getOutboxManualTesterSession() {
  const session = await getRequestAuthSession();
  return session && isOutboxManualTesterEmail(session.email) ? session : null;
}

export function outboxAccessDeniedMessage() {
  return "Outbox Airscale testing is currently enabled for don@bhuman.ai only.";
}
