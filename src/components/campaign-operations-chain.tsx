"use client";

import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  DeliverabilityHealthStatus,
  OutreachProvisioningSettings,
  ScaleCampaignRecord,
} from "@/lib/factory-types";
import { cn } from "@/lib/utils";

export type CampaignChainPlacement =
  | "inbox"
  | "spam"
  | "all_mail_only"
  | "not_found"
  | "checking"
  | "unknown";

type CampaignChainTone = "success" | "attention" | "pending" | "muted";

type CampaignChainStep = {
  id: "data" | "deliverability" | "offer_quality" | "replies";
  label: string;
  headline: string;
  detail: string;
  tone: CampaignChainTone;
};

type CampaignChainInput = {
  campaign: Pick<ScaleCampaignRecord, "status" | "snapshot" | "metricsSummary">;
  sourcedLeads?: number;
  placement?: CampaignChainPlacement;
  deliverability?: Pick<OutreachProvisioningSettings["deliverability"], "provider" | "lastHealthStatus"> | null;
};

function toneVariant(tone: CampaignChainTone) {
  if (tone === "success") return "success" as const;
  if (tone === "attention") return "danger" as const;
  if (tone === "pending") return "accent" as const;
  return "muted" as const;
}

function toneCardClassName(tone: CampaignChainTone) {
  if (tone === "success") {
    return "border-[color:var(--success-border)] bg-[color:var(--success-soft)]";
  }
  if (tone === "attention") {
    return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]";
  }
  if (tone === "pending") {
    return "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]";
  }
  return "border-[color:var(--border)] bg-[color:var(--surface-muted)]";
}

function toneDotClassName(tone: CampaignChainTone) {
  if (tone === "success") return "bg-[color:var(--success)]";
  if (tone === "attention") return "bg-[color:var(--danger)]";
  if (tone === "pending") return "bg-[color:var(--warning)]";
  return "bg-[color:var(--border-strong)]";
}

function toneMicroLabel(tone: CampaignChainTone) {
  if (tone === "success") return "Good";
  if (tone === "attention") return "Risk";
  if (tone === "pending") return "Watch";
  return "Idle";
}

function summarizeDeliverability(
  placement: CampaignChainPlacement,
  provider: OutreachProvisioningSettings["deliverability"]["provider"] | undefined,
  lastHealthStatus: DeliverabilityHealthStatus | undefined
) {
  if (placement === "inbox") {
    return {
      headline: "Inboxing",
      detail: "Latest placement probe reached Inbox.",
      tone: "success" as CampaignChainTone,
    };
  }
  if (placement === "spam") {
    return {
      headline: "Spam risk",
      detail: "Latest placement probe landed in spam.",
      tone: "attention" as CampaignChainTone,
    };
  }
  if (placement === "all_mail_only") {
    return {
      headline: "Missing inbox",
      detail: "Latest probe skipped Inbox and only reached All Mail.",
      tone: "attention" as CampaignChainTone,
    };
  }
  if (placement === "not_found") {
    return {
      headline: "Missing delivery",
      detail: "Latest placement probe was not found after polling.",
      tone: "attention" as CampaignChainTone,
    };
  }
  if (placement === "checking") {
    return {
      headline: "Checking now",
      detail: "Placement probe is still running.",
      tone: "pending" as CampaignChainTone,
    };
  }
  if (provider === "google_postmaster") {
    if (lastHealthStatus === "healthy") {
      return {
        headline: "Healthy",
        detail: "Google Postmaster reputation looks healthy.",
        tone: "success" as CampaignChainTone,
      };
    }
    if (lastHealthStatus === "warning") {
      return {
        headline: "Watch closely",
        detail: "Postmaster is showing a warning signal.",
        tone: "pending" as CampaignChainTone,
      };
    }
    if (lastHealthStatus === "critical") {
      return {
        headline: "At risk",
        detail: "Postmaster is reporting a critical signal.",
        tone: "attention" as CampaignChainTone,
      };
    }
    return {
      headline: "Connected",
      detail: "Deliverability monitor is connected but not checked yet.",
      tone: "pending" as CampaignChainTone,
    };
  }
  return {
    headline: "Not checked",
    detail: "No active deliverability monitor for this campaign yet.",
    tone: "muted" as CampaignChainTone,
  };
}

export function buildCampaignOperationsChain(input: CampaignChainInput): CampaignChainStep[] {
  const sourcedLeads = Math.max(0, input.sourcedLeads ?? 0);
  const sent = Math.max(0, input.campaign.metricsSummary.sent ?? 0);
  const replies = Math.max(0, input.campaign.metricsSummary.replies ?? 0);
  const positiveReplies = Math.max(0, input.campaign.metricsSummary.positiveReplies ?? 0);
  const hasOffer = Boolean(input.campaign.snapshot.offer.trim());
  const hasAudience = Boolean(input.campaign.snapshot.audience.trim());
  const hasPublishedFlow = input.campaign.snapshot.publishedRevision > 0;

  const dataStep: CampaignChainStep =
    sourcedLeads > 0
      ? {
          id: "data",
          label: "Data",
          headline: `${sourcedLeads} leads ready`,
          detail: "The campaign already has sourced leads to work from.",
          tone: "success",
        }
      : sent > 0
        ? {
            id: "data",
            label: "Data",
            headline: "Lead pool used",
            detail: `${sent} emails have already gone out from this campaign's sourced list.`,
            tone: "success",
          }
        : hasAudience
          ? {
              id: "data",
              label: "Data",
              headline: "Audience set",
              detail: "Targeting is defined, but no lead pool is loaded yet.",
              tone: "pending",
            }
          : {
              id: "data",
              label: "Data",
              headline: "Missing audience",
              detail: "The campaign does not have a usable data target yet.",
              tone: "attention",
            };

  const deliverabilitySummary = summarizeDeliverability(
    input.placement ?? "unknown",
    input.deliverability?.provider,
    input.deliverability?.lastHealthStatus
  );

  const offerStep: CampaignChainStep =
    positiveReplies > 0
      ? {
          id: "offer_quality",
          label: "Offer quality",
          headline: "Resonating",
          detail: `${positiveReplies} positive repl${positiveReplies === 1 ? "y is" : "ies are"} signaling offer fit.`,
          tone: "success",
        }
      : replies > 0
        ? {
            id: "offer_quality",
            label: "Offer quality",
            headline: "Getting signal",
            detail: `${replies} repl${replies === 1 ? "y has" : "ies have"} come in. Review the tone before scaling harder.`,
            tone: "pending",
          }
        : hasOffer && hasPublishedFlow
          ? {
              id: "offer_quality",
              label: "Offer quality",
              headline: "Ready to test",
              detail: "Offer copy and the live conversation flow are in place.",
              tone: "pending",
            }
          : {
              id: "offer_quality",
              label: "Offer quality",
              headline: "Not ready",
              detail: "The offer or the published flow still needs work.",
              tone: "attention",
            };

  const repliesStep: CampaignChainStep =
    positiveReplies > 0
      ? {
          id: "replies",
          label: "Replies / conversions",
          headline: `${positiveReplies} positive`,
          detail: `${replies} total repl${replies === 1 ? "y" : "ies"} so far from this campaign.`,
          tone: "success",
        }
      : replies > 0
        ? {
            id: "replies",
            label: "Replies / conversions",
            headline: `${replies} repl${replies === 1 ? "y" : "ies"}`,
            detail: "The campaign is generating conversations, but no positive conversion signal yet.",
            tone: "pending",
          }
        : sent > 0
          ? {
              id: "replies",
              label: "Replies / conversions",
              headline: "Waiting on signal",
              detail: `${sent} emails sent. Give the thread time to produce replies.`,
              tone: "pending",
            }
          : {
              id: "replies",
              label: "Replies / conversions",
              headline: "No reply signal",
              detail: "Nothing has gone out yet, so there are no reply or conversion signals.",
              tone: "muted",
            };

  return [
    dataStep,
    {
      id: "deliverability",
      label: "Deliverability",
      headline: deliverabilitySummary.headline,
      detail: deliverabilitySummary.detail,
      tone: deliverabilitySummary.tone,
    },
    offerStep,
    repliesStep,
  ];
}

export default function CampaignOperationsChain({
  steps,
  compact = false,
  onStepClick,
}: {
  steps: CampaignChainStep[];
  compact?: boolean;
  onStepClick?: (stepId: CampaignChainStep["id"]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className={cn("items-center gap-2 text-[12px] text-[color:var(--muted-foreground)]", compact ? "hidden" : "hidden md:flex")}>
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center gap-2">
            <span>{step.label}</span>
            {index < steps.length - 1 ? <ArrowRight className="h-3.5 w-3.5" /> : null}
          </div>
        ))}
      </div>
      <div className={cn("grid gap-3", compact ? "sm:grid-cols-2 xl:grid-cols-4" : "lg:grid-cols-4")}>
        {steps.map((step) => (
          <button
            key={step.id}
            type="button"
            onClick={onStepClick ? () => onStepClick(step.id) : undefined}
            className={cn(
              "rounded-[10px] border px-4 py-3 transition-colors",
              onStepClick
                ? "cursor-pointer text-left hover:border-[color:var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]/30"
                : "text-left",
              toneCardClassName(step.tone),
              compact ? "min-h-[140px]" : "min-h-[138px]"
            )}
            aria-label={onStepClick ? `Open ${step.label}` : undefined}
          >
            {compact ? (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[12px] text-[color:var(--muted-foreground)]">{step.label}</div>
                  <div className="inline-flex items-center gap-2 rounded-[8px] border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--muted-foreground)]">
                    <span className={cn("h-2 w-2 rounded-full", toneDotClassName(step.tone))} />
                    {toneMicroLabel(step.tone)}
                  </div>
                </div>
                <div className="mt-4 text-lg font-semibold leading-tight text-[color:var(--foreground)]">
                  {step.headline}
                </div>
                <div
                  className="mt-2 text-[13px] leading-6 text-[color:var(--muted-foreground)]"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {step.detail}
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[12px] text-[color:var(--muted-foreground)]">{step.label}</div>
                  <Badge variant={toneVariant(step.tone)}>{step.headline}</Badge>
                </div>
                <div className="mt-3 text-base font-semibold text-[color:var(--foreground)]">{step.headline}</div>
                <div className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">{step.detail}</div>
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
