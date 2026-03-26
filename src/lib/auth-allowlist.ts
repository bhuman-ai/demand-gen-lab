function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function allowedEmails() {
  return String(process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

export function isAllowedOperatorEmail(email: string) {
  const normalized = normalizeEmail(email);
  const allowlist = allowedEmails();
  if (allowlist.length === 0) {
    return true;
  }
  return allowlist.includes(normalized);
}

export function authAccessErrorMessage() {
  return "This workspace is restricted to approved operator emails.";
}

