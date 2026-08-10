export type YouTubeCommentRole = "opening" | "reply";

export type YouTubeCommentStyleOptions = {
  allowFactualBrandContext?: boolean;
  disallowPersonalExperience?: boolean;
  maxCharacters?: number;
  maxWords?: number;
};

export const YOUTUBE_NATIVE_COMMENT_STYLE_RULES = [
  "YouTube-native voice rules:",
  "- Write like a viewer typing quickly, not a brand, marketer, consultant, or AI assistant.",
  "- Opening comment: usually 4 to 22 words, standard maximum 32 words and three short sentences.",
  "- Reply: usually 4 to 22 words, standard maximum 30 words and three short sentences.",
  "- When campaign instructions require a specific question or one or two factual capability details, preserve every requested detail and stay within the campaign-specific limit instead of replacing it with generic copy.",
  "- Start with the reaction. Skip polite setup, explanation, summary, lesson, and conclusion.",
  "- Stay on one conversational thread. A quick topic reaction, one personal aside, and a genuine question can coexist.",
  "- Use natural capitalization. Capitalize the opening word, standalone 'I', and the first word after a sentence-ending period, question mark, or exclamation point.",
  "- Contractions, light slang, and an occasional emoji are okay when they fit. Never force all-lowercase text, typos, slang, or emoji.",
  "- Do not use semicolons, headings, bullets, marketing language, or polished bridge phrases.",
  "- Avoid AI-sounding openings such as 'Really appreciated the point', 'This is spot on', 'What really stood out', and 'It makes sense that'.",
  "- Avoid salesy phrases such as 'tools like', 'game changer', 'valuable insights', 'great breakdown', and 'if you are serious about'.",
  "- If a brand is required, make it a minor aside rather than the point. Start with the broader topic, then disclose the affiliation naturally.",
  "- Never directly recommend the brand, claim results, or claim superiority. Only explain a factual capability when the campaign instructions explicitly request it, and keep it to one short clause after disclosing the affiliation.",
  "- Texture examples only, do not copy: '3 hours is wild lol', 'seo feels rough lately. I work on [brand] and even we see weird results. Anyone else?', 'wait does that actually work?'.",
].join("\n");

const FORMAL_OR_SALESY_PATTERNS: Array<{
  allowWithFactualBrandContext?: boolean;
  label: string;
  pattern: RegExp;
}> = [
  { label: "formal appreciation opener", pattern: /^(?:i\s+)?really appreciated\b/i },
  { label: "polished agreement opener", pattern: /^this is spot on\b/i },
  { label: "polished takeaway opener", pattern: /^(?:the (?:part|point) about|what really stood out)\b/i },
  { label: "essay transition", pattern: /\bit makes sense that\b/i },
  { label: "consultant framing", pattern: /\bthe gap between\b/i },
  { label: "sales qualification", pattern: /\bif you(?:'re| are) serious about\b/i },
  { label: "salesy tool bridge", pattern: /\btools like\b/i },
  { label: "marketing cliché", pattern: /\b(?:game[ -]?changer|valuable insights?|great breakdown)\b/i },
  { label: "marketing cliché", pattern: /\bchanges everything\b/i },
  { label: "brand-copy rationale", pattern: /\bthis is exactly why we\b/i },
  { allowWithFactualBrandContext: true, label: "product pitch", pattern: /\bwe (?:focus on|help|enable|empower|provide|offer)\b/i },
  { allowWithFactualBrandContext: true, label: "product pitch", pattern: /\b(?:verifies?|helps? (?:you|people|teams|brands)|makes? it (?:easy|easier))\b/i },
  { label: "direct recommendation", pattern: /\b(?:i(?:'d| would) recommend|you should (?:try|use|check)|check (?:it|them) out|give (?:it|them) a try|worth (?:trying|checking))\b/i },
  { label: "testimonial pitch", pattern: /\b(?:works? (?:great|really well)|has been (?:great|amazing|solid)|good things with)\b/i },
  { label: "product jargon", pattern: /\bverified recommendations?\b/i },
  { label: "competitive product claim", pattern: /\b(?:recommendations?|platform|tool|product|service)\s+(?:beats?|outperforms?|wins? over)\b/i },
  { label: "canned brand proof", pattern: /\bwe (?:see|hear) this (?:constantly|all the time|a lot)\b/i },
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

export function youtubeCommentStyleProblem(
  value: unknown,
  role: YouTubeCommentRole,
  options: YouTubeCommentStyleOptions = {}
) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return `${role} is empty`;

  const words = wordCount(text);
  const maxWords = options.maxWords ?? (role === "opening" ? 32 : 30);
  const maxCharacters = options.maxCharacters ?? (role === "opening" ? 220 : 200);
  if (words > maxWords) return `${role} has ${words} words; maximum is ${maxWords}`;
  if (text.length > maxCharacters) {
    return `${role} has ${text.length} characters; maximum is ${maxCharacters}`;
  }
  if (sentenceCount(text) > 3) return `${role} has more than three sentences`;
  if (/[;:]/.test(text)) return `${role} uses formal punctuation`;
  if (/^[\s\"'([{]*[a-z]/.test(text)) return `${role} begins with lowercase text`;
  if (/\bi\b/.test(text)) return `${role} uses lowercase standalone I`;
  if (/[.!?]\s+[a-z]/.test(text)) return `${role} starts a new sentence with lowercase text`;
  if (
    options.disallowPersonalExperience &&
    /\b(?:same problem here|same issue here|i (?:had|have had|ran into|dealt with|struggled with) (?:this|that|the same)(?: problem| issue)?|i(?:'ve| have) (?:used|tried|tested)\b)/i.test(text)
  ) {
    return `${role} invents personal or customer experience`;
  }

  const formalPattern = FORMAL_OR_SALESY_PATTERNS.find(
    ({ allowWithFactualBrandContext, pattern }) =>
      pattern.test(text) && !(allowWithFactualBrandContext && options.allowFactualBrandContext)
  );
  if (formalPattern) return `${role} uses ${formalPattern.label}`;
  return "";
}

export function youtubeRequestedCapabilityProblem(instructions: unknown, value: unknown) {
  const prompt = String(instructions ?? "").replace(/\s+/g, " ").trim();
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!prompt || !text) return "";

  const requirements = [
    {
      label: "the requested fresh-eyes answer",
      requested: /\bfresh eyes\b/i.test(prompt),
      present: /\bfresh eyes\b/i.test(text),
    },
    {
      label: "the requested AI customer-persona QA capability",
      requested: /\bAI\b/i.test(prompt) && /\b(?:persona|customer)\b/i.test(prompt),
      present: /\bAI\b/i.test(text) && /\b(?:persona|customer)\b/i.test(text),
    },
    {
      label: "the requested human-testing capability",
      requested: /\bhuman\b/i.test(prompt) && /\btest(?:s|ed|er|ers|ing)?\b/i.test(prompt),
      present: /\bhuman\b/i.test(text) && /\btest(?:s|ed|er|ers|ing)?\b/i.test(text),
    },
    {
      label: "the requested test recordings",
      requested: /\brecordings?\b/i.test(prompt),
      present: /\brecordings?\b/i.test(text),
    },
    {
      label: "the requested fixes",
      requested: /\bfix(?:es|ed|ing)?\b/i.test(prompt),
      present: /\bfix(?:es|ed|ing)?\b/i.test(text),
    },
    {
      label: "the requested Codex or Claude handoff",
      requested: /\b(?:Codex|Claude)\b/i.test(prompt),
      present: /\b(?:Codex|Claude)\b/i.test(text),
    },
  ];
  const missing = requirements.find((requirement) => requirement.requested && !requirement.present);
  return missing ? `reply omits ${missing.label}` : "";
}

export function normalizeYouTubeCommentCapitalization(value: unknown) {
  return String(value ?? "")
    .replace(/^(\s*[\"'([{]*)([a-z])/, (_match, prefix: string, letter: string) =>
      `${prefix}${letter.toUpperCase()}`
    )
    .replace(/\bi\b/g, "I")
    .replace(/([.!?]\s+)([a-z])/g, (_match, boundary: string, letter: string) =>
      `${boundary}${letter.toUpperCase()}`
    );
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

export function youtubeExactBrandMentionProblem(value: unknown, brandName: string) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const brand = String(brandName ?? "").replace(/\s+/g, " ").trim();
  if (!brand) return "brand name is empty";
  if (new RegExp(`\\b${escapeRegExp(brand)}\\b`, "i").test(text)) return "";
  return `does not mention ${brand} exactly`;
}

export function youtubeBrandIsIncidentalProblem(value: unknown, brandName: string) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const brand = String(brandName ?? "").replace(/\s+/g, " ").trim();
  if (!text || !brand) return "";
  const match = new RegExp(`\\b${escapeRegExp(brand)}\\b`, "i").exec(text);
  if (!match) return "";
  if (wordCount(text.slice(0, match.index)) < 4) {
    return `puts ${brand} before the broader topic`;
  }
  return "";
}
