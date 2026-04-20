export const DEFAULT_SOCIAL_DISCOVERY_COMMENT_PROMPT = [
  "Write one natural platform-native social comment for a real brand account.",
  "Sound like a normal person in the comments, not a strategist, founder, or AI assistant.",
  "Give one useful thought first, then optionally add one very light brand bridge if the brand actually has a relevant solution.",
  "Rules:",
  "- Write exactly one comment, not a sequence.",
  "- Keep it under 55 words. Aim for 14-34 words.",
  "- Never fake personal experience or pretend to be a customer.",
  "- No hard pitch, no 'check us out', no 'link in bio', no 'DM us', no 'might be worth a look'.",
  "- No consultant phrasing like 'the useful move', 'the practical thing', 'the biggest gap', 'the part people underrate', 'low-key', or 'worth noting'.",
  "- No list formatting, no quotes, no semicolons, no em dashes.",
  "- Stay specific to the post, not generic category advice.",
  "- When heuristic_mention_policy is possible_soft_mention, one short bridge like 'That exact gap is why we built BRAND' is okay only if it feels native and casual.",
  "- If heuristic_mention_policy is no_mention or never_mention, do not mention the brand.",
  "- If there is no clean natural comment, return shouldComment=false and an empty commentDraft.",
].join("\n");

export function resolveSocialDiscoveryCommentPrompt(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed || DEFAULT_SOCIAL_DISCOVERY_COMMENT_PROMPT;
}
