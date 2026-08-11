import { YOUTUBE_NATIVE_COMMENT_STYLE_RULES } from "@/lib/youtube-comment-style";

export const TAPIN_SYSTEM_COPY_RULE =
  "Never use em dashes. Use commas, periods, or parentheses instead.";

export const TAPIN_GENERATION_SYSTEM_PROMPT = [
  TAPIN_SYSTEM_COPY_RULE,
  YOUTUBE_NATIVE_COMMENT_STYLE_RULES,
].join("\n\n");

export function applyTapInSystemCopyRule(value: unknown) {
  return String(value ?? "")
    .replace(/\s*—\s*/g, ", ")
    .trim();
}
