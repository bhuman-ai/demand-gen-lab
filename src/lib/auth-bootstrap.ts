import { scryptSync, timingSafeEqual } from "node:crypto";

type BootstrapIdentity = {
  email: string;
  name: string;
  userId: string;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function configuredEmail() {
  return normalizeEmail(String(process.env.AUTH_BOOTSTRAP_EMAIL ?? ""));
}

function configuredName() {
  return String(process.env.AUTH_BOOTSTRAP_NAME ?? "Operator").trim() || "Operator";
}

function configuredPasswordHash() {
  return String(process.env.AUTH_BOOTSTRAP_PASSWORD_HASH ?? "").trim();
}

function decodePasswordHash(hash: string) {
  const [scheme, salt, derived] = hash.split("$");
  if (scheme !== "scrypt" || !salt || !derived) {
    return null;
  }
  return {
    salt: Buffer.from(salt, "base64"),
    derived: Buffer.from(derived, "base64"),
  };
}

export function hasBootstrapCredentials() {
  return Boolean(configuredEmail() && configuredPasswordHash());
}

export function isBootstrapEmail(email: string) {
  return Boolean(configuredEmail()) && normalizeEmail(email) === configuredEmail();
}

export function bootstrapSignupError() {
  return "This account is already provisioned. Use sign in instead of create account.";
}

export function verifyBootstrapCredentials(email: string, password: string): BootstrapIdentity | null {
  if (!password || !isBootstrapEmail(email)) {
    return null;
  }

  const decoded = decodePasswordHash(configuredPasswordHash());
  if (!decoded) {
    return null;
  }

  const candidate = scryptSync(password, decoded.salt, decoded.derived.length);
  if (!timingSafeEqual(candidate, decoded.derived)) {
    return null;
  }

  return {
    email: configuredEmail(),
    name: configuredName(),
    userId: `bootstrap:${configuredEmail()}`,
  };
}

