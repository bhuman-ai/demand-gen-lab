const FORBIDDEN_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  // Users should never see internal provider names or implementation terms in generated text.
  { pattern: /\bapify\b/gi, replacement: "lead sourcing" },
  { pattern: /apify\/[a-z0-9_-]+/gi, replacement: "lead sourcing" },
  { pattern: /\bactor\b/gi, replacement: "source" },
  { pattern: /\bactors\b/gi, replacement: "sources" },
];

export function sanitizeAiText(value: string) {
  let next = String(value ?? "");
  for (const rule of FORBIDDEN_REPLACEMENTS) {
    next = next.replace(rule.pattern, rule.replacement);
  }
  // Trim excessive whitespace introduced by replacements.
  next = next.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return next;
}

