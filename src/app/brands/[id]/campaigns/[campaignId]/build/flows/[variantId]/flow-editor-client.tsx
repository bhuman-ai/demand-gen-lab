"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Trash2, Upload } from "lucide-react";
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
  saveConversationMapDraftApi,
  suggestConversationMapApi,
} from "@/lib/client-api";
import type { ConversationFlowGraph, ConversationFlowNode, ConversationMap } from "@/lib/factory-types";

const makeNodeId = () => `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const makeEdgeId = () => `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function defaultNode(kind: "message" | "terminal" = "message"): ConversationFlowNode {
  return {
    id: makeNodeId(),
    kind,
    title: kind === "terminal" ? "End" : "Message",
    subject: kind === "terminal" ? "" : "Quick follow-up",
    body: kind === "terminal" ? "" : "Hi {{firstName}},\n\nQuick follow-up on {{brandName}}.",
    autoSend: kind === "message",
    delayMinutes: 0,
  };
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
  const [brandName, setBrandName] = useState("Brand");
  const [campaignName, setCampaignName] = useState("Campaign");
  const [variantName, setVariantName] = useState("Variant");
  const [map, setMap] = useState<ConversationMap | null>(null);
  const [graph, setGraph] = useState<ConversationFlowGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

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

    setBrandName(brand.name || "Brand");
    setCampaignName(campaign.name || "Campaign");
    setVariantName(variant.name || "Variant");
    setMap(mapRow);
    setGraph(mapRow?.draftGraph ?? null);
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

  const sortedNodes = useMemo(() => {
    if (!graph) return [];
    return [...graph.nodes].sort((a, b) => a.title.localeCompare(b.title));
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
      setGraph(next.draftGraph);
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
      setGraph(next.draftGraph);
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
      setGraph(suggested);
      setStatusMessage("AI map generated. Save draft to keep it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate map");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading conversation map...</div>;
  }

  if (!graph) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversation map unavailable</CardTitle>
          <CardDescription className="text-[color:var(--danger)]">
            {error || "Could not initialize map."}
          </CardDescription>
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
            <CardTitle className="text-base">Conversation Map</CardTitle>
            <CardDescription>
              {brandName} - {campaignName} - {variantName}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={map?.status === "published" ? "success" : "muted"}>
              {map?.status || "draft"}
            </Badge>
            <Badge variant="muted">Revision {map?.publishedRevision ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={generate} disabled={generating}>
            <RefreshCw className="h-4 w-4" />
            {generating ? "Generating..." : "Generate AI Map"}
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
        {statusMessage ? (
          <CardContent className="pt-0 text-sm text-[color:var(--accent)]">{statusMessage}</CardContent>
        ) : null}
        {error ? (
          <CardContent className="pt-0 text-sm text-[color:var(--danger)]">{error}</CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Map Settings</CardTitle>
          <CardDescription>Set global constraints for this variant conversation.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
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
                        maxDepth: Math.max(1, Math.min(5, Number(event.target.value || prev.maxDepth))),
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="map-start-node">Start Node</Label>
            <Select
              id="map-start-node"
              value={graph.startNodeId}
              onChange={(event) =>
                setGraph((prev) => (prev ? { ...prev, startNodeId: event.target.value } : prev))
              }
            >
              {sortedNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.title} ({node.id.slice(-4)})
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Nodes</CardTitle>
            <CardDescription>Define each message and whether it can auto-send.</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setGraph((prev) =>
                prev
                  ? {
                      ...prev,
                      nodes: [...prev.nodes, defaultNode("message")],
                    }
                  : prev
              )
            }
          >
            <Plus className="h-4 w-4" />
            Add Node
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {graph.nodes.map((node, index) => (
            <div key={node.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Node {index + 1}</div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setGraph((prev) => {
                      if (!prev) return prev;
                      const remainingNodes = prev.nodes.filter((item) => item.id !== node.id);
                      const remainingEdges = prev.edges.filter(
                        (edge) => edge.fromNodeId !== node.id && edge.toNodeId !== node.id
                      );
                      const nextStart = prev.startNodeId === node.id ? remainingNodes[0]?.id ?? "" : prev.startNodeId;
                      return {
                        ...prev,
                        startNodeId: nextStart,
                        nodes: remainingNodes,
                        edges: remainingEdges,
                      };
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Title</Label>
                  <Input
                    value={node.title}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              nodes: prev.nodes.map((item) =>
                                item.id === node.id ? { ...item, title: event.target.value } : item
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Kind</Label>
                  <Select
                    value={node.kind}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              nodes: prev.nodes.map((item) =>
                                item.id === node.id
                                  ? {
                                      ...item,
                                      kind: event.target.value === "terminal" ? "terminal" : "message",
                                      autoSend:
                                        event.target.value === "terminal" ? false : item.autoSend,
                                    }
                                  : item
                              ),
                            }
                          : prev
                      )
                    }
                  >
                    <option value="message">message</option>
                    <option value="terminal">terminal</option>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Subject</Label>
                  <Input
                    value={node.subject}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              nodes: prev.nodes.map((item) =>
                                item.id === node.id ? { ...item, subject: event.target.value } : item
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Delay (minutes)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10080}
                    value={node.delayMinutes}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              nodes: prev.nodes.map((item) =>
                                item.id === node.id
                                  ? {
                                      ...item,
                                      delayMinutes: Math.max(
                                        0,
                                        Math.min(10080, Number(event.target.value || item.delayMinutes))
                                      ),
                                    }
                                  : item
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2 md:col-span-2">
                  <Label>Body</Label>
                  <Textarea
                    value={node.body}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              nodes: prev.nodes.map((item) =>
                                item.id === node.id ? { ...item, body: event.target.value } : item
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={node.autoSend}
                    disabled={node.kind === "terminal"}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              nodes: prev.nodes.map((item) =>
                                item.id === node.id ? { ...item, autoSend: event.target.checked } : item
                              ),
                            }
                          : prev
                      )
                    }
                  />
                  Auto-send
                </label>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Edges</CardTitle>
            <CardDescription>Define branching rules between nodes.</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setGraph((prev) =>
                prev
                  ? {
                      ...prev,
                      edges: [
                        ...prev.edges,
                        {
                          id: makeEdgeId(),
                          fromNodeId: prev.nodes[0]?.id ?? "",
                          toNodeId: prev.nodes[1]?.id ?? prev.nodes[0]?.id ?? "",
                          trigger: "fallback",
                          intent: "",
                          waitMinutes: 0,
                          confidenceThreshold: 0.7,
                          priority: 1,
                        },
                      ],
                    }
                  : prev
              )
            }
          >
            <Plus className="h-4 w-4" />
            Add Edge
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {graph.edges.map((edge, index) => (
            <div key={edge.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Edge {index + 1}</div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setGraph((prev) =>
                      prev ? { ...prev, edges: prev.edges.filter((item) => item.id !== edge.id) } : prev
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="grid gap-2">
                  <Label>From</Label>
                  <Select
                    value={edge.fromNodeId}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              edges: prev.edges.map((item) =>
                                item.id === edge.id ? { ...item, fromNodeId: event.target.value } : item
                              ),
                            }
                          : prev
                      )
                    }
                  >
                    {sortedNodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.title}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>To</Label>
                  <Select
                    value={edge.toNodeId}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              edges: prev.edges.map((item) =>
                                item.id === edge.id ? { ...item, toNodeId: event.target.value } : item
                              ),
                            }
                          : prev
                      )
                    }
                  >
                    {sortedNodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.title}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Trigger</Label>
                  <Select
                    value={edge.trigger}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              edges: prev.edges.map((item) =>
                                item.id === edge.id
                                  ? {
                                      ...item,
                                      trigger:
                                        event.target.value === "intent"
                                          ? "intent"
                                          : event.target.value === "timer"
                                            ? "timer"
                                            : "fallback",
                                      intent: event.target.value === "intent" ? item.intent || "interest" : "",
                                    }
                                  : item
                              ),
                            }
                          : prev
                      )
                    }
                  >
                    <option value="intent">intent</option>
                    <option value="timer">timer</option>
                    <option value="fallback">fallback</option>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Intent</Label>
                  <Select
                    value={edge.intent}
                    disabled={edge.trigger !== "intent"}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              edges: prev.edges.map((item) =>
                                item.id === edge.id
                                  ? {
                                      ...item,
                                      intent:
                                        event.target.value === "question" ||
                                        event.target.value === "interest" ||
                                        event.target.value === "objection" ||
                                        event.target.value === "unsubscribe" ||
                                        event.target.value === "other"
                                          ? event.target.value
                                          : "",
                                    }
                                  : item
                              ),
                            }
                          : prev
                      )
                    }
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
                    value={edge.waitMinutes}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              edges: prev.edges.map((item) =>
                                item.id === edge.id
                                  ? {
                                      ...item,
                                      waitMinutes: Math.max(
                                        0,
                                        Math.min(10080, Number(event.target.value || item.waitMinutes))
                                      ),
                                    }
                                  : item
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Priority</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={edge.priority}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              edges: prev.edges.map((item) =>
                                item.id === edge.id
                                  ? {
                                      ...item,
                                      priority: Math.max(
                                        1,
                                        Math.min(100, Number(event.target.value || item.priority))
                                      ),
                                    }
                                  : item
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Confidence Threshold</Label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={edge.confidenceThreshold}
                    onChange={(event) =>
                      setGraph((prev) =>
                        prev
                          ? {
                              ...prev,
                              edges: prev.edges.map((item) =>
                                item.id === edge.id
                                  ? {
                                      ...item,
                                      confidenceThreshold: Math.max(
                                        0,
                                        Math.min(1, Number(event.target.value || item.confidenceThreshold))
                                      ),
                                    }
                                  : item
                              ),
                            }
                          : prev
                      )
                    }
                  />
                </div>
              </div>
            </div>
          ))}
          {!graph.edges.length ? (
            <div className="text-sm text-[color:var(--muted-foreground)]">
              No edges yet. Add at least one branch from the start node.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
