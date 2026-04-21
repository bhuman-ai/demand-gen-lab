function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDraft(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function stableIndex(seed: string, count: number) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % count;
}

function casualBrandAside(draft: string, brandName: string, seed = "") {
  const normalizedDraft = draft.toLowerCase();
  const candidates = [
    `That comes up at ${brandName} a lot`,
    `We run into that at ${brandName} too`,
    `Same pattern shows up at ${brandName}`,
    `That shows up on the ${brandName} side too`,
  ];

  if (
    /\b(infrastructure|deliverability|targeting|copy|outreach|sender|inbox|cold email|agency)\b/.test(
      normalizedDraft,
    )
  ) {
    candidates.push(
      `That tradeoff comes up at ${brandName} a lot`,
      `The ${brandName} side runs into that too`,
      `That infrastructure gap shows up at ${brandName} too`,
    );
  }

  if (/\b(video|personalized|personalization|ai|demo|recording|creative|scale)\b/.test(normalizedDraft)) {
    candidates.push(
      `That comes up on the video side at ${brandName} too`,
      `The ${brandName} side runs into that with video too`,
      `${brandName} runs into that same video problem too`,
    );
  }

  return candidates[stableIndex(`${draft}:${brandName}:${seed}`, candidates.length)];
}

function sanitizeAdLikeBrandMention(draft: string, brandName: string, maxLength: number, seed = "") {
  const casualAside = casualBrandAside(draft, brandName, seed);
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
  seed?: string;
}) {
  const draft = normalizeDraft(input.draft, input.maxLength);
  const brandName = commentBrandName(input.brandName);
  if (!draft || !brandName) return draft;

  const sanitizedDraft = sanitizeAdLikeBrandMention(draft, brandName, input.maxLength, input.seed);
  if (textMentionsBrand(sanitizedDraft, brandName)) return sanitizedDraft;

  const base = sanitizedDraft.replace(/[.!?,;:\s]+$/g, "");
  const variants = [
    casualBrandAside(base, brandName, input.seed),
    casualBrandAside(base, brandName, `${input.seed ?? ""}:second`),
    casualBrandAside(base, brandName, `${input.seed ?? ""}:third`),
  ];
  const candidates = Array.from(new Set(variants)).map((candidate) => `${candidate}.`);

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
