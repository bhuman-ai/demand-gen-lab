export type TelemetryEvent =
  | "brand_created"
  | "brand_switched"
  | "campaign_created"
  | "campaign_viewed"
  | "campaign_scale_updated"
  | "campaign_launched"
  | "build_viewed"
  | "run_viewed"
  | "run_tab_opened"
  | "campaign_step_viewed"
  | "campaign_step_completed"
  | "campaign_saved"
  | "experiment_created"
  | "experiment_viewed"
  | "experiment_saved"
  | "experiment_launched"
  | "experiment_promote_suggested"
  | "experiment_promoted_manual"
  | "route_replaced_viewed"
  | "ops_module_opened"
  | "nav_backtrack"
  | "generation_error"
  | "outreach_account_connected"
  | "outreach_account_tested"
  | "hypothesis_approved_auto_run_queued"
  | "run_started"
  | "run_paused_auto"
  | "run_resumed_manual"
  | "lead_sourced_apify"
  | "message_scheduled"
  | "message_sent"
  | "message_bounced"
  | "reply_ingested"
  | "reply_draft_created"
  | "reply_draft_sent"
  | "outreach_anomaly_detected";

export async function trackEvent(event: TelemetryEvent, payload: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  try {
    const body = JSON.stringify({ event, payload });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/telemetry", blob);
      return;
    }
    await fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    // intentionally silent
  }
}
