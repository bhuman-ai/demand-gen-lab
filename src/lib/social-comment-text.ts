export const SOCIAL_COMMENT_PUNCTUATION_RULE =
  "Never use em dashes or en dashes. Use a comma, period, parentheses, or the word 'to' instead.";

const NUMERIC_LONG_DASH = /(\d)\s*(?:&mdash;|&ndash;|[\u2012-\u2015\u2e3a\u2e3b])\s*(\d)/gi;
const LONG_DASH = /(?:&mdash;|&ndash;|[\u2012-\u2015\u2e3a\u2e3b])/gi;

export function sanitizeSocialCommentText(value: unknown) {
  return String(value ?? "")
    .replace(NUMERIC_LONG_DASH, "$1 to $2")
    .replace(/\s*(&mdash;|&ndash;|[\u2012-\u2015\u2e3a\u2e3b])\s*/gi, ", ")
    .replace(/\s+,/g, ",")
    .replace(/([,.;:!?])\s*,\s*/g, "$1 ")
    .replace(/,\s*([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function containsLongDash(value: unknown) {
  const text = String(value ?? "");
  NUMERIC_LONG_DASH.lastIndex = 0;
  LONG_DASH.lastIndex = 0;
  return NUMERIC_LONG_DASH.test(text) || LONG_DASH.test(text);
}
