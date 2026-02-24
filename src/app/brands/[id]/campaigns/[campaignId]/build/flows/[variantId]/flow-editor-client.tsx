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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchBrand,
  fetchCampaign,
  fetchConversationMapApi,
  publishConversationMapApi,
  previewConversationNodeApi,
  saveConversationMapDraftApi,
  suggestConversationMapApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { ConversationFlowEdge, ConversationFlowGraph, ConversationFlowNode, ConversationMap } from "@/lib/factory-types";

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

function defaultNode(kind: "message" | "terminal" = "message", x = 80, y = 160): ConversationFlowNode {
  const subject = kind === "terminal" ? "" : "Quick follow-up";
  const body = kind === "terminal" ? "" : "Hi {{firstName}},\n\nQuick follow-up on {{brandName}}.";
  return {
    id: makeNodeId(),
    kind,
    title: kind === "terminal" ? "End" : "Message",
    copyMode: "prompt_v1",
    promptTemplate:
      kind === "terminal"
        ? ""
        : [
            "Write a concise follow-up email for this node.",
            "Use concrete language and include exactly one clear CTA.",
            "Reference context variables only if relevant.",
            `Legacy subject example: ${subject}`,
            `Legacy body example:\n${body}`,
          ].join("\n"),
    promptVersion: 1,
    promptPolicy: {
      subjectMaxWords: 8,
      bodyMaxWords: 120,
      exactlyOneCta: true,
    },
    subject,
    body,
    autoSend: kind === "message",
    delayMinutes: 0,
    x,
    y,
  };
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
  if (edge.trigger === "intent") return edge.intent || "reply";
  if (edge.trigger === "timer") return `wait ${edge.waitMinutes}m`;
  return "fallback";
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
        "rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]/95 shadow-xl",
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

      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
        <div
          className="h-full rounded-full bg-[color:var(--accent)] transition-all duration-500 ease-out"
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
}: {
  brandId: string;
  campaignId: string;
  variantId: string;
  backHref?: string;
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
  const [previewError, setPreviewError] = useState("");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [hasFittedInitialView, setHasFittedInitialView] = useState(false);

  const load = async () => {
    setError("");
    const [brand, campaign, mapRow] = await Promise.all([
      fetchBrand(brandId),
      fetchCampaign(brandId, campaignId),
      fetchConversationMapApi(brandId, campaignId, variantId),
    ]);

    const variant = campaign.experiments.find((item) => item.id === variantId);
    if (!variant) {
      throw new Error("Variant not found. Save Build first, then open Conversation Map.");
    }

    const nextGraph = withLayout(mapRow?.draftGraph ?? {
      version: 1,
      maxDepth: 5,
      startNodeId: "",
      nodes: [],
      edges: [],
    });

    setBrandName(brand.name || "Brand");
    setCampaignName(campaign.name || "Campaign");
    setVariantName(variant.name || "Variant");
    setMap(mapRow);
    setGraph(nextGraph);
    setHasFittedInitialView(false);
    setSelectedNodeId(nextGraph.startNodeId || nextGraph.nodes[0]?.id || "");
    setSelectedEdgeId("");
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

  useEffect(() => {
    if (!selectedNode || !previewResult || previewResult.nodeId === selectedNode.id) return;
    setPreviewResult(null);
    setPreviewError("");
  }, [selectedNode, previewResult]);

  const nodeLookup = useMemo(() => {
    const next = new Map<string, ConversationFlowNode>();
    if (!graph) return next;
    for (const node of graph.nodes) next.set(node.id, node);
    return next;
  }, [graph]);

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
      });
      setMap(next);
      setGraph(withLayout(next.draftGraph));
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
        });
      }
      const next = await publishConversationMapApi(brandId, campaignId, variantId);
      setMap(next);
      setGraph(withLayout(next.draftGraph));
      setStatusMessage(`Published revision ${next.publishedRevision}.`);
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
      const next = withLayout(suggested);
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
    setPreviewingNodeId(selectedNode.id);
    setPreviewError("");
    try {
      const preview = await previewConversationNodeApi({
        brandId,
        campaignId,
        experimentId: variantId,
        nodeId: selectedNode.id,
        sampleLead: {
          name: "Jordan Lee",
          email: "jordan@acme.com",
          company: "Acme Inc",
          title: "VP Revenue",
          domain: "acme.com",
        },
        sampleReply: {
          intent: "question",
          confidence: 0.78,
          subject: "Re: quick question",
          body: "Can you share a concrete example relevant to our team?",
        },
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
    event.currentTarget.setPointerCapture(event.pointerId);
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
        <CardContent>
          <Button asChild type="button" variant="outline">
            <Link href={backHref || `/brands/${brandId}/campaigns/${campaignId}/build`}>Back</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Conversation Map Canvas</CardTitle>
            <CardDescription>
              {brandName} - {campaignName} - {variantName}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={map?.status === "published" ? "success" : "muted"}>{map?.status || "draft"}</Badge>
            <Badge variant="muted">Revision {map?.publishedRevision ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={generate} disabled={generating}>
            <RefreshCw className="h-4 w-4" />
            {generating ? "Roleplay screening..." : "Generate AI Map"}
          </Button>
          <Button type="button" variant="outline" onClick={saveDraft} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Draft"}
          </Button>
          <Button type="button" onClick={publish} disabled={publishing}>
            <Upload className="h-4 w-4" />
            {publishing ? "Publishing..." : "Publish"}
          </Button>
          <Button asChild type="button" variant="ghost">
            <Link href={backHref || `/brands/${brandId}/campaigns/${campaignId}/build`}>Back</Link>
          </Button>
        </CardContent>
        {statusMessage ? <CardContent className="pt-0 text-sm text-[color:var(--accent)]">{statusMessage}</CardContent> : null}
        {error ? <CardContent className="pt-0 text-sm text-[color:var(--danger)]">{error}</CardContent> : null}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-[color:var(--border)] pb-3">
            <div>
              <CardTitle className="text-base">Canvas</CardTitle>
              <CardDescription>Drag nodes, connect handles, pan with mouse drag, zoom with wheel + ctrl/cmd.</CardDescription>
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
              className="relative w-full cursor-grab overflow-hidden bg-[radial-gradient(circle_at_center,_rgba(59,130,246,0.08),transparent_55%)]"
              style={{ minHeight: `${CANVAS_MIN_HEIGHT}px` }}
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
                          stroke={selected ? "rgba(96,165,250,0.5)" : "rgba(147,197,253,0.3)"}
                          strokeWidth={selected ? 8 : 6}
                          strokeLinecap="round"
                          className="pointer-events-none"
                        />
                        <path
                          data-edge-path="true"
                          d={bezierPath(fromX, fromY, toX, toY)}
                          fill="none"
                          stroke={selected ? "#60a5fa" : "#93c5fd"}
                          strokeWidth={selected ? 3.2 : 2.5}
                          strokeLinecap="round"
                          className="pointer-events-auto cursor-pointer"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedEdgeId(edge.id);
                            setSelectedNodeId("");
                          }}
                        />
                        <text
                          x={(fromX + toX) / 2}
                          y={(fromY + toY) / 2 - 8}
                          textAnchor="middle"
                          fill="#c7ddff"
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
                {graph.nodes.map((node) => {
                  const isSelected = selectedNodeId === node.id;
                  const isStart = graph.startNodeId === node.id;
                  return (
                    <div
                      key={node.id}
                      data-node-card="true"
                      className="absolute rounded-2xl border bg-[color:var(--surface)] shadow-lg"
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
                        className="absolute -left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-[color:var(--border-strong)] bg-[color:var(--surface)]"
                        title="Connect here"
                        onPointerUp={(event) => completeConnect(event, node.id)}
                        onPointerDown={(event) => event.stopPropagation()}
                      />

                      <button
                        type="button"
                        className="absolute -right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-[color:var(--accent)] bg-[color:var(--accent)]"
                        title="Start connection"
                        onPointerDown={(event) => startConnect(event, node.id)}
                      />

                      <div className="border-b border-[color:var(--border)] px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-base font-semibold">{node.title || "Untitled"}</div>
                          <div className="flex items-center gap-1">
                            {isStart ? <Badge variant="accent">Start</Badge> : null}
                            {node.kind === "message" ? <Badge variant="success">prompt</Badge> : null}
                            <Badge variant={node.kind === "terminal" ? "muted" : "default"}>{node.kind}</Badge>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 px-4 py-3 text-sm leading-6 text-[color:var(--muted-foreground)]">
                        <div className="line-clamp-5">
                          <strong>Prompt:</strong> {node.kind === "terminal" ? "Terminal node" : promptSnippet(node.promptTemplate)}
                        </div>
                        <div className="flex items-center justify-between">
                          <span>{node.autoSend ? "Auto-send" : "Manual send"}</span>
                          <span>Delay {node.delayMinutes}m</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {generating ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-[color:var(--surface)]/82 px-4 py-6 backdrop-blur-sm">
                  <RoleplayScreeningLoader tick={roleplayTick} variantName={variantName} compact />
                </div>
              ) : null}

              <div className="pointer-events-none absolute bottom-4 left-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-[13px] text-[color:var(--muted-foreground)] shadow-sm">
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
            <CardTitle className="text-base">Inspector</CardTitle>
            <CardDescription>Edit selected node/edge details and map settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="map-max-depth">Max Depth (turns)</Label>
              <Input
                id="map-max-depth"
                type="number"
                min={1}
                max={5}
                value={graph.maxDepth}
                onChange={(event) =>
                  setGraph((prev) =>
                    prev
                      ? {
                          ...prev,
                          maxDepth: clamp(Number(event.target.value || prev.maxDepth), 1, 5),
                        }
                      : prev
                  )
                }
              />
            </div>

            {selectedNode ? (
              <div className="space-y-3 rounded-xl border border-[color:var(--border)] p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Node</div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => deleteNode(selectedNode.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-2">
                  <Label>Title</Label>
                  <Input value={selectedNode.title} onChange={(event) => setNodePatch(selectedNode.id, { title: event.target.value })} />
                </div>

                <div className="grid gap-2">
                  <Label>Kind</Label>
                  <Select
                    value={selectedNode.kind}
                    onChange={(event) => {
                      const kind = event.target.value === "terminal" ? "terminal" : "message";
                      setNodePatch(selectedNode.id, {
                        kind,
                        copyMode: "prompt_v1",
                        promptTemplate:
                          kind === "terminal"
                            ? ""
                            : selectedNode.promptTemplate ||
                              [
                                `Write this node message for "${selectedNode.title || "Message"}".`,
                                "Keep it concrete and include exactly one CTA.",
                              ].join("\n"),
                        promptVersion: Math.max(1, Number(selectedNode.promptVersion || 1)),
                        promptPolicy: selectedNode.promptPolicy,
                        autoSend: kind === "terminal" ? false : selectedNode.autoSend,
                      });
                    }}
                  >
                    <option value="message">message</option>
                    <option value="terminal">terminal</option>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Prompt Template</Label>
                  <Textarea
                    value={selectedNode.promptTemplate}
                    disabled={selectedNode.kind === "terminal"}
                    rows={8}
                    onChange={(event) => setNodePatch(selectedNode.id, { promptTemplate: event.target.value })}
                  />
                </div>

                {selectedNode.kind === "message" ? (
                  <div className="grid gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                      Prompt Policy
                    </div>
                    <div className="grid gap-2">
                      <Label>Subject Max Words</Label>
                      <Input
                        type="number"
                        min={3}
                        max={20}
                        value={selectedNode.promptPolicy.subjectMaxWords}
                        onChange={(event) =>
                          setNodePatch(selectedNode.id, {
                            promptPolicy: {
                              ...selectedNode.promptPolicy,
                              subjectMaxWords: clamp(Number(event.target.value || selectedNode.promptPolicy.subjectMaxWords), 3, 20),
                            },
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Body Max Words</Label>
                      <Input
                        type="number"
                        min={40}
                        max={260}
                        value={selectedNode.promptPolicy.bodyMaxWords}
                        onChange={(event) =>
                          setNodePatch(selectedNode.id, {
                            promptPolicy: {
                              ...selectedNode.promptPolicy,
                              bodyMaxWords: clamp(Number(event.target.value || selectedNode.promptPolicy.bodyMaxWords), 40, 260),
                            },
                          })
                        }
                      />
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedNode.promptPolicy.exactlyOneCta}
                        onChange={(event) =>
                          setNodePatch(selectedNode.id, {
                            promptPolicy: {
                              ...selectedNode.promptPolicy,
                              exactlyOneCta: event.target.checked,
                            },
                          })
                        }
                      />
                      Require exactly one CTA
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void generatePreview()}
                      disabled={previewingNodeId === selectedNode.id}
                    >
                      {previewingNodeId === selectedNode.id ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Generating Preview...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          Generate Preview
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
                ) : null}

                <div className="grid gap-2">
                  <Label>Delay (minutes)</Label>
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
                </div>

                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedNode.autoSend}
                    disabled={selectedNode.kind === "terminal"}
                    onChange={(event) => setNodePatch(selectedNode.id, { autoSend: event.target.checked })}
                  />
                  Auto-send
                </label>

                <Button
                  type="button"
                  size="sm"
                  variant={graph.startNodeId === selectedNode.id ? "default" : "outline"}
                  onClick={() => setGraph((prev) => (prev ? { ...prev, startNodeId: selectedNode.id } : prev))}
                >
                  Set As Start Node
                </Button>
              </div>
            ) : null}

            {selectedEdge ? (
              <div className="space-y-3 rounded-xl border border-[color:var(--border)] p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Edge</div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => deleteEdge(selectedEdge.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-2">
                  <Label>From</Label>
                  <Select value={selectedEdge.fromNodeId} onChange={(event) => setEdgePatch(selectedEdge.id, { fromNodeId: event.target.value })}>
                    {graph.nodes.map((node) => (
                      <option key={node.id} value={node.id}>{node.title}</option>
                    ))}
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>To</Label>
                  <Select value={selectedEdge.toNodeId} onChange={(event) => setEdgePatch(selectedEdge.id, { toNodeId: event.target.value })}>
                    {graph.nodes.map((node) => (
                      <option key={node.id} value={node.id}>{node.title}</option>
                    ))}
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Trigger</Label>
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
                    <option value="intent">intent</option>
                    <option value="timer">timer</option>
                    <option value="fallback">fallback</option>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Intent</Label>
                  <Select
                    value={selectedEdge.intent}
                    disabled={selectedEdge.trigger !== "intent"}
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
                    <option value="">none</option>
                    <option value="interest">interest</option>
                    <option value="question">question</option>
                    <option value="objection">objection</option>
                    <option value="unsubscribe">unsubscribe</option>
                    <option value="other">other</option>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Wait (minutes)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10080}
                    value={selectedEdge.waitMinutes}
                    onChange={(event) => setEdgePatch(selectedEdge.id, { waitMinutes: clamp(Number(event.target.value || selectedEdge.waitMinutes), 0, 10080) })}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Priority</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={selectedEdge.priority}
                    onChange={(event) => setEdgePatch(selectedEdge.id, { priority: clamp(Number(event.target.value || selectedEdge.priority), 1, 100) })}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Confidence Threshold</Label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selectedEdge.confidenceThreshold}
                    onChange={(event) => setEdgePatch(selectedEdge.id, { confidenceThreshold: clamp(Number(event.target.value || selectedEdge.confidenceThreshold), 0, 1) })}
                  />
                </div>
              </div>
            ) : null}

            {!selectedNode && !selectedEdge ? (
              <div className="rounded-xl border border-dashed border-[color:var(--border)] p-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                Select a node or edge on the canvas to edit it. Start a connection by dragging from a node’s right dot to another node’s left dot.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
