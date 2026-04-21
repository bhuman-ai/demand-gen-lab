function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDraft(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeAdLikeBrandMention(draft: string, brandName: string, maxLength: number) {
  const casualAside = `We see the same at ${brandName} too`;
  const brandPattern = escapeRegExp(brandName);
  const patterns = [
    new RegExp(`That exact gap is why ${brandPattern} exists\\.?`, "ig"),
    new RegExp(`That exact gap is why we built ${brandPattern}\\.?`, "ig"),
    new RegExp(`${brandPattern} fits that same shift[^.?!]*`, "ig"),
    new RegExp(`${brandPattern}[^.?!]*(?:without going fully manual|fits this shift|exists for this)[^.?!]*`, "ig"),
  ];

  let next = draft;
  for (const pattern of patterns) {
    next = next.replace(pattern, casualAside);
  }

  return next
    .replace(/\s+/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim()
    .slice(0, maxLength);
}

export function commentBrandName(value: unknown) {
  const trimmed = String(value ?? "").replace(/\s+/g, " ").trim();
  const shortName = trimmed.split("|")[0]?.replace(/\s+[-–—]\s+.*$/u, "").trim() || trimmed;
  return shortName.slice(0, 80);
}

export function textMentionsBrand(text: string, brandName: string) {
  const normalizedBrand = brandName.trim();
  if (!normalizedBrand) return false;
  return new RegExp(`\\b${escapeRegExp(normalizedBrand)}\\b`, "i").test(text);
}

export function ensureCasualBrandMention(input: {
  draft: string;
  brandName: string;
  maxLength: number;
}) {
  const draft = normalizeDraft(input.draft, input.maxLength);
  const brandName = commentBrandName(input.brandName);
  if (!draft || !brandName) return draft;

  const sanitizedDraft = sanitizeAdLikeBrandMention(draft, brandName, input.maxLength);
  if (textMentionsBrand(sanitizedDraft, brandName)) return sanitizedDraft;

  const base = sanitizedDraft.replace(/[.!?,;:\s]+$/g, "");
  const candidates = [
    `We see the same at ${brandName} too.`,
    `Same thing on our side at ${brandName} too.`,
    `We see that a lot at ${brandName} too.`,
  ];

  for (const candidate of candidates) {
    const next = [base, candidate].filter(Boolean).join(". ");
    if (next.length <= input.maxLength) return next;
  }

  for (const candidate of candidates) {
    const baseMax = Math.max(0, input.maxLength - candidate.length - 2);
    const truncatedBase = base.slice(0, baseMax).replace(/[.!?,;:\s]+$/g, "");
    const next = [truncatedBase, candidate].filter(Boolean).join(". ");
    if (next.length <= input.maxLength) return next;
  }

  return draft;
}
