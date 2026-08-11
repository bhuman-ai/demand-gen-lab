function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalized(value: unknown) {
  return String(value ?? "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function forbidsInventedBrandExperience(campaignInstructions: string) {
  return /\b(?:do not|don't|never|avoid)\b[^.!?\n]{0,180}\b(?:claim[^.!?\n]{0,80}\buse|invent[^.!?\n]{0,80}\bexperience|personal experience|pretend[^.!?\n]{0,80}\buse|say[^.!?\n]{0,80}\buse)\b/i.test(
    normalized(campaignInstructions)
  );
}

function claimsFirstPersonBrandExperience(draft: string, brandName: string) {
  const brandPattern = new RegExp(`\\b${escapeRegExp(normalized(brandName))}\\b`, "i");
  const explicitFirstPersonUse = /\b(?:i|i've|i have|we|we've|we have)\b[^.!?\n]{0,100}\b(?:use|using|used|tried|trying|love|recommend|switched to|signed up for|started using|been using)\b/i;
  const impliedFirstPersonUse = /\b(?:been using|started using|switched to|signed up for)\b/i;
  const teamUse = /\bour\s+(?:team|agency|company|business)\b[^.!?\n]{0,100}\b(?:use|uses|using|used|tried|recommends?)\b/i;

  return normalized(draft)
    .split(/(?<=[.!?])\s+|\n+/)
    .some((sentence) =>
      brandPattern.test(sentence) &&
      (explicitFirstPersonUse.test(sentence) || impliedFirstPersonUse.test(sentence) || teamUse.test(sentence))
    );
}

export function tapInCopyFidelityProblem(input: {
  campaignInstructions: string;
  brandName: string;
  commentDraft: string;
  replyDraft?: string;
}) {
  if (!forbidsInventedBrandExperience(input.campaignInstructions)) return "";
  const combined = [input.commentDraft, input.replyDraft].filter(Boolean).join("\n");
  return claimsFirstPersonBrandExperience(combined, input.brandName)
    ? `invented first-person ${normalized(input.brandName) || "brand"} experience`
    : "";
}
