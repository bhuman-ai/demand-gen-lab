"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronRight,
  Loader2,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  cancelOperatorActionApi,
  confirmOperatorActionApi,
  fetchOperatorThreadDetail,
  fetchOperatorThreads,
  sendOperatorChat,
} from "@/lib/client-api";
import type { OperatorAction, OperatorMessage, OperatorThreadDetail } from "@/lib/operator-types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
}

function actionBadgeVariant(action: OperatorAction) {
  if (action.status === "completed") return "success" as const;
  if (action.status === "failed" || action.status === "blocked") return "danger" as const;
  if (action.status === "awaiting_approval") return "accent" as const;
  return "muted" as const;
}

function messageCardTone(message: OperatorMessage) {
  if (message.kind === "receipt") {
    return "border-[color:var(--success-border)] bg-[color:var(--success-soft)]";
  }
  if (message.kind === "approval_request") {
    return "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)]";
  }
  if (message.kind === "system_note") {
    return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]";
  }
  if (message.role === "user") {
    return "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-foreground)]";
  }
  return "border-[color:var(--border)] bg-[color:var(--surface-muted)]";
}

function MessageBody({ message, actionsById }: { message: OperatorMessage; actionsById: Map<string, OperatorAction> }) {
  const content = asRecord(message.content);
  if (message.kind === "message" && message.role === "assistant") {
    const assistant = asRecord(content.assistant);
    const findings = asStringArray(assistant.findings);
    const recommendations = asStringArray(assistant.recommendations);
    return (
      <div className="space-y-2">
        <div className="text-sm leading-6">{asString(content.text) || asString(assistant.summary)}</div>
        {findings.length ? (
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">What I found</div>
            <div className="space-y-1 text-sm text-[color:var(--foreground)]">
              {findings.map((item) => (
                <div key={item}>• {item}</div>
              ))}
            </div>
          </div>
        ) : null}
        {recommendations.length ? (
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">What I recommend</div>
            <div className="space-y-1 text-sm text-[color:var(--foreground)]">
              {recommendations.map((item) => (
                <div key={item}>• {item}</div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (message.kind === "message") {
    return <div className="text-sm leading-6">{asString(content.text)}</div>;
  }

  if (message.kind === "approval_request") {
    const preview = asRecord(content.preview);
    const actionId = asString(content.actionId);
    const action = actionsById.get(actionId);
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="accent">Approval needed</Badge>
          {action ? <Badge variant={actionBadgeVariant(action)}>{action.status.replace(/_/g, " ")}</Badge> : null}
        </div>
        <div className="text-sm font-medium text-[color:var(--foreground)]">{asString(preview.title) || "Pending action"}</div>
        <div className="text-sm leading-6 text-[color:var(--foreground)]">{asString(preview.summary)}</div>
      </div>
    );
  }

  if (message.kind === "receipt") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--foreground)]">
          <Check className="h-4 w-4" />
          {asString(content.title) || "Action receipt"}
        </div>
        <div className="text-sm leading-6 text-[color:var(--foreground)]">{asString(content.summary)}</div>
        {asStringArray(content.details).length ? (
          <div className="space-y-1 text-sm text-[color:var(--foreground)]">
            {asStringArray(content.details).map((item) => (
              <div key={item}>• {item}</div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (message.kind === "tool_call") {
    return <div className="text-xs text-[color:var(--muted-foreground)]">Running {asString(content.toolName)}...</div>;
  }

  if (message.kind === "tool_result") {
    return (
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">{asString(content.toolName)}</div>
        <div className="text-sm leading-6 text-[color:var(--foreground)]">{asString(content.summary)}</div>
      </div>
    );
  }

  if (message.kind === "system_note") {
    return (
      <div className="space-y-1">
        <div className="text-sm font-medium text-[color:var(--foreground)]">{asString(content.title) || "System note"}</div>
        <div className="text-sm leading-6 text-[color:var(--foreground)]">{asString(content.summary)}</div>
      </div>
    );
  }

  return <div className="text-sm leading-6 text-[color:var(--foreground)]">{JSON.stringify(content)}</div>;
}

const DEFAULT_PROMPTS = [
  "What should I do next?",
  "Add a sender for this brand",
  "Why is the current sender blocked?",
  "Summarize inbox activity",
  "Summarize campaign status",
] as const;

export default function OperatorPanel({
  open,
  onOpenChange,
  activeBrandId,
  activeBrandName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeBrandId: string;
  activeBrandName: string;
}) {
  const [threadDetail, setThreadDetail] = useState<OperatorThreadDetail | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionBusyId, setActionBusyId] = useState("");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const pendingActions = useMemo(
    () => (threadDetail?.actions ?? []).filter((action) => action.status === "awaiting_approval"),
    [threadDetail]
  );
  const actionsById = useMemo(
    () => new Map((threadDetail?.actions ?? []).map((action) => [action.id, action] as const)),
    [threadDetail]
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    const load = async () => {
      if (!activeBrandId) {
        setThreadDetail(null);
        setError("");
        return;
      }
      setLoadingThread(true);
      setError("");
      try {
        const threads = await fetchOperatorThreads({ brandId: activeBrandId, status: "active" });
        if (!mounted) return;
        const latest = threads[0] ?? null;
        if (!latest) {
          setThreadDetail(null);
          return;
        }
        const detail = await fetchOperatorThreadDetail(latest.id);
        if (!mounted) return;
        setThreadDetail(detail);
      } catch (nextError) {
        if (!mounted) return;
        setError(nextError instanceof Error ? nextError.message : "Failed to load Operator thread");
      } finally {
        if (mounted) setLoadingThread(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [activeBrandId, open]);

  useEffect(() => {
    if (!open) return;
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [open, threadDetail]);

  async function refreshThread(threadId: string) {
    const detail = await fetchOperatorThreadDetail(threadId);
    setThreadDetail(detail);
  }

  async function handleSend(message: string) {
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    if (!activeBrandId) {
      setError("Open a brand first so Operator has account context.");
      return;
    }

    setSending(true);
    setError("");
    try {
      const response = await sendOperatorChat({
        threadId: threadDetail?.thread.id,
        brandId: activeBrandId,
        message: trimmed,
      });
      setInput("");
      await refreshThread(response.thread.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Operator request failed");
    } finally {
      setSending(false);
    }
  }

  async function handleConfirm(actionId: string) {
    if (!threadDetail || actionBusyId) return;
    setActionBusyId(actionId);
    setError("");
    try {
      await confirmOperatorActionApi(actionId);
      await refreshThread(threadDetail.thread.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to confirm Operator action");
    } finally {
      setActionBusyId("");
    }
  }

  async function handleCancel(actionId: string) {
    if (!threadDetail || actionBusyId) return;
    setActionBusyId(actionId);
    setError("");
    try {
      await cancelOperatorActionApi(actionId);
      await refreshThread(threadDetail.thread.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to cancel Operator action");
    } finally {
      setActionBusyId("");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[color:color-mix(in_oklab,var(--foreground)_22%,transparent)]/70 backdrop-blur-[1px]">
      <button type="button" className="flex-1" aria-label="Close Operator" onClick={() => onOpenChange(false)} />
      <aside className="relative flex h-full w-full max-w-[30rem] flex-col border-l border-[color:var(--border)] bg-[color:var(--surface)] shadow-[0_24px_70px_-40px_color-mix(in_oklab,var(--shadow)_92%,transparent)]">
        <div className="border-b border-[color:var(--border)] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="accent" className="gap-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  Operator
                </Badge>
                {activeBrandName ? <Badge variant="muted">{activeBrandName}</Badge> : null}
              </div>
              <div className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                Ask what is happening, what to do next, or tell Operator to take the safe parts.
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close Operator">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div ref={scrollerRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {!activeBrandId ? (
            <div className="rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
              Select a brand first. Operator is scoped to the active brand context.
            </div>
          ) : null}

          {loadingThread ? (
            <div className="inline-flex items-center gap-2 rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading Operator thread...
            </div>
          ) : null}

          {error ? (
            <div className="rounded-[14px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3 text-sm text-[color:var(--danger)]">
              {error}
            </div>
          ) : null}

          {!loadingThread && activeBrandId && !threadDetail?.messages.length ? (
            <div className="space-y-4">
              <div className="rounded-[16px] border border-[color:var(--border)] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--accent)_14%,var(--surface))_0%,var(--surface-muted)_100%)] px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--foreground)]">
                  <Bot className="h-4 w-4" />
                  Start with one of these
                </div>
                <div className="mt-3 grid gap-2">
                  {DEFAULT_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void handleSend(prompt)}
                      className="flex items-center justify-between rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3 text-left text-sm text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-hover)]"
                    >
                      <span>{prompt}</span>
                      <ChevronRight className="h-4 w-4 text-[color:var(--muted-foreground)]" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {threadDetail?.messages.map((message) => {
            const isUser = message.role === "user" && message.kind === "message";
            return (
              <div key={message.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[92%] rounded-[16px] border px-4 py-3",
                    messageCardTone(message),
                    isUser ? "max-w-[80%]" : ""
                  )}
                >
                  <MessageBody message={message} actionsById={actionsById} />
                </div>
              </div>
            );
          })}
        </div>

        {pendingActions.length ? (
          <div className="border-t border-[color:var(--border)] bg-[color:var(--surface-muted)] px-5 py-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[color:var(--foreground)]">
              <AlertCircle className="h-4 w-4 text-[color:var(--accent)]" />
              Pending approvals
            </div>
            <div className="space-y-3">
              {pendingActions.map((action) => (
                <div key={action.id} className="rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[color:var(--foreground)]">
                        {asString(action.preview.title) || "Pending action"}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                        {asString(action.preview.summary) || action.toolName}
                      </div>
                    </div>
                    <Badge variant={actionBadgeVariant(action)}>{action.status.replace(/_/g, " ")}</Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleConfirm(action.id)}
                      disabled={Boolean(actionBusyId)}
                    >
                      {actionBusyId === action.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Confirm
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCancel(action.id)}
                      disabled={Boolean(actionBusyId)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="border-t border-[color:var(--border)] px-5 py-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {DEFAULT_PROMPTS.slice(0, 3).map((prompt) => (
              <Button
                key={prompt}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void handleSend(prompt)}
                disabled={sending || !activeBrandId}
              >
                {prompt}
              </Button>
            ))}
          </div>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSend(input);
            }}
          >
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend(input);
                }
              }}
              placeholder={
                activeBrandId
                  ? "Ask Operator what is wrong, what to do next, or tell it to take an action."
                  : "Select a brand to use Operator."
              }
              className="min-h-[112px]"
              disabled={sending || !activeBrandId}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-[color:var(--muted-foreground)]">
                `Enter` sends. `Shift+Enter` adds a new line.
              </div>
              <Button type="submit" disabled={sending || !activeBrandId || !input.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                Send
              </Button>
            </div>
          </form>
        </div>
      </aside>
    </div>
  );
}
