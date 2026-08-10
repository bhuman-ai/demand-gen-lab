export const TAPIN_SYSTEM_COPY_RULE =
  "Never use em dashes. Use commas, periods, or parentheses instead.";

export function applyTapInSystemCopyRule(value: unknown) {
  return String(value ?? "")
    .replace(/\s*—\s*/g, ", ")
    .trim();
}
