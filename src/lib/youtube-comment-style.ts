export type YouTubeCommentRole = "opening" | "reply";

export const YOUTUBE_NATIVE_COMMENT_STYLE_RULES = [
  "YouTube-native voice rules:",
  "- Write like a viewer typing quickly, not a brand, marketer, consultant, or AI assistant.",
  "- Opening comment: usually 4 to 18 words, hard maximum 28 words and two short sentences.",
  "- Reply: usually 3 to 14 words, hard maximum 20 words and two short sentences.",
  "- Start with the reaction. Skip polite setup, explanation, summary, lesson, and conclusion.",
  "- Use one thought only. Do not combine praise, recap, insight, question, and recommendation.",
  "- Contractions, lowercase, light slang, and an occasional emoji are okay when they fit. Never force typos, slang, or emoji.",
  "- Do not use semicolons, headings, bullets, marketing language, or polished bridge phrases.",
  "- Avoid AI-sounding openings such as 'Really appreciated the point', 'This is spot on', 'What really stood out', and 'It makes sense that'.",
  "- Avoid salesy phrases such as 'tools like', 'game changer', 'valuable insights', 'great breakdown', and 'if you are serious about'.",
  "- Texture examples only, do not copy: '3 hours is wild lol', 'wait does that actually work?', 'that testing point got me', 'appreciate this'.",
].join("\n");

const FORMAL_OR_SALESY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "formal appreciation opener", pattern: /^(?:i\s+)?really appreciated\b/i },
  { label: "polished agreement opener", pattern: /^this is spot on\b/i },
  { label: "polished takeaway opener", pattern: /^(?:the (?:part|point) about|what really stood out)\b/i },
  { label: "essay transition", pattern: /\bit makes sense that\b/i },
  { label: "consultant framing", pattern: /\bthe gap between\b/i },
  { label: "sales qualification", pattern: /\bif you(?:'re| are) serious about\b/i },
  { label: "salesy tool bridge", pattern: /\btools like\b/i },
  { label: "marketing cliché", pattern: /\b(?:game[ -]?changer|valuable insights?|great breakdown)\b/i },
];

function wordCount(value: string) {
  return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function sentenceCount(value: string) {
  const clauses = value
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return Math.max(clauses.length, value.trim() ? 1 : 0);
}

export function youtubeCommentStyleProblem(value: unknown, role: YouTubeCommentRole) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return `${role} is empty`;

  const words = wordCount(text);
  const maxWords = role === "opening" ? 28 : 20;
  const maxCharacters = role === "opening" ? 180 : 150;
  if (words > maxWords) return `${role} has ${words} words; maximum is ${maxWords}`;
  if (text.length > maxCharacters) {
    return `${role} has ${text.length} characters; maximum is ${maxCharacters}`;
  }
  if (sentenceCount(text) > 2) return `${role} has more than two sentences`;
  if (/[;:]/.test(text)) return `${role} uses formal punctuation`;

  const formalPattern = FORMAL_OR_SALESY_PATTERNS.find(({ pattern }) => pattern.test(text));
  if (formalPattern) return `${role} uses ${formalPattern.label}`;
  return "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function youtubeBrandAffiliationProblem(value: unknown, brandName: string) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const brand = String(brandName ?? "").replace(/\s+/g, " ").trim();
  if (!text || !brand || !new RegExp(`\\b${escapeRegExp(brand)}\\b`, "i").test(text)) return "";
  if (
    /\b(?:i work (?:on|at|with)|i'm (?:on|with)|i am (?:on|with)|we (?:built|make|run|work on)|we're (?:behind|the team)|we are (?:behind|the team)|our team)\b/i.test(
      text
    )
  ) {
    return "";
  }
  return `mentions ${brand} without plainly identifying the affiliation`;
}
