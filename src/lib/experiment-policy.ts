export const EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS = 20;
export const REPORT_COMMENT_MIN_VERIFIED_EMAIL_LEADS = 5;
export const EXPERIMENT_MAX_SAMPLE_SIZE = 400;
export const REPORT_COMMENT_EXPERIMENT_PREFIX = "Report comment outreach · ";

type ExperimentLeadTargetInput =
  | string
  | {
      name?: unknown;
    }
  | null
  | undefined;

function getExperimentName(input: ExperimentLeadTargetInput) {
  if (!input) return "";
  if (typeof input === "string") return input.trim();
  return String(input.name ?? "").trim();
}

export function isReportCommentExperiment(input: ExperimentLeadTargetInput) {
  return getExperimentName(input).startsWith(REPORT_COMMENT_EXPERIMENT_PREFIX);
}

export function getExperimentVerifiedEmailLeadTarget(input: ExperimentLeadTargetInput) {
  return isReportCommentExperiment(input)
    ? REPORT_COMMENT_MIN_VERIFIED_EMAIL_LEADS
    : EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS;
}

export function clampExperimentSampleSize(
  value: unknown,
  fallback = EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(
    EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS,
    Math.min(EXPERIMENT_MAX_SAMPLE_SIZE, Math.round(parsed))
  );
}
