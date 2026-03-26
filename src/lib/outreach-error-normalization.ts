const LEGACY_OUTREACH_ERROR_MAPPINGS: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
  {
    pattern: /No quality leads accepted from Exa queries/gi,
    replacement: "Historical legacy sourcing failure from before the EnrichAnything-only migration.",
  },
  {
    pattern: /All sourced leads were suppressed by quality\/duplicate rules/gi,
    replacement:
      "Historical legacy sourcing run accepted no sendable prospects before the EnrichAnything-only migration.",
  },
  {
    pattern: /Email verification unavailable; no leads could be verified/gi,
    replacement:
      "Historical legacy sourcing run could not verify contacts before the EnrichAnything-only migration.",
  },
  {
    pattern: /Exa sourcing failed:[^\n]*/gi,
    replacement: "Historical legacy sourcing failure from before the EnrichAnything-only migration.",
  },
  {
    pattern: /Exa API key is missing\.[^\n]*/gi,
    replacement:
      "Historical legacy sourcing could not run before the EnrichAnything-only migration.",
  },
];

const LEGACY_OUTREACH_FALLBACK = "Historical legacy sourcing failure from before the EnrichAnything-only migration.";

export function isLegacyOutreachErrorText(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (LEGACY_OUTREACH_ERROR_MAPPINGS.some(({ pattern }) => pattern.test(text))) {
    return true;
  }
  return /\bExa\b/i.test(text);
}

export function normalizeLegacyOutreachErrorText(value: unknown) {
  const original = String(value ?? "");
  if (!original.trim()) return "";

  let normalized = original;
  for (const { pattern, replacement } of LEGACY_OUTREACH_ERROR_MAPPINGS) {
    normalized = normalized.replace(pattern, replacement);
  }

  if (normalized !== original) {
    return normalized.trim();
  }

  if (/\bExa\b/i.test(original)) {
    return LEGACY_OUTREACH_FALLBACK;
  }

  return original.trim();
}

export function normalizeLegacyOutreachValue(value: unknown): unknown {
  if (typeof value === "string") {
    return normalizeLegacyOutreachErrorText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeLegacyOutreachValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        normalizeLegacyOutreachValue(entry),
      ])
    );
  }
  return value;
}
