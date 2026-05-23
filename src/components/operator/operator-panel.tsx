"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Clock3,
  FileSearch,
  ExternalLink,
  Loader2,
  MessageSquareText,
  SendHorizontal,
  Sparkles,
  X,
  ListTodo,
} from "lucide-react";
import {
  cancelOperatorActionApi,
  confirmOperatorActionApi,
  fetchOperatorThreadDetail,
  fetchOperatorThreads,
  processOperatorRunApi,
  sendOperatorChat,
  startOperatorChat,
} from "@/lib/client-api";
import type {
  OperatorAction,
  OperatorEvidenceCheck,
  OperatorEvidenceTraceEntry,
  OperatorExecutionEnvelope,
  OperatorExecutionForm,
  OperatorMessage,
  OperatorRun,
  OperatorThreadDetail,
} from "@/lib/operator-types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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

function toStringRecord(value: FormData) {
  const next: Record<string, string> = {};
  for (const [key, entry] of value.entries()) {
    next[key] = String(entry ?? "").trim();
  }
  return next;
}

function splitSenderEmail(value: string) {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (!match) return null;
  return {
    fromLocalPart: match[1] ?? "",
    domain: match[2] ?? "",
  };
}

function executionStateLabel(state: OperatorExecutionEnvelope["state"]) {
  switch (state) {
    case "need_info":
      return "Need info";
    case "awaiting_confirmation":
      return "Ready to run";
    case "running":
      return "Running";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return "Answer only";
  }
}

function executionCardTone(state: OperatorExecutionEnvelope["state"]) {
  switch (state) {
    case "need_info":
    case "awaiting_confirmation":
      return "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)]";
    case "completed":
      return "border-[color:var(--success-border)] bg-[color:var(--success-soft)]";
    case "failed":
      return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]";
    case "canceled":
      return "border-[color:var(--border)] bg-[color:var(--surface-muted)]";
    default:
      return "border-[color:var(--border)] bg-[color:var(--surface)]";
  }
}

function runStatusLabel(status: OperatorRun["status"]) {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return "Queued";
  }
}

function runBadgeVariant(status: OperatorRun["status"]): "success" | "danger" | "muted" | "accent" {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "running") return "accent";
  return "muted";
}

function messageCardTone(message: OperatorMessage) {
  if (message.kind === "system_note") {
    return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]";
  }
  if (message.role === "user") {
    return "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)]";
  }
  return "border-transparent bg-transparent";
}

function executionHeadline(execution: OperatorExecutionEnvelope) {
  const receipt = asRecord(execution.receipt);
  const preview = asRecord(execution.preview);
  if (asString(receipt.title)) return asString(receipt.title);
  if (asString(preview.title)) return asString(preview.title);
  if (execution.intent?.verb && execution.intent.objectType) {
    return `${execution.intent.verb[0]?.toUpperCase() ?? ""}${execution.intent.verb.slice(1)} ${execution.intent.objectType}`;
  }
  return "Task";
}

function executionSummary(execution: OperatorExecutionEnvelope) {
  const receipt = asRecord(execution.receipt);
  const preview = asRecord(execution.preview);
  if (asString(receipt.summary)) return asString(receipt.summary);
  if (asString(preview.summary)) return asString(preview.summary);
  return "";
}

function readMessageExecution(message: OperatorMessage | null) {
  const execution = asRecord(asRecord(message?.content).execution);
  const state = asString(execution.state);
  if (!state || state === "answer_only") return null;
  return execution as OperatorExecutionEnvelope;
}

function readMessageRun(message: OperatorMessage | null): Pick<OperatorRun, "id" | "status" | "model"> | null {
  const run = asRecord(asRecord(message?.content).run);
  const id = asString(run.id);
  const status = asString(run.status);
  if (!id || !["running", "completed", "failed", "canceled"].includes(status)) return null;
  return {
    id,
    status: status as OperatorRun["status"],
    model: asString(run.model),
  };
}

function readEvidenceTrace(value: unknown): OperatorEvidenceTraceEntry[] {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const row = asRecord(entry);
          return {
            step: Number(row.step ?? 0) || 0,
            toolName: asString(row.toolName),
            riskLevel: asString(row.riskLevel),
            rationale: asString(row.rationale),
            inputSummary: asString(row.inputSummary),
            resultSummary: asString(row.resultSummary),
            error: asString(row.error),
          };
        })
        .filter((entry) => entry.toolName)
    : [];
}

function readEvidenceCheck(value: unknown): OperatorEvidenceCheck | null {
  const row = asRecord(value);
  const status = asString(row.status);
  if (!["verified", "inconclusive", "insufficient"].includes(status)) return null;
  return {
    status: status as OperatorEvidenceCheck["status"],
    summary: asString(row.summary),
    gaps: asStringArray(row.gaps),
  };
}

function evidenceStatusLabel(status: OperatorEvidenceCheck["status"]) {
  if (status === "verified") return "Verified";
  if (status === "inconclusive") return "Inconclusive";
  return "Insufficient";
}

function evidenceTone(status: OperatorEvidenceCheck["status"]) {
  if (status === "verified") return "border-[color:var(--success-border)] bg-[color:var(--success-soft)]";
  if (status === "inconclusive") return "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)]";
  return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]";
}

function extractUrl(value: string) {
  const match = value.match(/https?:\/\/[^\s)]+/);
  return match?.[0] ?? "";
}

function ExecutionCard({
  execution,
  action,
  onConfirm,
  onCancel,
  onChooseReply,
  onSubmitForm,
  actionBusyId,
  sending,
}: {
  execution: OperatorExecutionEnvelope;
  action?: OperatorAction;
  onConfirm: (actionId: string) => void;
  onCancel: (actionId: string) => void;
  onChooseReply: (message: string) => void;
  onSubmitForm: (form: OperatorExecutionForm, values: Record<string, string>) => void;
  actionBusyId: string;
  sending: boolean;
}) {
  const intent = execution.intent;
  const receipt = execution.receipt;
  const missingFields = asStringArray(execution.missingFields);
  const questions = Array.isArray(execution.questions) ? execution.questions : [];
  const forms = Array.isArray(execution.forms) ? execution.forms : [];
  const statusLabel = executionStateLabel(execution.state);
  const actionId = asString(execution.actionId);
  const canConfirm = execution.state === "awaiting_confirmation" && Boolean(actionId) && action?.status === "awaiting_approval";
  const headline = executionHeadline(execution);
  const summary = executionSummary(execution);
  const receiptDetails = asStringArray(receipt?.details);
  const receiptUrls = receiptDetails.map(extractUrl).filter(Boolean);

  return (
    <div className={cn("mt-3 rounded-[12px] border px-3 py-3", executionCardTone(execution.state))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[color:var(--foreground)]">{headline}</div>
          {summary ? (
            <div className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">{summary}</div>
          ) : null}
        </div>
        <Badge variant={execution.state === "completed" ? "success" : execution.state === "failed" ? "danger" : execution.state === "awaiting_confirmation" || execution.state === "need_info" ? "accent" : "muted"}>
          {statusLabel}
        </Badge>
      </div>
      <div className="mt-3 grid gap-3 text-sm leading-6 text-[color:var(--foreground)]">
        {intent ? (
          <div className="grid gap-2 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)]/70 px-3 py-3 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">Intent</div>
              <div className="mt-1 font-medium capitalize">{intent.verb} {intent.objectType}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">Target</div>
              <div className="mt-1">{intent.objectLabel || "Not resolved yet"}</div>
            </div>
          </div>
        ) : null}
        {receiptUrls.length ? (
          <div className="flex flex-wrap gap-2">
            {receiptUrls.map((url) => (
              <Button key={url} asChild size="sm">
                <a href={url} target="_blank" rel="noreferrer">
                  Open sign-in link
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            ))}
          </div>
        ) : null}
        {receiptDetails.length ? (
          <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)]/70 px-3 py-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
              Details
            </div>
            <ul className="mt-2 grid gap-1.5">
              {receiptDetails.slice(0, 5).map((detail, index) => {
                const url = extractUrl(detail);
                return (
                  <li key={`${detail}-${index}`} className="break-words text-sm text-[color:var(--foreground)]">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-[color:var(--border-strong)] underline-offset-4"
                      >
                        {detail.replace(url, "sign-in link")}
                      </a>
                    ) : (
                      detail
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {execution.toolName ? (
          <details className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)]/60 px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
            <summary className="cursor-pointer">Technical detail</summary>
            <div className="mt-2 font-mono">{execution.toolName}</div>
          </details>
        ) : null}
        {missingFields.length ? (
          <div>
            <div className="text-[color:var(--muted-foreground)]">Missing:</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {missingFields.map((field) => (
                <Badge key={field} variant="muted">
                  {field}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {asString(execution.error) ? (
          <div>
            <span className="text-[color:var(--muted-foreground)]">Error:</span>{" "}
            <span>{asString(execution.error)}</span>
          </div>
        ) : null}
        {questions.length ? (
          <div className="space-y-3">
            {questions.map((question, index) => {
              const prompt = asString(question?.prompt);
              const options = Array.isArray(question?.options) ? question.options : [];
              if (!prompt || !options.length) return null;
              return (
                <div key={`${prompt}-${index}`}>
                  <div className="text-[color:var(--muted-foreground)]">{prompt}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {options.map((option, optionIndex) => {
                      const label = asString(option?.label);
                      const message = asString(option?.message);
                      if (!label || !message) return null;
                      return (
                        <Button
                          key={`${label}-${optionIndex}`}
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => onChooseReply(message)}
                          disabled={sending || Boolean(actionBusyId)}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {forms.length ? (
          <div className="space-y-3">
            {forms.map((form, formIndex) => {
              const formId = asString(form?.id) || `operator-form-${formIndex}`;
              const title = asString(form?.title);
              const description = asString(form?.description);
              const submitLabel = asString(form?.submitLabel) || "Continue";
              const fields = Array.isArray(form?.fields) ? form.fields : [];
              if (!title || !fields.length) return null;
              return (
                <form
                  key={formId}
                  className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)]/80 p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSubmitForm(form, toStringRecord(new FormData(event.currentTarget)));
                  }}
                >
                  <div className="text-sm font-medium text-[color:var(--foreground)]">{title}</div>
                  {description ? (
                    <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">{description}</div>
                  ) : null}
                  <div className="mt-3 grid gap-3">
                    {fields.map((field, fieldIndex) => {
                      const fieldName = asString(field?.name);
                      const fieldLabel = asString(field?.label);
                      const fieldType = asString(field?.type);
                      const fieldId = `${formId}-${fieldName || fieldIndex}`;
                      if (!fieldName || !fieldLabel || !fieldType) return null;
                      if (fieldType === "select") {
                        const options = Array.isArray(field?.options) ? field.options : [];
                        return (
                          <div key={fieldId} className="space-y-1.5">
                            <Label htmlFor={fieldId}>{fieldLabel}</Label>
                            <Select
                              id={fieldId}
                              name={fieldName}
                              defaultValue={asString(field?.value)}
                              required={Boolean(field?.required)}
                              disabled={sending || Boolean(actionBusyId)}
                            >
                              <option value="">
                                {asString(field?.placeholder) || `Select ${fieldLabel.toLowerCase()}`}
                              </option>
                              {options.map((option, optionIndex) => {
                                const label = asString(option?.label);
                                const value = asString(option?.value);
                                if (!label || !value) return null;
                                return (
                                  <option key={`${fieldId}-${optionIndex}`} value={value}>
                                    {label}
                                  </option>
                                );
                              })}
                            </Select>
                          </div>
                        );
                      }
                      return (
                        <div key={fieldId} className="space-y-1.5">
                          <Label htmlFor={fieldId}>{fieldLabel}</Label>
                          <Input
                            id={fieldId}
                            name={fieldName}
                            type={fieldType}
                            defaultValue={asString(field?.value)}
                            placeholder={asString(field?.placeholder)}
                            required={Boolean(field?.required)}
                            autoComplete={asString(field?.autoComplete) || undefined}
                            disabled={sending || Boolean(actionBusyId)}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3">
                    <Button type="submit" size="sm" disabled={sending || Boolean(actionBusyId)}>
                      {submitLabel}
                    </Button>
                  </div>
                </form>
              );
            })}
          </div>
        ) : null}
      </div>
      {canConfirm ? (
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => onConfirm(actionId)}
            disabled={Boolean(actionBusyId)}
          >
            {actionBusyId === actionId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Confirm
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onCancel(actionId)}
            disabled={Boolean(actionBusyId)}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function EvidenceTrace({
  trace,
  check,
}: {
  trace: OperatorEvidenceTraceEntry[];
  check: OperatorEvidenceCheck | null;
}) {
  if (!trace.length && !check) return null;
  const status = check?.status ?? (trace.length ? "inconclusive" : "insufficient");
  return (
    <details className={cn("mt-3 rounded-[12px] border px-3 py-2", evidenceTone(status))}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-[color:var(--foreground)]">
        <span className="inline-flex min-w-0 items-center gap-2">
          <FileSearch className="h-3.5 w-3.5 shrink-0" />
          <span>Evidence</span>
          <span className="text-[color:var(--muted-foreground)]">
            {evidenceStatusLabel(status)}{trace.length ? ` · ${trace.length} tool call${trace.length === 1 ? "" : "s"}` : ""}
          </span>
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--muted-foreground)]" />
      </summary>
      <div className="mt-3 space-y-3">
        {check?.summary ? (
          <div className="text-xs leading-5 text-[color:var(--foreground)]">{check.summary}</div>
        ) : null}
        {check?.gaps.length ? (
          <div className="space-y-1">
            {check.gaps.map((gap, index) => (
              <div key={`${gap}-${index}`} className="text-xs leading-5 text-[color:var(--muted-foreground)]">
                Gap: {gap}
              </div>
            ))}
          </div>
        ) : null}
        {trace.length ? (
          <div className="space-y-2">
            {trace.map((entry) => (
              <div key={`${entry.step}-${entry.toolName}`} className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[color:var(--foreground)]">
                  <span>{entry.step ? `${entry.step}. ` : ""}{entry.toolName}</span>
                  {entry.riskLevel ? <Badge variant="muted">{entry.riskLevel}</Badge> : null}
                </div>
                {entry.rationale ? (
                  <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">Why: {entry.rationale}</div>
                ) : null}
                {entry.inputSummary ? (
                  <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">Input: {entry.inputSummary}</div>
                ) : null}
                <div className={cn("mt-1 text-xs leading-5", entry.error ? "text-[color:var(--danger)]" : "text-[color:var(--foreground)]")}>
                  {entry.error ? `Error: ${entry.error}` : entry.resultSummary || "Completed."}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function MessageBody({
  message,
  actionsById,
  onConfirm,
  onCancel,
  onChooseReply,
  onSubmitForm,
  actionBusyId,
  sending,
}: {
  message: OperatorMessage;
  actionsById: Map<string, OperatorAction>;
  onConfirm: (actionId: string) => void;
  onCancel: (actionId: string) => void;
  onChooseReply: (message: string) => void;
  onSubmitForm: (form: OperatorExecutionForm, values: Record<string, string>) => void;
  actionBusyId: string;
  sending: boolean;
}) {
  const content = asRecord(message.content);
  if (message.kind === "message" && message.role === "assistant") {
    const assistant = asRecord(content.assistant);
    const execution = asRecord(content.execution);
    const run = readMessageRun(message);
    const evidenceTrace = readEvidenceTrace(content.evidenceTrace);
    const evidenceCheck = readEvidenceCheck(content.evidenceCheck);
    const actionId = asString(execution.actionId);
    const action = actionId ? actionsById.get(actionId) : undefined;
    return (
      <div>
        <div className="whitespace-pre-wrap text-sm leading-6">{asString(content.text) || asString(assistant.summary)}</div>
        {run ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
            <Badge variant={runBadgeVariant(run.status)}>{runStatusLabel(run.status)}</Badge>
            {run.model ? <span>{run.model}</span> : null}
            <span className="font-mono">{run.id}</span>
          </div>
        ) : null}
        <EvidenceTrace trace={evidenceTrace} check={evidenceCheck} />
        {asString(execution.state) && asString(execution.state) !== "answer_only" ? (
          <ExecutionCard
            execution={execution as OperatorExecutionEnvelope}
            action={action}
            onConfirm={onConfirm}
            onCancel={onCancel}
            onChooseReply={onChooseReply}
            onSubmitForm={onSubmitForm}
            actionBusyId={actionBusyId}
            sending={sending}
          />
        ) : null}
      </div>
    );
  }

  if (message.kind === "message") {
    return <div className="text-sm leading-6">{asString(content.text)}</div>;
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
  "Any replies?",
  "What changed today?",
  "Add a sender for this brand",
] as const;

type OperatorInitialRequest = {
  id: number;
  message: string;
  autoSend: boolean;
};

export default function OperatorPanel({
  open,
  onOpenChange,
  activeBrandId,
  activeBrandName,
  initialRequest,
  variant = "drawer",
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeBrandId: string;
  activeBrandName: string;
  initialRequest?: OperatorInitialRequest | null;
  variant?: "drawer" | "inline";
  className?: string;
}) {
  const [threadDetail, setThreadDetail] = useState<OperatorThreadDetail | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [processingRunId, setProcessingRunId] = useState("");
  const [pendingRun, setPendingRun] = useState<OperatorRun | null>(null);
  const [actionBusyId, setActionBusyId] = useState("");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lastInitialRequestIdRef = useRef(0);
  const handleSendRef = useRef<(message: string) => void>(() => undefined);

  const visibleMessages = useMemo(
    () =>
      (threadDetail?.messages ?? []).filter(
        (message) =>
          (message.role === "user" && message.kind === "message") ||
          (message.role === "assistant" && message.kind === "message") ||
          message.kind === "system_note"
      ),
    [threadDetail]
  );
  const actionsById = useMemo(
    () => new Map((threadDetail?.actions ?? []).map((action) => [action.id, action] as const)),
    [threadDetail]
  );
  const runs = useMemo(() => threadDetail?.runs ?? [], [threadDetail]);
  const latestExecutionMessage = useMemo(
    () =>
      [...visibleMessages]
        .reverse()
        .find((message) => message.role === "assistant" && message.kind === "message" && readMessageExecution(message)),
    [visibleMessages]
  );
  const latestExecution = latestExecutionMessage ? readMessageExecution(latestExecutionMessage) : null;
  const latestMessageRun = latestExecutionMessage ? readMessageRun(latestExecutionMessage) : null;
  const activeRun =
    (pendingRun?.status === "running" ? pendingRun : null) ??
    runs.find((run) => run.status === "running") ??
    null;
  const latestRun = activeRun ?? runs[0] ?? (pendingRun && pendingRun.status !== "running" ? pendingRun : null);
  const latestTaskSummary = latestExecution ? executionSummary(latestExecution) : "";
  const threadTitle = asString(threadDetail?.thread.title) || (activeBrandName ? `${activeBrandName} Brand GPT thread` : "Brand GPT");
  const activeThreadId =
    threadDetail?.thread.status === "active" && threadDetail.thread.brandId === activeBrandId
      ? threadDetail.thread.id
      : undefined;

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
      setThreadDetail(null);
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
        setThreadDetail(detail?.thread.status === "active" && detail.thread.brandId === activeBrandId ? detail : null);
      } catch (nextError) {
        if (!mounted) return;
        setError(nextError instanceof Error ? nextError.message : "Failed to load Brand GPT thread");
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

  useEffect(() => {
    handleSendRef.current = (message: string) => {
      void handleSend(message);
    };
  });

  useEffect(() => {
    if (!open || !activeBrandId || !initialRequest || lastInitialRequestIdRef.current === initialRequest.id) return;
    lastInitialRequestIdRef.current = initialRequest.id;
    const message = initialRequest.message.trim();
    if (!message) return;
    setInput(message);
    if (initialRequest.autoSend) {
      handleSendRef.current(message);
    }
  }, [activeBrandId, initialRequest, open]);

  useEffect(() => {
    if (!pendingRun) return;
    const refreshed = runs.find((run) => run.id === pendingRun.id);
    if (refreshed && refreshed.status !== pendingRun.status) {
      setPendingRun(refreshed);
    }
  }, [pendingRun, runs]);

  async function refreshThread(threadId: string) {
    const detail = await fetchOperatorThreadDetail(threadId);
    setThreadDetail(detail?.thread.status === "active" && detail.thread.brandId === activeBrandId ? detail : null);
  }

  async function processStartedRun(runId: string, threadId: string) {
    setProcessingRunId(runId);
    try {
      const response = await processOperatorRunApi(runId);
      await refreshThread(response.thread.id || threadId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Brand GPT run failed");
      await refreshThread(threadId).catch(() => undefined);
    } finally {
      setProcessingRunId("");
    }
  }

  async function handleStructuredAction(input: {
    message: string;
    structuredAction: {
      toolName: OperatorExecutionForm["toolName"];
      input: Record<string, unknown>;
    };
  }) {
    const trimmed = input.message.trim();
    if (!trimmed || sending || processingRunId) return;
    if (!activeBrandId) {
      setError("Open a brand first so Brand GPT has account context.");
      return;
    }

    setSending(true);
    setError("");
    try {
      const response = await sendOperatorChat({
        threadId: activeThreadId,
        brandId: activeBrandId,
        message: trimmed,
        structuredAction: input.structuredAction,
      });
      setInput("");
      await refreshThread(response.thread.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Brand GPT request failed");
    } finally {
      setSending(false);
    }
  }

  async function handleSend(message: string) {
    const trimmed = message.trim();
    if (!trimmed || sending || processingRunId) return;
    if (!activeBrandId) {
      setError("Open a brand first so Brand GPT has account context.");
      return;
    }

    setSending(true);
    setError("");
    try {
      const response = await startOperatorChat({
        threadId: activeThreadId,
        brandId: activeBrandId,
        message: trimmed,
      });
      setPendingRun(response.run);
      setInput("");
      await refreshThread(response.thread.id);
      void processStartedRun(response.run.id, response.thread.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Brand GPT request failed");
    } finally {
      setSending(false);
    }
  }

  async function handleSubmitForm(form: OperatorExecutionForm, values: Record<string, string>) {
    if (form.toolName !== "provision_mailpool_sender") {
      setError("This Brand GPT form is not wired yet.");
      return;
    }

    const baseInput: Record<string, unknown> = {
      ...asRecord(form.input),
      brandId: activeBrandId,
      provider: "mailpool",
    };
    if (form.formType === "provision_sender_email") {
      let nextInput = { ...baseInput };
      const domainMode = asString(values.domainMode) || asString(nextInput.domainMode);
      if (domainMode) {
        nextInput.domainMode = domainMode;
      }

      if (values.senderEmail) {
        const parts = splitSenderEmail(values.senderEmail);
        if (!parts) {
          setError("Enter a valid sender email.");
          return;
        }
        nextInput = {
          ...nextInput,
          fromLocalPart: parts.fromLocalPart,
          domain: parts.domain,
        };
      } else {
        const fromLocalPart = asString(values.fromLocalPart) || asString(nextInput.fromLocalPart);
        const domain = (asString(values.domain) || asString(nextInput.domain)).toLowerCase();
        if (!fromLocalPart || !domain) {
          setError("Choose the sender local-part and domain.");
          return;
        }
        nextInput = {
          ...nextInput,
          fromLocalPart,
          domain,
        };
      }

      const senderFirstName = asString(values.senderFirstName) || asString(nextInput.senderFirstName);
      const senderLastName = asString(values.senderLastName) || asString(nextInput.senderLastName);
      if (!senderFirstName || !senderLastName) {
        setError("Enter the real sender first and last name.");
        return;
      }
      nextInput = {
        ...nextInput,
        senderFirstName,
        senderLastName,
      };

      const fromLocalPart = asString(nextInput.fromLocalPart);
      const domain = asString(nextInput.domain);
      const senderName = `${senderFirstName} ${senderLastName}`.trim();
      const message =
        asString(nextInput.domainMode) === "register"
          ? `Add a sender for this brand by buying ${domain} and creating ${fromLocalPart}@${domain} as ${senderName}.`
          : `Add a sender for this brand using ${domain}. Create ${fromLocalPart}@${domain} as ${senderName}.`;
      await handleStructuredAction({
        message,
        structuredAction: {
          toolName: "provision_mailpool_sender",
          input: nextInput,
        },
      });
      return;
    }

    if (form.formType === "provision_registrant") {
      const nextInput: Record<string, unknown> = {
        ...baseInput,
        registrant: {
          ...asRecord(baseInput.registrant),
          firstName: asString(values.firstName),
          lastName: asString(values.lastName),
          organizationName: asString(values.organizationName),
          emailAddress: asString(values.emailAddress),
          phone: asString(values.phone),
          address1: asString(values.address1),
          city: asString(values.city),
          stateProvince: asString(values.stateProvince),
          postalCode: asString(values.postalCode),
          country: asString(values.country).toUpperCase(),
        },
      };
      const fromLocalPart = asString(nextInput.fromLocalPart);
      const domain = asString(nextInput.domain);
      await handleStructuredAction({
        message: `Buy ${domain} and provision ${fromLocalPart}@${domain} for this brand using the registrant details I provided.`,
        structuredAction: {
          toolName: "provision_mailpool_sender",
          input: nextInput,
        },
      });
      return;
    }

    setError("This Brand GPT form type is not wired yet.");
  }

  async function handleConfirm(actionId: string) {
    if (!threadDetail || actionBusyId || processingRunId) return;
    setActionBusyId(actionId);
    setError("");
    try {
      await confirmOperatorActionApi(actionId);
      await refreshThread(threadDetail.thread.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to confirm Brand GPT action");
    } finally {
      setActionBusyId("");
    }
  }

  async function handleCancel(actionId: string) {
    if (!threadDetail || actionBusyId || processingRunId) return;
    setActionBusyId(actionId);
    setError("");
    try {
      await cancelOperatorActionApi(actionId);
      await refreshThread(threadDetail.thread.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to cancel Brand GPT action");
    } finally {
      setActionBusyId("");
    }
  }

  if (!open) return null;

  const isInline = variant === "inline";
  const agentBusy = sending || Boolean(processingRunId);
  const panel = (
    <aside
      className={cn(
        "relative flex h-full w-full flex-col bg-[color:var(--background)]",
        isInline
          ? "min-h-[680px] overflow-hidden rounded-[12px] border border-[color:var(--border)] shadow-[0_10px_30px_-26px_color-mix(in_oklab,var(--shadow)_82%,transparent)]"
          : "max-w-[38rem] border-l border-[color:var(--border)] shadow-[0_18px_48px_-28px_color-mix(in_oklab,var(--shadow)_88%,transparent)]",
        className
      )}
    >
      <div className="border-b border-[color:var(--border)] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-medium text-[color:var(--foreground)]">
                <Sparkles className="h-4 w-4" />
                Brand GPT
              </div>
              {activeBrandName ? (
                <div className="inline-flex h-9 items-center rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--muted-foreground)]">
                  {activeBrandName}
                </div>
              ) : null}
            </div>
            <div className="mt-3 text-sm font-medium text-[color:var(--foreground)]">{threadTitle}</div>
            <div className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
              Ask anything. If Brand GPT makes a change, it will show exactly what it did.
            </div>
          </div>
          {!isInline ? (
            <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close Brand GPT">
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <div className="mt-4 rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium text-[color:var(--muted-foreground)]">
                <ListTodo className="h-3.5 w-3.5" />
                Current task
              </div>
              <div className="mt-2 text-sm font-medium text-[color:var(--foreground)]">
                {activeRun
                  ? "Brand GPT is running"
                  : latestExecution
                    ? executionHeadline(latestExecution)
                    : "No active task"}
              </div>
              <div className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                {activeRun
                  ? "The agent run has been started and is processing the brand context, tools, and evidence."
                  : latestExecution
                  ? latestTaskSummary || "Brand GPT is tracking the latest actionable step in this thread."
                  : "Ask a question or tell Brand GPT what you want done for this brand."}
              </div>
              {latestRun ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                  {latestRun.model ? <span>{latestRun.model}</span> : null}
                  <span className="font-mono">{latestRun.id}</span>
                  {latestMessageRun?.model && latestMessageRun.model !== latestRun.model ? (
                    <span>last answer: {latestMessageRun.model}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <Badge variant={activeRun ? "accent" : latestRun ? runBadgeVariant(latestRun.status) : latestExecution ? (latestExecution.state === "completed" ? "success" : latestExecution.state === "failed" ? "danger" : latestExecution.state === "awaiting_confirmation" || latestExecution.state === "need_info" ? "accent" : "muted") : "muted"}>
              {activeRun ? "Running" : latestRun ? runStatusLabel(latestRun.status) : latestExecution ? executionStateLabel(latestExecution.state) : "Idle"}
            </Badge>
          </div>
        </div>
      </div>

      <div ref={scrollerRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {!activeBrandId ? (
          <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
            Select a brand first. Brand GPT is scoped to the active brand context.
          </div>
        ) : null}

        {loadingThread ? (
          <div className="inline-flex items-center gap-2 rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading Brand GPT thread...
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[14px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3 text-sm text-[color:var(--danger)]">
            {error}
          </div>
        ) : null}

        {activeRun ? (
          <div className="rounded-[12px] border border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] px-4 py-3 text-sm text-[color:var(--foreground)]">
            <div className="flex items-center gap-2 font-medium">
              <Loader2 className="h-4 w-4 animate-spin" />
              Brand GPT agent run in progress
            </div>
            <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
              It is using the same Operator tool loop as the autonomous runner. Results and evidence will appear in this thread.
            </div>
          </div>
        ) : null}

        {!loadingThread && activeBrandId && !visibleMessages.length ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-[color:var(--muted-foreground)]">
              <Bot className="h-3.5 w-3.5" />
              Start here
            </div>
            <div className="grid gap-2">
              {DEFAULT_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void handleSend(prompt)}
                  className="flex items-center justify-between rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3 text-left text-sm text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-hover)]"
                  disabled={agentBusy}
                >
                  <span>{prompt}</span>
                  <ChevronRight className="h-4 w-4 text-[color:var(--muted-foreground)]" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {!!visibleMessages.length ? (
          <div className="flex items-center gap-2 text-xs font-medium text-[color:var(--muted-foreground)]">
            <MessageSquareText className="h-3.5 w-3.5" />
            Conversation
          </div>
        ) : null}

        {visibleMessages.map((message) => {
          const isUser = message.role === "user" && message.kind === "message";
          const isAssistant = message.role === "assistant" && message.kind === "message";
          return (
            <div key={message.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[94%] rounded-[12px] border px-4 py-3",
                  messageCardTone(message),
                  isUser ? "max-w-[80%]" : "",
                  isAssistant ? "w-full max-w-none border-transparent bg-transparent px-0 py-0" : ""
                )}
              >
                {isAssistant ? (
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-[color:var(--muted-foreground)]">
                    <Clock3 className="h-3.5 w-3.5" />
                    Brand GPT
                  </div>
                ) : null}
                <MessageBody
                  message={message}
                  actionsById={actionsById}
                  onConfirm={(actionId) => void handleConfirm(actionId)}
                  onCancel={(actionId) => void handleCancel(actionId)}
                  onChooseReply={(message) => void handleSend(message)}
                  onSubmitForm={(form, values) => void handleSubmitForm(form, values)}
                  actionBusyId={actionBusyId}
                  sending={agentBusy}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[color:var(--border)] px-5 py-4">
        {visibleMessages.length ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {DEFAULT_PROMPTS.slice(0, 3).map((prompt) => (
              <Button
                key={prompt}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void handleSend(prompt)}
                disabled={agentBusy || !activeBrandId}
              >
                {prompt}
              </Button>
            ))}
          </div>
        ) : null}
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
                ? "Ask anything about this brand, or tell Brand GPT what to do."
                : "Select a brand to use Brand GPT."
            }
            className="min-h-[104px] rounded-[12px] bg-[color:var(--surface)]"
            disabled={agentBusy || !activeBrandId}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-[color:var(--muted-foreground)]">
              `Enter` sends. `Shift+Enter` adds a new line.
            </div>
            <Button type="submit" disabled={agentBusy || !activeBrandId || !input.trim()}>
              {agentBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              Send
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );

  if (isInline) {
    return panel;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[color:color-mix(in_oklab,var(--foreground)_18%,transparent)]/75">
      <button type="button" className="flex-1" aria-label="Close Brand GPT" onClick={() => onOpenChange(false)} />
      {panel}
    </div>
  );
}
