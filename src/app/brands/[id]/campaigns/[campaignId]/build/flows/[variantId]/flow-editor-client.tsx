"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Hand,
  LayoutGrid,
  Loader2,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Target,
  Trash2,
  Upload,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { SettingsModal } from "@/app/settings/outreach/settings-primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchBrand,
  fetchBuildView,
  fetchCampaign,
  fetchConversationMapApi,
  fetchConversationPreviewLeadsApi,
  publishConversationMapApi,
  probeConversationMapApi,
  previewConversationNodeApi,
  saveConversationMapDraftApi,
  suggestConversationMapApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type {
  ConversationFlowEdge,
  ConversationFlowGraph,
  ConversationFlowNode,
  ConversationMapEditorState,
  ConversationMap,
  ConversationPreviewLead,
  ConversationProbeResult,
} from "@/lib/factory-types";

const NODE_WIDTH = 340;
const NODE_HEIGHT = 220;
const CANVAS_MIN_HEIGHT = 760;
const GRID_X = 460;
const GRID_Y = 300;
const LEGACY_SPREAD_SCALE_X = 1.3;
const LEGACY_SPREAD_SCALE_Y = 1.45;
const LEGACY_LAYOUT_PADDING = 120;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.8;
const WHEEL_ZOOM_SENSITIVITY = 0.0009;
const MAX_WHEEL_ZOOM_STEP = 0.025;
const BUTTON_ZOOM_STEP = 0.04;
const ZOOM_EASING = 0.22;
const ROLEPLAY_PASSING_SCORE = 75;
const ROLEPLAY_CANDIDATES = [
  { id: "cand_1", title: "Personalized Hook", score: 84 },
  { id: "cand_2", title: "Pain-Led Opener", score: 62 },
  { id: "cand_3", title: "Offer-First Ask", score: 79 },
  { id: "cand_4", title: "Trigger + Proof", score: 68 },
  { id: "cand_5", title: "Use-Case Teardown", score: 87 },
  { id: "cand_6", title: "Objection-First", score: 71 },
];
const ROLEPLAY_PHASES = [
  "Generating candidate flow ideas",
  "Roleplaying busy and skeptical personas",
  "Scoring clarity, reply likelihood, and risk",
  "Rejecting weak variants and selecting winner",
];
const DEFAULT_REPLY_TIMING = {
  minimumDelayMinutes: 40,
  randomAdditionalDelayMinutes: 20,
};
const DEFAULT_WORKING_HOURS: ConversationMapEditorState["workingHours"] = {
  timezone: "America/Los_Angeles",
  businessHoursEnabled: true,
  businessHoursStartHour: 9,
  businessHoursEndHour: 17,
  businessDays: [1, 2, 3, 4, 5],
};
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Viewport = {
  x: number;
  y: number;
  scale: number;
};

type DragState = {
  nodeId: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
};

type PanState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type ConnectState = {
  fromNodeId: string;
  pointerId: number;
};

const makeNodeId = () => `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const makeEdgeId = () => `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function defaultMessagePromptTemplate(title: string) {
  const safeTitle = title.trim() || "Message";
  return [
    `Write outbound email copy for node "${safeTitle}".`,
    "Goal: earn a clear positive reply and continue the thread.",
    "Keep it concrete, specific, and easy to understand.",
    "Use plain language. Avoid buzzwords and filler.",
    "Use variables only when available: {{firstName}}, {{company}}, {{leadTitle}}, {{brandName}}, {{campaignGoal}}, {{variantName}}, {{replyPreview}}, {{shortAnswer}}.",
    "Never output unresolved placeholders.",
    "End with one low-friction CTA sentence (yes/no preferred).",
  ].join("\n");
}

function defaultFollowUpPromptTemplate(title: string) {
  const safeTitle = title.trim() || "Follow-up";
  return [
    `Write outbound email copy for node "${safeTitle}".`,
    "Context: this is a no-reply follow-up branch after the previous email got no response.",
    "Do not imply the recipient replied.",
    "Keep it lower-pressure and shorter than the previous email.",
    "Use plain language. Avoid filler, buzzwords, and robotic follow-up phrasing.",
    "Use variables only when available: {{firstName}}, {{company}}, {{leadTitle}}, {{brandName}}, {{campaignGoal}}, {{variantName}}, {{replyPreview}}, {{shortAnswer}}.",
    "Never output unresolved placeholders.",
    "End with one low-friction CTA sentence.",
  ].join("\n");
}

function followUpTitle(sourceTitle: string) {
  const trimmed = sourceTitle.trim();
  if (!trimmed) return "Follow-up";
  if (/follow-up/i.test(trimmed)) return trimmed;
  return `${trimmed} follow-up`;
}

function defaultNode(kind: "message" | "terminal" = "message", x = 80, y = 160): ConversationFlowNode {
  const subject = kind === "terminal" ? "" : "Follow-up";
  const body = kind === "terminal" ? "" : "Hi {{firstName}},\n\nFollowing up on {{brandName}}.";
  return {
    id: makeNodeId(),
    kind,
    title: kind === "terminal" ? "End" : "Message",
    copyMode: "prompt_v1",
    promptTemplate:
      kind === "terminal"
        ? ""
        : defaultMessagePromptTemplate("Message"),
    promptVersion: 1,
    promptPolicy: {
      subjectMaxWords: 0,
      bodyMaxWords: 0,
      exactlyOneCta: false,
    },
    subject,
    body,
    autoSend: kind === "message",
    delayMinutes: 0,
    x,
    y,
  };
}

function createFollowUpNode(source: ConversationFlowNode, x: number, y: number): ConversationFlowNode {
  const title = followUpTitle(source.title);
  return {
    id: makeNodeId(),
    kind: "message",
    title,
    copyMode: "prompt_v1",
    promptTemplate: defaultFollowUpPromptTemplate(title),
    promptVersion: 1,
    promptPolicy: {
      subjectMaxWords: 0,
      bodyMaxWords: 0,
      exactlyOneCta: false,
    },
    subject: "Following up",
    body: "Hi {{firstName}},\n\nFollowing up on my note about {{brandName}}.",
    autoSend: true,
    delayMinutes: 0,
    x,
    y,
  };
}

function formatWaitMinutes(value: number) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  if (minutes === 0) return "immediately";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function formatDelayRange(minimumDelayMinutes: number, randomAdditionalDelayMinutes: number) {
  const min = Math.max(0, Math.round(Number(minimumDelayMinutes) || 0));
  const extra = Math.max(0, Math.round(Number(randomAdditionalDelayMinutes) || 0));
  if (extra <= 0) return formatWaitMinutes(min);
  const max = min + extra;
  return `${formatWaitMinutes(min)} to ${formatWaitMinutes(max)}`;
}

function formatBusinessDays(days: number[]) {
  const normalized = Array.from(new Set(days.map((value) => Math.round(Number(value)))))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 6)
    .sort((a, b) => a - b);
  if (!normalized.length || normalized.length === 7) return "Every day";
  if (normalized.join(",") === "1,2,3,4,5") return "Mon-Fri";
  return normalized.map((day) => WEEKDAY_LABELS[day] || `Day ${day}`).join(", ");
}

function nodesNeedSpacing(nodes: ConversationFlowNode[]) {
  const padding = 18;
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    const ax1 = a.x - padding;
    const ay1 = a.y - padding;
    const ax2 = a.x + NODE_WIDTH + padding;
    const ay2 = a.y + NODE_HEIGHT + padding;
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      const bx1 = b.x - padding;
      const by1 = b.y - padding;
      const bx2 = b.x + NODE_WIDTH + padding;
      const by2 = b.y + NODE_HEIGHT + padding;
      const overlaps = ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
      if (overlaps) return true;
    }
  }
  return false;
}

function spreadLegacyLayout(nodes: ConversationFlowNode[]) {
  if (!nodes.length) return nodes;
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  return nodes.map((node) => ({
    ...node,
    x: LEGACY_LAYOUT_PADDING + (node.x - minX) * LEGACY_SPREAD_SCALE_X,
    y: LEGACY_LAYOUT_PADDING + (node.y - minY) * LEGACY_SPREAD_SCALE_Y,
  }));
}

function withLayout(graph: ConversationFlowGraph): ConversationFlowGraph {
  const hasPlacedNode = graph.nodes.some((node) => Number.isFinite(node.x) && Number.isFinite(node.y) && (node.x !== 0 || node.y !== 0));
  if (hasPlacedNode) {
    const normalizedNodes = graph.nodes.map((node) => ({
      ...node,
      x: Number.isFinite(node.x) ? node.x : 0,
      y: Number.isFinite(node.y) ? node.y : 0,
    }));
    return {
      ...graph,
      nodes: nodesNeedSpacing(normalizedNodes) ? spreadLegacyLayout(normalizedNodes) : normalizedNodes,
    };
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node, index) => {
      const col = Math.floor(index / 3);
      const row = index % 3;
      return {
        ...node,
        x: 80 + col * GRID_X,
        y: 80 + row * GRID_Y,
      };
    }),
  };
}

function withReplyTimingDefaults(graph: ConversationFlowGraph): ConversationFlowGraph {
  return {
    ...graph,
    replyTiming: {
      minimumDelayMinutes: Math.max(
        0,
        Math.min(10080, Math.round(Number(graph.replyTiming?.minimumDelayMinutes ?? DEFAULT_REPLY_TIMING.minimumDelayMinutes) || DEFAULT_REPLY_TIMING.minimumDelayMinutes))
      ),
      randomAdditionalDelayMinutes: Math.max(
        0,
        Math.min(
          1440,
          Math.round(
            Number(
              graph.replyTiming?.randomAdditionalDelayMinutes ??
                DEFAULT_REPLY_TIMING.randomAdditionalDelayMinutes
            ) || DEFAULT_REPLY_TIMING.randomAdditionalDelayMinutes
          )
        )
      ),
    },
  };
}

function autoLayout(graph: ConversationFlowGraph): ConversationFlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node, index) => {
      const col = Math.floor(index / 3);
      const row = index % 3;
      return {
        ...node,
        x: 80 + col * GRID_X,
        y: 80 + row * GRID_Y,
      };
    }),
  };
}

function withoutPreviewLeadState(graph: ConversationFlowGraph): ConversationFlowGraph {
  return {
    ...graph,
    previewLeads: [],
    previewLeadId: "",
  };
}

function nodeById(graph: ConversationFlowGraph | null, nodeId: string) {
  if (!graph) return null;
  return graph.nodes.find((node) => node.id === nodeId) ?? null;
}

function edgeById(graph: ConversationFlowGraph | null, edgeId: string) {
  if (!graph) return null;
  return graph.edges.find((edge) => edge.id === edgeId) ?? null;
}

function bezierPath(fromX: number, fromY: number, toX: number, toY: number) {
  const curve = Math.max(120, Math.abs(toX - fromX) * 0.45);
  return `M ${fromX} ${fromY} C ${fromX + curve} ${fromY}, ${toX - curve} ${toY}, ${toX} ${toY}`;
}

function edgeLabel(edge: ConversationFlowEdge) {
  if (edge.trigger === "intent") {
    switch (edge.intent) {
      case "question":
        return "Asked for more info";
      case "interest":
        return "Interested";
      case "objection":
        return "Not now";
      case "unsubscribe":
        return "Negative response";
      case "other":
        return "Wrong person";
      default:
        return "No reply";
    }
  }
  if (edge.trigger === "timer") return `Wait ${formatWaitMinutes(edge.waitMinutes)}`;
  return "No reply";
}

function probeOutcomeBadgeVariant(outcome: ConversationProbeResult["scenarios"][number]["outcome"]) {
  if (outcome === "auto_reply" || outcome === "completed" || outcome === "timer_follow_up") {
    return "success" as const;
  }
  if (outcome === "manual_review") {
    return "accent" as const;
  }
  if (outcome === "no_reply") {
    return "muted" as const;
  }
  return "danger" as const;
}

function probeOutcomeLabel(outcome: ConversationProbeResult["scenarios"][number]["outcome"]) {
  switch (outcome) {
    case "auto_reply":
      return "Auto reply";
    case "manual_review":
      return "Manual review";
    case "no_reply":
      return "No reply";
    case "timer_follow_up":
      return "Timer follow-up";
    case "completed":
      return "Completed";
    default:
      return "Stalled";
  }
}

function promptSnippet(value: string, max = 180) {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (!oneLine) return "Prompt not set";
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function RoleplayScreeningLoader({
  tick,
  variantName,
  compact = false,
}: {
  tick: number;
  variantName: string;
  compact?: boolean;
}) {
  const cycleTick = tick % 64;
  const phaseIndex = Math.min(ROLEPLAY_PHASES.length - 1, Math.floor(cycleTick / 4));
  const phaseLabel = ROLEPLAY_PHASES[phaseIndex] || ROLEPLAY_PHASES[0];
  const scoredCount = Math.min(ROLEPLAY_CANDIDATES.length, Math.floor(cycleTick / 2));
  const scoringIndex = cycleTick % 2 === 1 && scoredCount < ROLEPLAY_CANDIDATES.length ? scoredCount : -1;
  const winnerIndex = ROLEPLAY_CANDIDATES.reduce((best, row, index, array) =>
    row.score > array[best].score ? index : best
  , 0);
  const progress = Math.min(100, Math.round((cycleTick / 24) * 100));

  return (
    <div
      className={[
        "rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)]",
        compact ? "w-full max-w-2xl p-4" : "p-5",
      ].join(" ")}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
            <Sparkles className="h-4 w-4 text-[color:var(--accent)]" />
            Roleplay Screening In Progress
          </div>
          <div className="truncate text-sm text-[color:var(--muted-foreground)]">
            {variantName || "Variant"} - {phaseLabel}
          </div>
        </div>
        <div className="flex items-center gap-1 text-sm text-[color:var(--accent)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {progress}%
        </div>
      </div>

      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-[999px] bg-[color:var(--border)]">
        <div
          className="h-full rounded-[999px] bg-[color:var(--accent)] transition-all duration-500 ease-out"
          style={{ width: `${Math.max(8, progress)}%` }}
        />
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {ROLEPLAY_CANDIDATES.map((candidate, index) => {
          const isScoring = index === scoringIndex;
          const isScored = index < scoredCount && !isScoring;
          const isAccepted = isScored && candidate.score >= ROLEPLAY_PASSING_SCORE;
          const stateLabel = isScoring
            ? "scoring"
            : isScored
              ? isAccepted
                ? "accepted"
                : "rejected"
              : "queued";

          return (
            <div
              key={candidate.id}
              className={[
                "rounded-xl border px-3 py-2 transition-all duration-300",
                isScoring
                  ? "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] animate-pulse"
                  : isAccepted
                    ? "border-[color:var(--success-border)] bg-[color:var(--success-soft)]"
                    : isScored
                      ? "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)]",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm font-medium text-[color:var(--foreground)]">
                  {candidate.title}
                </div>
                <div className="flex items-center gap-1">
                  {isScoring ? (
                    <Badge variant="accent">scoring</Badge>
                  ) : isAccepted ? (
                    <Badge variant="success">accepted</Badge>
                  ) : isScored ? (
                    <Badge variant="danger">rejected</Badge>
                  ) : (
                    <Badge variant="muted">queued</Badge>
                  )}
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-[color:var(--muted-foreground)]">
                <span className="truncate">
                  {stateLabel === "accepted" && index === winnerIndex ? "selected winner" : `state: ${stateLabel}`}
                </span>
                <span>
                  {isScored || isScoring ? `score ${candidate.score}` : "--"}
                </span>
              </div>
              {isScored ? (
                <div className="mt-1 flex items-center gap-1 text-xs">
                  {isAccepted ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--success)]" />
                      <span className="text-[color:var(--success)]">Passes quality gate</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3.5 w-3.5 text-[color:var(--danger)]" />
                      <span className="text-[color:var(--danger)]">Rejected for weak intent/risk profile</span>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FlowEditorClient({
  brandId,
  campaignId,
  variantId,
  backHref,
  hideOverviewCard = false,
  hideBackButton = false,
}: {
  brandId: string;
  campaignId: string;
  variantId: string;
  backHref?: string;
  hideOverviewCard?: boolean;
  hideBackButton?: boolean;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const zoomTargetRef = useRef<number | null>(null);

  const [brandName, setBrandName] = useState("Brand");
  const [campaignName, setCampaignName] = useState("Campaign");
  const [variantName, setVariantName] = useState("Variant");
  const [map, setMap] = useState<ConversationMap | null>(null);
  const [graph, setGraph] = useState<ConversationFlowGraph | null>(null);

  const [viewport, setViewport] = useState<Viewport>({ x: 80, y: 96, scale: 1 });
  const [pointerWorld, setPointerWorld] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [connectState, setConnectState] = useState<ConnectState | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [nodeEditorOpen, setNodeEditorOpen] = useState(false);
  const [edgeEditorOpen, setEdgeEditorOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [roleplayTick, setRoleplayTick] = useState(0);
  const [previewingNodeId, setPreviewingNodeId] = useState("");
  const [previewResult, setPreviewResult] = useState<{
    nodeId: string;
    subject: string;
    body: string;
    trace: Record<string, unknown>;
  } | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ConversationProbeResult | null>(null);
  const [probeError, setProbeError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [hasFittedInitialView, setHasFittedInitialView] = useState(false);
  const [previewLeads, setPreviewLeads] = useState<
    Array<ConversationPreviewLead & { runId?: string; runCreatedAt?: string; sourceUrl?: string }>
  >([]);
  const [selectedPreviewLeadId, setSelectedPreviewLeadId] = useState("");
  const [previewLeadsLoading, setPreviewLeadsLoading] = useState(false);
  const [previewLeadsError, setPreviewLeadsError] = useState("");
  const [workingHours, setWorkingHours] = useState<ConversationMapEditorState["workingHours"]>(
    DEFAULT_WORKING_HOURS
  );

  const load = async () => {
    setError("");
    const [brand, campaign, build, editorState] = await Promise.all([
      fetchBrand(brandId),
      fetchCampaign(brandId, campaignId),
      fetchBuildView(brandId, campaignId),
      fetchConversationMapApi(brandId, campaignId, variantId),
    ]);

    let previewLeadData: Awaited<ReturnType<typeof fetchConversationPreviewLeadsApi>> = {
      leads: [],
      runsChecked: 0,
      runtimeRefFound: true,
      sourceExperimentId: "",
      qualifiedLeadCount: 0,
      qualifiedLeadWithEmailCount: 0,
      qualifiedLeadWithoutEmailCount: 0,
      previewEmailEnrichment: {
        attempted: 0,
        matched: 0,
        failed: 0,
        provider: "emailfinder.batch",
        error: "",
      },
    };
    try {
      previewLeadData = await fetchConversationPreviewLeadsApi(brandId, campaignId, variantId);
      setPreviewLeadsError("");
    } catch (err) {
      setPreviewLeadsError(err instanceof Error ? err.message : "Failed to load sourced leads");
    }

    const variant = build.variants.find((item) => item.id === variantId);
    if (!variant) {
      throw new Error("Variant not found. Save Build first, then open Conversation Map.");
    }

    const nextGraph = withoutPreviewLeadState(withLayout(withReplyTimingDefaults(editorState.map?.draftGraph ?? {
      version: 1,
      maxDepth: 5,
      startNodeId: "",
      nodes: [],
      edges: [],
      previewLeads: [],
      previewLeadId: "",
      replyTiming: { ...DEFAULT_REPLY_TIMING },
    })));

    setBrandName(brand.name || "Brand");
    setCampaignName(campaign.name || "Campaign");
    setVariantName(variant.name || "Variant");
    setPreviewLeads(previewLeadData.leads);
    setSelectedPreviewLeadId((prev) =>
      previewLeadData.leads.some((lead) => lead.id === prev)
        ? prev
        : previewLeadData.leads[0]?.id ?? ""
    );
    setMap(editorState.map);
    setWorkingHours(editorState.workingHours);
    setGraph(nextGraph);
    setHasFittedInitialView(false);
    setSelectedNodeId(nextGraph.startNodeId || nextGraph.nodes[0]?.id || "");
    setSelectedEdgeId("");
  };

  const refreshPreviewLeads = async () => {
    setPreviewLeadsLoading(true);
    setPreviewLeadsError("");
    try {
      const next = await fetchConversationPreviewLeadsApi(brandId, campaignId, variantId);
      setPreviewLeads(next.leads);
      setSelectedPreviewLeadId((prev) =>
        next.leads.some((lead) => lead.id === prev) ? prev : next.leads[0]?.id ?? ""
      );
      setStatusMessage(
        next.leads.length
          ? `Loaded ${next.leads.length} sourced lead${next.leads.length === 1 ? "" : "s"} for preview.`
          : "No sourced leads found yet for this experiment."
      );
    } catch (err) {
      setPreviewLeadsError(err instanceof Error ? err.message : "Failed to load sourced leads");
    } finally {
      setPreviewLeadsLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void load()
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load conversation map");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, campaignId, variantId]);

  useEffect(() => {
    if (!loading && !generating) return;
    setRoleplayTick(0);
    const interval = window.setInterval(() => {
      setRoleplayTick((prev) => Math.min(prev + 1, 64));
    }, 650);
    return () => window.clearInterval(interval);
  }, [loading, generating]);

  const selectedNode = useMemo(() => nodeById(graph, selectedNodeId), [graph, selectedNodeId]);
  const selectedEdge = useMemo(() => edgeById(graph, selectedEdgeId), [graph, selectedEdgeId]);
  const selectedPreviewLead = useMemo(() => {
    if (!previewLeads.length) return null;
    return previewLeads.find((lead) => lead.id === selectedPreviewLeadId) ?? previewLeads[0] ?? null;
  }, [previewLeads, selectedPreviewLeadId]);

  useEffect(() => {
    if (!selectedNode || !previewResult || previewResult.nodeId === selectedNode.id) return;
    setPreviewResult(null);
    setPreviewError("");
  }, [selectedNode, previewResult]);

  useEffect(() => {
    if (!selectedNode) setNodeEditorOpen(false);
  }, [selectedNode]);

  useEffect(() => {
    if (!selectedEdge) setEdgeEditorOpen(false);
  }, [selectedEdge]);

  useEffect(() => {
    setProbeResult(null);
    setProbeError("");
  }, [graph, selectedPreviewLeadId, selectedNodeId]);

  const nodeLookup = useMemo(() => {
    const next = new Map<string, ConversationFlowNode>();
    if (!graph) return next;
    for (const node of graph.nodes) next.set(node.id, node);
    return next;
  }, [graph]);
  const selectedNodeTimerEdges = useMemo(() => {
    if (!graph || !selectedNode) return [] as ConversationFlowEdge[];
    return graph.edges
      .filter((edge) => edge.fromNodeId === selectedNode.id && edge.trigger === "timer")
      .sort((a, b) => a.waitMinutes - b.waitMinutes || a.priority - b.priority);
  }, [graph, selectedNode]);
  const probeTargetNode =
    selectedNode?.kind === "message"
      ? selectedNode
      : graph
        ? (nodeById(graph, graph.startNodeId) ?? null)
        : null;
  const probeLead =
    selectedPreviewLead ?? {
      id: "probe_demo_lead",
      name: "Jordan Lee",
      email: "jordan@exampleco.com",
      company: "ExampleCo",
      title: "Founder",
      domain: "exampleco.com",
      source: "manual" as const,
    };
  const replyTiming = graph?.replyTiming ?? DEFAULT_REPLY_TIMING;
  const replyTimingSummary = formatDelayRange(
    replyTiming.minimumDelayMinutes,
    replyTiming.randomAdditionalDelayMinutes
  );
  const workingWindowSummary =
    workingHours.businessHoursEnabled
      ? `${workingHours.timezone} · ${workingHours.businessHoursStartHour}:00-${workingHours.businessHoursEndHour}:00 · ${formatBusinessDays(workingHours.businessDays)}`
      : `${workingHours.timezone} · replies can send any time`;

  const saveDraft = async () => {
    if (!graph) return;
    setSaving(true);
    setError("");
    setStatusMessage("");
    try {
      const next = await saveConversationMapDraftApi({
        brandId,
        campaignId,
        experimentId: variantId,
        name: `${variantName} Conversation Flow`,
        draftGraph: graph,
        workingHours,
      });
      setMap(next.map);
      setWorkingHours(next.workingHours);
      setGraph(withoutPreviewLeadState(withLayout(withReplyTimingDefaults(next.map.draftGraph))));
      setStatusMessage("Draft saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    setError("");
    setStatusMessage("");
    try {
      if (graph) {
        await saveConversationMapDraftApi({
          brandId,
          campaignId,
          experimentId: variantId,
          name: `${variantName} Conversation Flow`,
          draftGraph: graph,
          workingHours,
        });
      }
      const next = await publishConversationMapApi(brandId, campaignId, variantId);
      setMap(next.map);
      setWorkingHours(next.workingHours);
      setGraph(withoutPreviewLeadState(withLayout(withReplyTimingDefaults(next.map.draftGraph))));
      setStatusMessage(`Published revision ${next.map.publishedRevision}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish map");
    } finally {
      setPublishing(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError("");
    setStatusMessage("");
    try {
      const suggested = await suggestConversationMapApi(brandId, campaignId, variantId);
      const next = withoutPreviewLeadState(withLayout(withReplyTimingDefaults(suggested)));
      setGraph(next);
      setHasFittedInitialView(false);
      setSelectedNodeId(next.startNodeId || next.nodes[0]?.id || "");
      setSelectedEdgeId("");
      setStatusMessage("AI map generated. Save draft to keep it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate map");
    } finally {
      setGenerating(false);
    }
  };

  const generatePreview = async () => {
    if (!selectedNode || selectedNode.kind !== "message") return;
    if (!graph) {
      setPreviewError("Conversation map is still loading. Try preview again in a moment.");
      return;
    }
    const lead = selectedPreviewLead;
    if (!lead) {
      setPreviewError("No sourced leads available. Launch lead sourcing for this experiment first.");
      return;
    }

    const inboundIntentEdge = graph.edges
      .filter((edge) => edge.toNodeId === selectedNode.id && edge.trigger === "intent" && edge.intent)
      .sort((a, b) => a.priority - b.priority)[0];
    const sampleReplyByIntent: Record<
      "question" | "interest" | "objection" | "unsubscribe" | "other",
      { subject: string; body: string; confidence: number }
    > = {
      question: {
        subject: "Re: question",
        body: "Can you share one concrete example relevant to our team?",
        confidence: 0.78,
      },
      interest: {
        subject: "Re: this looks useful",
        body: "This sounds relevant. Can you share the next step?",
        confidence: 0.81,
      },
      objection: {
        subject: "Re: concerns",
        body: "Not sure this fits our process right now. Why this approach?",
        confidence: 0.79,
      },
      unsubscribe: {
        subject: "Re: remove me",
        body: "Please remove me from this sequence.",
        confidence: 0.98,
      },
      other: {
        subject: "Re: follow-up",
        body: "Can you clarify this for me?",
        confidence: 0.7,
      },
    };
    const sampleReply =
      inboundIntentEdge &&
      sampleReplyByIntent[inboundIntentEdge.intent as keyof typeof sampleReplyByIntent]
        ? {
            intent: inboundIntentEdge.intent,
            confidence: sampleReplyByIntent[inboundIntentEdge.intent as keyof typeof sampleReplyByIntent].confidence,
            subject: sampleReplyByIntent[inboundIntentEdge.intent as keyof typeof sampleReplyByIntent].subject,
            body: sampleReplyByIntent[inboundIntentEdge.intent as keyof typeof sampleReplyByIntent].body,
          }
        : undefined;

    setPreviewingNodeId(selectedNode.id);
    setPreviewError("");
    try {
      const preview = await previewConversationNodeApi({
        brandId,
        campaignId,
        experimentId: variantId,
        nodeId: selectedNode.id,
        sampleLead: {
          id: lead.id,
          name: lead.name,
          email: lead.email,
          company: lead.company,
          title: lead.title,
          domain: lead.domain,
        },
        sampleReply,
      });
      setPreviewResult({
        nodeId: selectedNode.id,
        subject: preview.subject,
        body: preview.body,
        trace: preview.trace,
      });
      trackEvent("conversation_prompt_previewed", {
        brandId,
        campaignId,
        experimentId: variantId,
        nodeId: selectedNode.id,
        ok: true,
      });
      setStatusMessage("Preview generated.");
    } catch (err) {
      trackEvent("conversation_prompt_previewed", {
        brandId,
        campaignId,
        experimentId: variantId,
        nodeId: selectedNode.id,
        ok: false,
      });
      setPreviewError(err instanceof Error ? err.message : "Failed to generate preview");
    } finally {
      setPreviewingNodeId("");
    }
  };

  const generateProbe = async () => {
    if (!graph) {
      setProbeError("Conversation map is still loading. Try probe again in a moment.");
      return;
    }
    const lead = probeLead;
    const entryNode =
      selectedNode?.kind === "message"
        ? selectedNode
        : nodeById(graph, graph.startNodeId);
    if (!entryNode || entryNode.kind !== "message") {
      setProbeError("Choose a message node or set a valid start node before probing.");
      return;
    }

    setProbing(true);
    setProbeError("");
    try {
      const probe = await probeConversationMapApi({
        brandId,
        campaignId,
        experimentId: variantId,
        nodeId: entryNode.id,
        sampleLead: {
          id: lead.id,
          name: lead.name,
          email: lead.email,
          company: lead.company,
          title: lead.title,
          domain: lead.domain,
        },
      });
      setProbeResult(probe);
      trackEvent("conversation_prompt_previewed", {
        brandId,
        campaignId,
        experimentId: variantId,
        nodeId: entryNode.id,
        mode: "probe",
        ok: true,
      });
      setStatusMessage("Probe run completed.");
    } catch (err) {
      trackEvent("conversation_prompt_previewed", {
        brandId,
        campaignId,
        experimentId: variantId,
        nodeId: entryNode.id,
        mode: "probe",
        ok: false,
      });
      setProbeError(err instanceof Error ? err.message : "Failed to run probe");
    } finally {
      setProbing(false);
    }
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - viewport.x) / viewport.scale,
      y: (clientY - rect.top - viewport.y) / viewport.scale,
    };
  };

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-node-card='true']")) return;
    if (target.closest("[data-edge-path='true']")) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    setPanState({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    });
    setSelectedNodeId("");
    setSelectedEdgeId("");
  };

  const onCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const world = screenToWorld(event.clientX, event.clientY);
    setPointerWorld(world);

    if (panState && event.pointerId === panState.pointerId) {
      setViewport((prev) => ({
        ...prev,
        x: panState.originX + (event.clientX - panState.startX),
        y: panState.originY + (event.clientY - panState.startY),
      }));
      return;
    }

    if (dragState && event.pointerId === dragState.pointerId) {
      setGraph((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          nodes: prev.nodes.map((node) =>
            node.id === dragState.nodeId
              ? {
                  ...node,
                  x: world.x - dragState.offsetX,
                  y: world.y - dragState.offsetY,
                }
              : node
          ),
        };
      });
    }
  };

  const onCanvasPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panState && event.pointerId === panState.pointerId) {
      setPanState(null);
    }
    if (dragState && event.pointerId === dragState.pointerId) {
      setDragState(null);
    }
    if (connectState && event.pointerId === connectState.pointerId) {
      setConnectState(null);
    }
  };

  const startNodeDrag = (event: React.PointerEvent<HTMLDivElement>, nodeId: string) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const world = screenToWorld(event.clientX, event.clientY);
    const node = nodeById(graph, nodeId);
    if (!node) return;

    setDragState({
      nodeId,
      pointerId: event.pointerId,
      offsetX: world.x - node.x,
      offsetY: world.y - node.y,
    });
    setSelectedNodeId(nodeId);
    setSelectedEdgeId("");
  };

  const startConnect = (event: React.PointerEvent<HTMLButtonElement>, fromNodeId: string) => {
    event.stopPropagation();
    setConnectState({ fromNodeId, pointerId: event.pointerId });
    setSelectedNodeId(fromNodeId);
    setSelectedEdgeId("");
  };

  const completeConnect = (event: React.PointerEvent<HTMLButtonElement>, toNodeId: string) => {
    event.stopPropagation();
    if (!connectState || !graph) return;
    if (connectState.fromNodeId === toNodeId) {
      setConnectState(null);
      return;
    }

    const exists = graph.edges.some(
      (edge) => edge.fromNodeId === connectState.fromNodeId && edge.toNodeId === toNodeId
    );
    if (exists) {
      setConnectState(null);
      return;
    }

    const nextEdge: ConversationFlowEdge = {
      id: makeEdgeId(),
      fromNodeId: connectState.fromNodeId,
      toNodeId,
      trigger: "fallback",
      intent: "",
      waitMinutes: 0,
      confidenceThreshold: 0.7,
      priority: graph.edges.length + 1,
    };

    setGraph({ ...graph, edges: [...graph.edges, nextEdge] });
    setSelectedEdgeId(nextEdge.id);
    setSelectedNodeId("");
    setEdgeEditorOpen(true);
    setNodeEditorOpen(false);
    setConnectState(null);
  };

  const addMessageNode = () => {
    setGraph((prev) => {
      if (!prev) return prev;
      const next = defaultNode("message", 120 + prev.nodes.length * 40, 120 + prev.nodes.length * 30);
      return {
        ...prev,
        nodes: [...prev.nodes, next],
        startNodeId: prev.startNodeId || next.id,
      };
    });
  };

  const addTerminalNode = () => {
    setGraph((prev) => {
      if (!prev) return prev;
      const next = defaultNode("terminal", 120 + prev.nodes.length * 40, 120 + prev.nodes.length * 30);
      return {
        ...prev,
        nodes: [...prev.nodes, next],
        startNodeId: prev.startNodeId || next.id,
      };
    });
  };

  const duplicateNode = (nodeId: string) => {
    setGraph((prev) => {
      if (!prev) return prev;
      const source = prev.nodes.find((node) => node.id === nodeId);
      if (!source) return prev;
      const duplicate: ConversationFlowNode = {
        ...source,
        id: makeNodeId(),
        title: `${source.title} Copy`,
        x: source.x + 48,
        y: source.y + 48,
      };
      return {
        ...prev,
        nodes: [...prev.nodes, duplicate],
      };
    });
  };

  const deleteNode = (nodeId: string) => {
    setGraph((prev) => {
      if (!prev) return prev;
      const nodes = prev.nodes.filter((node) => node.id !== nodeId);
      const edges = prev.edges.filter((edge) => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId);
      const startNodeId = prev.startNodeId === nodeId ? nodes[0]?.id || "" : prev.startNodeId;
      return {
        ...prev,
        nodes,
        edges,
        startNodeId,
      };
    });

    if (selectedNodeId === nodeId) setSelectedNodeId("");
    if (connectState?.fromNodeId === nodeId) setConnectState(null);
  };

  const deleteEdge = (edgeId: string) => {
    setGraph((prev) => (prev ? { ...prev, edges: prev.edges.filter((edge) => edge.id !== edgeId) } : prev));
    if (selectedEdgeId === edgeId) setSelectedEdgeId("");
  };

  const createFollowUpBranch = (fromNodeId: string, waitMinutes = 7200) => {
    let nextNodeId = "";
    setGraph((prev) => {
      if (!prev) return prev;
      const source = prev.nodes.find((node) => node.id === fromNodeId);
      if (!source || source.kind !== "message") return prev;
      const nextNode = createFollowUpNode(
        source,
        source.x + GRID_X * 0.9,
        source.y + GRID_Y * 0.55 + prev.nodes.filter((node) => node.id !== source.id).length * 8
      );
      const nextEdge: ConversationFlowEdge = {
        id: makeEdgeId(),
        fromNodeId: source.id,
        toNodeId: nextNode.id,
        trigger: "timer",
        intent: "",
        waitMinutes,
        confidenceThreshold: 0.7,
        priority: prev.edges.length + 1,
      };
      nextNodeId = nextNode.id;
      return {
        ...prev,
        nodes: [...prev.nodes, nextNode],
        edges: [...prev.edges, nextEdge],
      };
    });
    if (nextNodeId) {
      setSelectedNodeId(nextNodeId);
      setSelectedEdgeId("");
      setNodeEditorOpen(true);
      setEdgeEditorOpen(false);
      setHasFittedInitialView(false);
      setStatusMessage(`Added follow-up after ${formatWaitMinutes(waitMinutes)}.`);
    }
  };

  const setNodePatch = (nodeId: string, patch: Partial<ConversationFlowNode>) => {
    setGraph((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
      };
    });
  };

  const setEdgePatch = (edgeId: string, patch: Partial<ConversationFlowEdge>) => {
    setGraph((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        edges: prev.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)),
      };
    });
  };

  const openNodeEditor = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId("");
    setNodeEditorOpen(true);
    setEdgeEditorOpen(false);
  };

  const openEdgeEditor = (edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId("");
    setEdgeEditorOpen(true);
    setNodeEditorOpen(false);
  };

  const fitView = () => {
    if (!graph || !graph.nodes.length || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const minX = Math.min(...graph.nodes.map((node) => node.x));
    const minY = Math.min(...graph.nodes.map((node) => node.y));
    const maxX = Math.max(...graph.nodes.map((node) => node.x + NODE_WIDTH));
    const maxY = Math.max(...graph.nodes.map((node) => node.y + NODE_HEIGHT));

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const scale = clamp(Math.min((rect.width - 120) / width, (rect.height - 120) / height), 0.45, 1.25);

    setViewport({
      scale,
      x: (rect.width - width * scale) / 2 - minX * scale,
      y: (rect.height - height * scale) / 2 - minY * scale,
    });
  };

  useEffect(() => {
    if (!graph?.nodes.length || loading || hasFittedInitialView || !canvasRef.current) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const minX = Math.min(...graph.nodes.map((node) => node.x));
      const minY = Math.min(...graph.nodes.map((node) => node.y));
      const maxX = Math.max(...graph.nodes.map((node) => node.x + NODE_WIDTH));
      const maxY = Math.max(...graph.nodes.map((node) => node.y + NODE_HEIGHT));
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);
      const scale = clamp(Math.min((rect.width - 120) / width, (rect.height - 120) / height), 0.45, 1.25);

      setViewport({
        scale,
        x: (rect.width - width * scale) / 2 - minX * scale,
        y: (rect.height - height * scale) / 2 - minY * scale,
      });
      setHasFittedInitialView(true);
    });

    return () => cancelAnimationFrame(frame);
  }, [graph, loading, hasFittedInitialView]);

  useEffect(() => {
    return () => {
      if (zoomFrameRef.current !== null) {
        cancelAnimationFrame(zoomFrameRef.current);
      }
    };
  }, []);

  const animateZoomTo = (targetScale: number) => {
    zoomTargetRef.current = clamp(targetScale, MIN_ZOOM, MAX_ZOOM);
    if (zoomFrameRef.current !== null) return;

    const tick = () => {
      let done = false;
      setViewport((prev) => {
        const target = zoomTargetRef.current ?? prev.scale;
        const diff = target - prev.scale;
        if (Math.abs(diff) < 0.001) {
          done = true;
          return { ...prev, scale: target };
        }
        return { ...prev, scale: prev.scale + diff * ZOOM_EASING };
      });

      if (done) {
        zoomFrameRef.current = null;
        return;
      }
      zoomFrameRef.current = requestAnimationFrame(tick);
    };

    zoomFrameRef.current = requestAnimationFrame(tick);
  };

  const zoom = (delta: number) => {
    const baseScale = zoomTargetRef.current ?? viewport.scale;
    animateZoomTo(baseScale + delta);
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const zoomDelta = clamp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY, -MAX_WHEEL_ZOOM_STEP, MAX_WHEEL_ZOOM_STEP);
      zoom(zoomDelta);
      return;
    }
    setViewport((prev) => ({ ...prev, x: prev.x - event.deltaX, y: prev.y - event.deltaY }));
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-2 py-6">
        <RoleplayScreeningLoader tick={roleplayTick} variantName={variantName} />
      </div>
    );
  }

  if (!graph) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversation map unavailable</CardTitle>
          <CardDescription className="text-[color:var(--danger)]">{error || "Could not initialize map."}</CardDescription>
        </CardHeader>
        {!hideBackButton ? (
          <CardContent>
            <Button asChild type="button" variant="outline">
              <Link href={backHref || `/brands/${brandId}/campaigns/${campaignId}/build`}>Back</Link>
            </Button>
          </CardContent>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card className={hideOverviewCard ? "sticky top-20 z-20 border-[color:var(--border)] bg-[color:var(--surface)]" : ""}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-[220px]">
            <div className="text-sm font-semibold">Conversation Flow Canvas</div>
            <div className="text-xs text-[color:var(--muted-foreground)]">
              {brandName} · {campaignName} · {variantName}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={map?.status === "published" ? "success" : "muted"}>{map?.status || "draft"}</Badge>
            <Badge variant="muted">Revision {map?.publishedRevision ?? 0}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={generate} disabled={generating}>
              <RefreshCw className="h-4 w-4" />
              {generating ? "Screening..." : "Generate"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={saveDraft} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button type="button" size="sm" onClick={publish} disabled={publishing}>
              <Upload className="h-4 w-4" />
              {publishing ? "Publishing..." : "Publish"}
            </Button>
            {!hideBackButton ? (
              <Button asChild size="sm" type="button" variant="ghost">
                <Link href={backHref || `/brands/${brandId}/campaigns/${campaignId}/build`}>Back</Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
        {statusMessage ? <CardContent className="pt-0 text-sm text-[color:var(--accent)]">{statusMessage}</CardContent> : null}
        {error ? <CardContent className="pt-0 text-sm text-[color:var(--danger)]">{error}</CardContent> : null}
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Reply Timing</CardTitle>
          <CardDescription>
            Auto replies wait at least {replyTimingSummary}, then hold for your working window if needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="grid gap-2">
            <Label>Minimum reply wait (minutes)</Label>
            <Input
              type="number"
              min={0}
              max={10080}
              value={replyTiming.minimumDelayMinutes}
              onChange={(event) =>
                setGraph((prev) =>
                  prev
                    ? {
                        ...prev,
                        replyTiming: {
                          ...replyTiming,
                          minimumDelayMinutes: clamp(Number(event.target.value || replyTiming.minimumDelayMinutes), 0, 10080),
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Random extra wait (minutes)</Label>
            <Input
              type="number"
              min={0}
              max={1440}
              value={replyTiming.randomAdditionalDelayMinutes}
              onChange={(event) =>
                setGraph((prev) =>
                  prev
                    ? {
                        ...prev,
                        replyTiming: {
                          ...replyTiming,
                          randomAdditionalDelayMinutes: clamp(
                            Number(event.target.value || replyTiming.randomAdditionalDelayMinutes),
                            0,
                            1440
                          ),
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Working timezone</Label>
            <Input
              value={workingHours.timezone}
              onChange={(event) =>
                setWorkingHours((prev) => ({
                  ...prev,
                  timezone: event.target.value,
                }))
              }
              placeholder="America/Los_Angeles"
            />
          </div>
          <div className="grid gap-2">
            <Label>Workday start</Label>
            <Input
              type="number"
              min={0}
              max={23}
              value={workingHours.businessHoursStartHour}
              onChange={(event) =>
                setWorkingHours((prev) => ({
                  ...prev,
                  businessHoursStartHour: clamp(
                    Math.round(Number(event.target.value || prev.businessHoursStartHour)),
                    0,
                    23
                  ),
                }))
              }
              disabled={workingHours.businessHoursEnabled === false}
            />
          </div>
          <div className="grid gap-2">
            <Label>Workday end</Label>
            <Input
              type="number"
              min={1}
              max={24}
              value={workingHours.businessHoursEndHour}
              onChange={(event) =>
                setWorkingHours((prev) => ({
                  ...prev,
                  businessHoursEndHour: clamp(
                    Math.round(Number(event.target.value || prev.businessHoursEndHour)),
                    1,
                    24
                  ),
                }))
              }
              disabled={workingHours.businessHoursEnabled === false}
            />
          </div>
          <div className="md:col-span-2 xl:col-span-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={workingHours.businessHoursEnabled !== false}
                onChange={(event) =>
                  setWorkingHours((prev) => ({
                    ...prev,
                    businessHoursEnabled: event.target.checked,
                  }))
                }
              />
              Only send replies during working hours
            </label>
            <div className="text-[color:var(--muted-foreground)]">
              Window: {workingWindowSummary}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-[color:var(--border)] pb-3">
            <div>
              <CardTitle className="text-base">Flow Canvas</CardTitle>
              <CardDescription>Drag cards, connect handles, pan on background, zoom with ctrl/cmd + wheel.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={addMessageNode}>
                <Plus className="h-4 w-4" />
                Message
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={addTerminalNode}>
                <Target className="h-4 w-4" />
                End Node
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setGraph((prev) => (prev ? autoLayout(prev) : prev))}>
                <LayoutGrid className="h-4 w-4" />
                Auto Layout
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={fitView}>
                Fit
              </Button>
              <Button type="button" size="icon" variant="outline" onClick={() => zoom(BUTTON_ZOOM_STEP)}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" variant="outline" onClick={() => zoom(-BUTTON_ZOOM_STEP)}>
                <ZoomOut className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div
              ref={canvasRef}
              className="relative w-full cursor-grab overflow-hidden bg-[color:var(--surface-muted)]"
              style={{
                minHeight: `${CANVAS_MIN_HEIGHT}px`,
                backgroundImage:
                  "linear-gradient(to right, color-mix(in srgb, var(--border) 72%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border) 72%, transparent) 1px, transparent 1px)",
                backgroundSize: "48px 48px",
              }}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerUp}
              onWheel={onWheel}
            >
              <svg className="pointer-events-none absolute inset-0 h-full w-full">
                <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
                  {graph.edges.map((edge) => {
                    const from = nodeLookup.get(edge.fromNodeId);
                    const to = nodeLookup.get(edge.toNodeId);
                    if (!from || !to) return null;

                    const fromX = from.x + NODE_WIDTH;
                    const fromY = from.y + NODE_HEIGHT / 2;
                    const toX = to.x;
                    const toY = to.y + NODE_HEIGHT / 2;
                    const selected = selectedEdgeId === edge.id;

                    return (
                      <g key={edge.id}>
                        <path
                          d={bezierPath(fromX, fromY, toX, toY)}
                          fill="none"
                          stroke={selected ? "rgba(161,78,44,0.25)" : "rgba(23,20,17,0.08)"}
                          strokeWidth={selected ? 8 : 6}
                          strokeLinecap="round"
                          className="pointer-events-none"
                        />
                        <path
                          data-edge-path="true"
                          d={bezierPath(fromX, fromY, toX, toY)}
                          fill="none"
                          stroke={selected ? "var(--accent)" : "var(--border-strong)"}
                          strokeWidth={selected ? 3.2 : 2.5}
                          strokeLinecap="round"
                          className="pointer-events-auto cursor-pointer"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEdgeEditor(edge.id);
                          }}
                        />
                        <text
                          x={(fromX + toX) / 2}
                          y={(fromY + toY) / 2 - 8}
                          textAnchor="middle"
                          fill="var(--muted-foreground)"
                          fontSize="12"
                          className="pointer-events-none"
                        >
                          {edgeLabel(edge)}
                        </text>
                      </g>
                    );
                  })}

                  {connectState ? (() => {
                    const from = nodeLookup.get(connectState.fromNodeId);
                    if (!from) return null;
                    const fromX = from.x + NODE_WIDTH;
                    const fromY = from.y + NODE_HEIGHT / 2;
                    return (
                      <path
                        d={bezierPath(fromX, fromY, pointerWorld.x, pointerWorld.y)}
                        fill="none"
                        stroke="var(--accent)"
                        strokeDasharray="6 6"
                        strokeWidth={2}
                        strokeLinecap="round"
                      />
                    );
                  })() : null}
                </g>
              </svg>

              <div
                className="absolute left-0 top-0"
                style={{
                  transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
                  transformOrigin: "0 0",
                }}
              >
                {graph.nodes.map((node, nodeIndex) => {
                  const isSelected = selectedNodeId === node.id;
                  const isStart = graph.startNodeId === node.id;
                  const nodeTimerEdges = graph.edges
                    .filter((edge) => edge.fromNodeId === node.id && edge.trigger === "timer")
                    .sort((a, b) => a.waitMinutes - b.waitMinutes || a.priority - b.priority);
                  const cardTitle =
                    node.title.trim() || (node.kind === "terminal" ? "End" : `Message ${nodeIndex + 1}`);
                  return (
                    <div
                      key={node.id}
                      data-node-card="true"
                      className="absolute rounded-[10px] border bg-[color:var(--surface)] shadow-sm"
                      style={{
                        width: `${NODE_WIDTH}px`,
                        minHeight: `${NODE_HEIGHT}px`,
                        left: `${node.x}px`,
                        top: `${node.y}px`,
                        borderColor: isSelected ? "var(--accent)" : "var(--border)",
                      }}
                      onPointerDown={(event) => startNodeDrag(event, node.id)}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedNodeId(node.id);
                        setSelectedEdgeId("");
                      }}
                    >
                      <button
                        type="button"
                        className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-[5px] border border-[color:var(--border-strong)] bg-[color:var(--surface)]"
                        title="Connect here"
                        onPointerUp={(event) => completeConnect(event, node.id)}
                        onPointerDown={(event) => event.stopPropagation()}
                      />

                      <button
                        type="button"
                        className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-[5px] border border-[color:var(--accent)] bg-[color:var(--accent)]"
                        title="Start connection"
                        onPointerDown={(event) => startConnect(event, node.id)}
                      />

                      <div className="border-b border-[color:var(--border)] px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-base font-semibold">{cardTitle}</div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                openNodeEditor(node.id);
                              }}
                            >
                              Edit
                            </Button>
                            {isStart ? <Badge variant="accent">First</Badge> : null}
                            {node.kind === "message" ? (
                              <Badge variant={node.autoSend ? "success" : "muted"}>
                                {node.autoSend ? "Auto" : "Manual"}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                        {node.kind === "message" && node.delayMinutes > 0 ? (
                          <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                            Node delay: {formatWaitMinutes(node.delayMinutes)}
                          </div>
                        ) : null}
                        {node.kind === "message" && nodeTimerEdges.length ? (
                          <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                            Follow-ups: {nodeTimerEdges.slice(0, 2).map((edge) => formatWaitMinutes(edge.waitMinutes)).join(", ")}
                            {nodeTimerEdges.length > 2 ? ` +${nodeTimerEdges.length - 2} more` : ""}
                          </div>
                        ) : null}
                      </div>

                      <div className="space-y-3 px-4 py-3 text-sm leading-6 text-[color:var(--muted-foreground)]">
                        <div className="line-clamp-5">
                          <strong>{node.kind === "terminal" ? "Flow:" : "Prompt:"}</strong>{" "}
                          {node.kind === "terminal" ? "Sequence stops here." : promptSnippet(node.promptTemplate)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {generating ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-[color:var(--surface)]/88 px-4 py-6">
                  <RoleplayScreeningLoader tick={roleplayTick} variantName={variantName} compact />
                </div>
              ) : null}

              <div className="pointer-events-none absolute bottom-4 left-4 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-[13px] text-[color:var(--muted-foreground)]">
                <span className="inline-flex items-center gap-1"><Hand className="h-3 w-3" /> Pan: drag background</span>
                <span className="mx-2">|</span>
                <span>Zoom: ctrl/cmd + wheel</span>
                <span className="mx-2">|</span>
                <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" /> Connect: drag from right dot to left dot</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Flow Probe</CardTitle>
            <CardDescription>Use the canvas edit buttons for nodes. Probe lets you test the draft flow against a sample lead.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-dashed border-[color:var(--border)] p-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
              Edit nodes directly on the canvas. Click a node&apos;s Edit button or click a path to adjust routing.
            </div>

            <div className="space-y-3 rounded-xl border border-[color:var(--border)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Flow Probe</div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    Roleplay a blank recipient against the current draft map and inspect which branch fires.
                  </div>
                </div>
                <Badge variant="muted">{probeTargetNode ? "Ready" : "Needs start node"}</Badge>
              </div>

              <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
                Entry node: <span className="font-medium text-[color:var(--foreground)]">{probeTargetNode?.title || "Not set"}</span>
                <br />
                Lead: <span className="font-medium text-[color:var(--foreground)]">
                  {probeLead.name || probeLead.email}
                </span>
                {!selectedPreviewLead ? (
                  <>
                    <br />
                    Using a synthetic founder profile until sourced preview leads are available.
                  </>
                ) : null}
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void generateProbe()}
                disabled={probing || !probeTargetNode}
              >
                {probing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Running probe...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Run probe
                  </>
                )}
              </Button>

              {probeError ? <div className="text-xs text-[color:var(--danger)]">{probeError}</div> : null}

              {probeResult ? (
                <div className="space-y-2">
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    Probe generated for {probeResult.lead.email || probeResult.lead.domain} from {probeResult.startNodeTitle}.
                  </div>
                  {probeResult.scenarios.map((scenario) => (
                    <details
                      key={scenario.id}
                      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2"
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[color:var(--foreground)]">{scenario.title}</div>
                            <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                              {scenario.summary}
                            </div>
                          </div>
                          <Badge variant={probeOutcomeBadgeVariant(scenario.outcome)}>
                            {probeOutcomeLabel(scenario.outcome)}
                          </Badge>
                        </div>
                      </summary>

                      <div className="mt-3 space-y-2 text-xs">
                        <div className="text-[color:var(--muted-foreground)]">{scenario.description}</div>
                        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1.5 text-[color:var(--muted-foreground)]">
                          Path: {scenario.path.length ? scenario.path.join(" -> ") : "No path"}
                        </div>
                        {scenario.steps.map((step) => (
                          <div
                            key={step.id}
                            className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium text-[color:var(--foreground)]">
                                {step.label}
                                {step.nodeTitle ? ` · ${step.nodeTitle}` : ""}
                              </div>
                              {step.kind === "route" && step.action ? (
                                <Badge variant={step.action === "manual_review" ? "accent" : step.action === "reply" ? "success" : "muted"}>
                                  {step.action}
                                </Badge>
                              ) : null}
                            </div>
                            {step.edgeLabel ? (
                              <div className="mt-1 text-[color:var(--muted-foreground)]">{step.edgeLabel}</div>
                            ) : null}
                            {step.waitMinutes > 0 ? (
                              <div className="mt-1 text-[color:var(--muted-foreground)]">
                                Wait: {formatWaitMinutes(step.waitMinutes)}
                              </div>
                            ) : null}
                            {step.subject ? (
                              <div className="mt-2">
                                <span className="font-medium text-[color:var(--foreground)]">Subject:</span> {step.subject}
                              </div>
                            ) : null}
                            {step.body ? (
                              <div className="mt-1 whitespace-pre-wrap text-[color:var(--muted-foreground)]">{step.body}</div>
                            ) : null}
                            {step.intent || step.route || step.reason ? (
                              <div className="mt-2 text-[color:var(--muted-foreground)]">
                                {[step.intent ? `intent: ${step.intent}` : "", step.route ? `route: ${step.route}` : "", step.reason].filter(Boolean).join(" · ")}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <SettingsModal
        open={nodeEditorOpen && Boolean(selectedNode)}
        onOpenChange={setNodeEditorOpen}
        title={selectedNode?.kind === "terminal" ? "Edit end node" : `Edit ${selectedNode?.title || "message node"}`}
        description={
          selectedNode?.kind === "message"
            ? "Update the node copy, timing, follow-ups, and preview without leaving the canvas."
            : "This node ends the sequence."
        }
        panelClassName="max-w-4xl"
        bodyClassName="space-y-4"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setNodeEditorOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => setNodeEditorOpen(false)}>
              Save node
            </Button>
          </div>
        }
      >
        {selectedNode ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">
                Node: {selectedNode.title || (selectedNode.kind === "terminal" ? "End" : "Message")}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedNode.kind === "message" ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => duplicateNode(selectedNode.id)}>
                    Duplicate
                  </Button>
                ) : null}
                {selectedNode.kind === "message" ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => createFollowUpBranch(selectedNode.id)}>
                    Add follow-up
                  </Button>
                ) : null}
                {selectedNode.kind === "message" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={graph.startNodeId === selectedNode.id ? "secondary" : "outline"}
                    onClick={() => setGraph((prev) => (prev ? { ...prev, startNodeId: selectedNode.id } : prev))}
                  >
                    {graph.startNodeId === selectedNode.id ? "First email node" : "Use as first email"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    deleteNode(selectedNode.id);
                    setNodeEditorOpen(false);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {selectedNode.kind === "message" ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Title</Label>
                    <Input
                      value={selectedNode.title}
                      onChange={(event) => setNodePatch(selectedNode.id, { title: event.target.value })}
                      placeholder="Send AWS application link"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Subject</Label>
                    <Input
                      value={selectedNode.subject}
                      onChange={(event) => setNodePatch(selectedNode.id, { subject: event.target.value })}
                      placeholder="Question about your pipeline"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Send mode</Label>
                    <Select
                      value={selectedNode.autoSend ? "auto" : "manual"}
                      onChange={(event) => setNodePatch(selectedNode.id, { autoSend: event.target.value === "auto" })}
                    >
                      <option value="auto">Auto send</option>
                      <option value="manual">Manual review</option>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Node delay (minutes)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={10080}
                      value={selectedNode.delayMinutes}
                      onChange={(event) =>
                        setNodePatch(selectedNode.id, {
                          delayMinutes: clamp(Number(event.target.value || selectedNode.delayMinutes), 0, 10080),
                        })
                      }
                    />
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      Extra wait after entering this node: {formatWaitMinutes(selectedNode.delayMinutes)}. Auto replies also respect the map-level reply timing above.
                    </div>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Body</Label>
                  <Textarea
                    value={selectedNode.body}
                    rows={10}
                    onChange={(event) => setNodePatch(selectedNode.id, { body: event.target.value })}
                    placeholder="Hi {{firstName}}, ..."
                  />
                </div>

                <div className="grid gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-[color:var(--foreground)]">Follow-ups</div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">
                        Add timed no-reply branches directly from this node.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[1440, 4320, 7200].map((minutes) => (
                        <Button
                          key={minutes}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => createFollowUpBranch(selectedNode.id, minutes)}
                        >
                          Add {formatWaitMinutes(minutes)}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {selectedNodeTimerEdges.length ? (
                    <div className="grid gap-2">
                      {selectedNodeTimerEdges.map((edge) => {
                        const target = nodeLookup.get(edge.toNodeId);
                        return (
                          <div
                            key={edge.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs"
                          >
                            <div>
                              <div className="font-medium text-[color:var(--foreground)]">
                                {target?.title || "Follow-up node"}
                              </div>
                              <div className="text-[color:var(--muted-foreground)]">
                                Sends after {formatWaitMinutes(edge.waitMinutes)}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" variant="ghost" onClick={() => openEdgeEditor(edge.id)}>
                                Edit path
                              </Button>
                              {target ? (
                                <Button type="button" size="sm" variant="ghost" onClick={() => openNodeEditor(target.id)}>
                                  Open node
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      No timed follow-ups yet. Add one if you want this branch to retry after silence.
                    </div>
                  )}
                </div>

                <div className="grid gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      Preview uses one sourced sample lead for context.
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void refreshPreviewLeads()}
                      disabled={previewLeadsLoading}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${previewLeadsLoading ? "animate-spin" : ""}`} />
                      {previewLeadsLoading ? "Refreshing..." : "Refresh lead context"}
                    </Button>
                  </div>

                  {selectedPreviewLead ? (
                    <details className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs">
                      <summary className="cursor-pointer font-medium text-[color:var(--foreground)]">
                        Sample lead: {selectedPreviewLead.name || selectedPreviewLead.email || selectedPreviewLead.domain}
                      </summary>
                      <div className="mt-2 text-[color:var(--muted-foreground)]">
                        {selectedPreviewLead.title || "Unknown title"} at {selectedPreviewLead.company || selectedPreviewLead.domain}
                      </div>
                      <div className="text-[color:var(--muted-foreground)]">{selectedPreviewLead.email || "(missing email)"}</div>
                    </details>
                  ) : null}
                  {previewLeadsError ? <div className="text-xs text-[color:var(--danger)]">{previewLeadsError}</div> : null}
                  {!previewLeads.length ? (
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      No sourced leads yet. Run sourcing first, then refresh lead context.
                    </div>
                  ) : null}

                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={() => void generatePreview()}
                    disabled={previewingNodeId === selectedNode.id || !selectedPreviewLead}
                  >
                    {previewingNodeId === selectedNode.id ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Regenerating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        Regenerate draft
                      </>
                    )}
                  </Button>
                  {previewError && previewingNodeId !== selectedNode.id ? (
                    <div className="text-xs text-[color:var(--danger)]">{previewError}</div>
                  ) : null}
                  {previewResult && previewResult.nodeId === selectedNode.id ? (
                    <div className="grid gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-2 text-xs">
                      <div>
                        <span className="font-medium">Subject:</span> {previewResult.subject || "(empty)"}
                      </div>
                      <div className="whitespace-pre-wrap">
                        <span className="font-medium">Body:</span> {previewResult.body || "(empty)"}
                      </div>
                      <details>
                        <summary className="cursor-pointer text-[color:var(--muted-foreground)]">Trace</summary>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-2">
                          {JSON.stringify(previewResult.trace, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ) : null}
                </div>

                <details className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
                  <div className="mt-2 grid gap-2">
                    <Label>Prompt Template</Label>
                    <Textarea
                      value={selectedNode.promptTemplate}
                      rows={8}
                      onChange={(event) => setNodePatch(selectedNode.id, { promptTemplate: event.target.value })}
                    />
                  </div>
                </details>
              </>
            ) : (
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-sm text-[color:var(--muted-foreground)]">
                This is an end node. It does not send a message.
              </div>
            )}
          </div>
        ) : null}
      </SettingsModal>

      <SettingsModal
        open={edgeEditorOpen && Boolean(selectedEdge)}
        onOpenChange={setEdgeEditorOpen}
        title="Edit path"
        description={
          selectedEdge
            ? `Route from ${nodeLookup.get(selectedEdge.fromNodeId)?.title || "From node"} to ${
                nodeLookup.get(selectedEdge.toNodeId)?.title || "To node"
              }.`
            : undefined
        }
        panelClassName="max-w-2xl"
        bodyClassName="space-y-4"
      >
        {selectedEdge ? (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  deleteEdge(selectedEdge.id);
                  setEdgeEditorOpen(false);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-2">
              <Label>When should this path run?</Label>
              <Select
                value={selectedEdge.trigger}
                onChange={(event) => {
                  const trigger =
                    event.target.value === "intent"
                      ? "intent"
                      : event.target.value === "timer"
                        ? "timer"
                        : "fallback";
                  setEdgePatch(selectedEdge.id, {
                    trigger,
                    intent: trigger === "intent" ? selectedEdge.intent || "interest" : "",
                  });
                }}
              >
                <option value="intent">When a reply arrives</option>
                <option value="timer">No reply after waiting</option>
                <option value="fallback">No reply fallback</option>
              </Select>
            </div>

            {selectedEdge.trigger === "intent" ? (
              <div className="grid gap-2">
                <Label>Reply category</Label>
                <Select
                  value={selectedEdge.intent}
                  onChange={(event) => {
                    const value = event.target.value;
                    const intent =
                      value === "question" ||
                      value === "interest" ||
                      value === "objection" ||
                      value === "unsubscribe" ||
                      value === "other"
                        ? value
                        : "";
                    setEdgePatch(selectedEdge.id, { intent });
                  }}
                >
                  <option value="">No reply</option>
                  <option value="question">Asked for more info</option>
                  <option value="interest">Interested</option>
                  <option value="objection">Not now</option>
                  <option value="other">Wrong person</option>
                  <option value="unsubscribe">Negative response</option>
                </Select>
              </div>
            ) : null}

            {selectedEdge.trigger === "timer" ? (
              <div className="grid gap-2">
                <Label>Wait before this branch fires (minutes)</Label>
                <Input
                  type="number"
                  min={0}
                  max={10080}
                  value={selectedEdge.waitMinutes}
                  onChange={(event) =>
                    setEdgePatch(selectedEdge.id, {
                      waitMinutes: clamp(Number(event.target.value || selectedEdge.waitMinutes), 0, 10080),
                    })
                  }
                />
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  Current delay: {formatWaitMinutes(selectedEdge.waitMinutes)}. Example: `7200` = 5 days.
                </div>
                <div className="flex flex-wrap gap-2">
                  {[60, 1440, 4320, 7200].map((minutes) => (
                    <Button
                      key={minutes}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEdgePatch(selectedEdge.id, { waitMinutes: minutes })}
                    >
                      {formatWaitMinutes(minutes)}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SettingsModal>
    </div>
  );
}
