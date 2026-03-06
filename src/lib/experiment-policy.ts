export const EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS = 200;
export const EXPERIMENT_MAX_SAMPLE_SIZE = 400;

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
