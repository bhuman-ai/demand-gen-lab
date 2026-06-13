"use client";

import { Send, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  PageIntro,
  SectionPanel,
  StatLedger,
  TableHeaderCell,
  TableShell,
} from "@/components/ui/page-layout";
import {
  createManualBatchApi,
  fetchManualBatchConsole,
  type ManualBatchConsoleState,
} from "@/lib/client-api";
import type { BrandRecord } from "@/lib/factory-types";

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function batchStatusVariant(status: string) {
  if (status === "monitoring" || status === "completed") return "success" as const;
  if (status === "failed" || status === "preflight_failed" || status === "paused") return "danger" as const;
  if (status === "sending" || status === "scheduled" || status === "queued") return "accent" as const;
  return "muted" as const;
}

const sampleContacts = "email,name,company,title\nalex@example.com,Alex Morgan,Example,Founder";

function pickSenderAccountId(state: ManualBatchConsoleState, preferredSenderAccountId: string) {
  const preferred = preferredSenderAccountId
    ? state.senders.find((sender) => sender.accountId === preferredSenderAccountId && sender.ready)
    : null;
  return preferred?.accountId || state.senders.find((sender) => sender.ready)?.accountId || state.senders[0]?.accountId || "";
}

export default function SendClient({
  brand,
  preferredSenderAccountId = "",
}: {
  brand: BrandRecord;
  preferredSenderAccountId?: string;
}) {
  const [state, setState] = useState<ManualBatchConsoleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [senderAccountId, setSenderAccountId] = useState("");
  const [batchName, setBatchName] = useState("");
  const [contactsText, setContactsText] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [chunkSize, setChunkSize] = useState("100");
  const [rejected, setRejected] = useState<Array<{ rowNumber: number; email: string; reason: string }>>([]);

  const refresh = async () => {
    const next = await fetchManualBatchConsole(brand.id);
    setState(next);
    setSenderAccountId((current) => current || pickSenderAccountId(next, preferredSenderAccountId));
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void fetchManualBatchConsole(brand.id)
      .then((next) => {
        if (!mounted) return;
        setState(next);
        setSenderAccountId(pickSenderAccountId(next, preferredSenderAccountId));
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load send console");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [brand.id, preferredSenderAccountId]);

  const selectedSender = useMemo(
    () => state?.senders.find((sender) => sender.accountId === senderAccountId) ?? null,
    [senderAccountId, state]
  );
  const latest = state?.batches[0] ?? null;
  const totals = useMemo(() => {
    const batches = state?.batches ?? [];
    return batches.reduce(
      (acc, batch) => {
        acc.sent += batch.counts.sent;
        acc.replies += batch.counts.replies;
        acc.scheduled += batch.counts.scheduled;
        acc.failed += batch.counts.failed + batch.counts.canceled + batch.counts.bounced;
        return acc;
      },
      { sent: 0, replies: 0, scheduled: 0, failed: 0 }
    );
  }, [state]);

  const submit = async () => {
    setSubmitting(true);
    setError("");
    setNotice("");
    setRejected([]);
    try {
      const result = await createManualBatchApi(brand.id, {
        senderAccountId,
        batchName,
        contactsText,
        subject,
        body,
        chunkSize: Number(chunkSize) || undefined,
      });
      setRejected(result.rejected);
      setNotice(`Queued ${result.messages.length} messages for Customer.io dispatch.`);
      setBatchName("");
      setContactsText("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch batch");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-7">
      <PageIntro
        title="Send Mail"
        description="Customer.io batch sending for operator-supplied contacts."
        actions={
          <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
        aside={
          <StatLedger
            items={[
              { label: "Queued", value: formatCount(totals.scheduled), detail: "Waiting for manual batch dispatch." },
              { label: "Sent", value: formatCount(totals.sent), detail: latest ? `Latest ${formatDateTime(latest.run.createdAt)}` : "-" },
              { label: "Replies", value: formatCount(totals.replies), detail: latest?.latestReplyAt ? formatDateTime(latest.latestReplyAt) : "No linked replies yet." },
              { label: "Failed", value: formatCount(totals.failed), detail: "Canceled, bounced, or provider failed." },
            ]}
          />
        }
      />

      {!state?.outboundSendingEnabled ? (
        <div className="rounded-[10px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3 text-sm text-[color:var(--danger)]">
          OUTBOUND_SENDING_ENABLED is off. Batches will not launch until it is enabled.
        </div>
      ) : null}

      <SectionPanel title="New batch" description="Paste contacts, choose a Customer.io sender, and queue dispatch.">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Sender</Label>
                <Select value={senderAccountId} onChange={(event) => setSenderAccountId(event.target.value)}>
                  {(state?.senders ?? []).map((sender) => (
                    <option key={sender.accountId} value={sender.accountId}>
                      {sender.fromEmail || sender.name} {sender.ready ? "" : "(not ready)"}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Batch name</Label>
                <Input value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="June operator list" />
              </div>
            </div>
            <div>
              <Label>Contacts</Label>
              <Textarea
                value={contactsText}
                onChange={(event) => setContactsText(event.target.value)}
                placeholder={sampleContacts}
                className="min-h-[180px] font-mono text-xs"
              />
            </div>
            <div>
              <Label>Subject</Label>
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Quick question for {{company}}" />
            </div>
            <div>
              <Label>Body</Label>
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} className="min-h-[180px]" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="w-40">
                <Label>Chunk size</Label>
                <Input value={chunkSize} onChange={(event) => setChunkSize(event.target.value)} inputMode="numeric" />
              </div>
              <Button
                type="button"
                onClick={() => void submit()}
                disabled={submitting || !state?.outboundSendingEnabled || !selectedSender?.ready}
                className="min-w-[9rem]"
              >
                <Send className="h-4 w-4" />
                {submitting ? "Queueing..." : "Send batch"}
              </Button>
            </div>
          </div>

          <div className="space-y-3 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
            <div className="text-sm font-medium text-[color:var(--foreground)]">Sender status</div>
            {selectedSender ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[color:var(--muted-foreground)]">From</span>
                  <span className="truncate text-right">{selectedSender.fromEmail || "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[color:var(--muted-foreground)]">Reply-To</span>
                  <span className="truncate text-right">{selectedSender.replyToEmail || "-"}</span>
                </div>
                <Badge variant={selectedSender.ready ? "success" : "danger"}>
                  {selectedSender.ready ? "Ready" : "Blocked"}
                </Badge>
                {!selectedSender.ready ? (
                  <div className="text-xs leading-5 text-[color:var(--danger)]">{selectedSender.reason}</div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-[color:var(--muted-foreground)]">No Customer.io sender found.</div>
            )}
            {notice ? <div className="text-sm text-[color:var(--success)]">{notice}</div> : null}
            {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
            {rejected.length ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-[color:var(--muted-foreground)]">
                  Rejected rows: {rejected.length}
                </summary>
                <div className="mt-2 max-h-44 space-y-1 overflow-auto text-xs text-[color:var(--muted-foreground)]">
                  {rejected.slice(0, 30).map((row) => (
                    <div key={`${row.rowNumber}-${row.email}`}>
                      Row {row.rowNumber}: {row.email || "-"} ({row.reason})
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      </SectionPanel>

      <SectionPanel title="Recent batches">
        {state?.batches.length ? (
          <TableShell>
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <TableHeaderCell>Batch</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Sender</TableHeaderCell>
                  <TableHeaderCell align="right">Sent</TableHeaderCell>
                  <TableHeaderCell align="right">Queued</TableHeaderCell>
                  <TableHeaderCell align="right">Replies</TableHeaderCell>
                  <TableHeaderCell>Updated</TableHeaderCell>
                </tr>
              </thead>
              <tbody>
                {state.batches.map((batch) => (
                  <tr key={batch.run.id} className="border-t border-[color:var(--border)] hover:bg-[color:var(--surface-muted)]">
                    <td className="max-w-[18rem] py-2 pr-4">
                      <div className="truncate font-medium">{batch.campaign?.name || batch.run.id}</div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">{batch.counts.leads} contacts</div>
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={batchStatusVariant(batch.run.status)}>{batch.run.status}</Badge>
                    </td>
                    <td className="max-w-[14rem] truncate py-2 pr-4">{batch.sender.fromEmail || batch.sender.name || "-"}</td>
                    <td className="py-2 pr-4 text-right">{batch.counts.sent}</td>
                    <td className="py-2 pr-4 text-right">{batch.counts.scheduled}</td>
                    <td className="py-2 pr-4 text-right">{batch.counts.replies}</td>
                    <td className="py-2 text-[color:var(--muted-foreground)]">{formatDateTime(batch.run.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        ) : (
          <EmptyState title="No batches yet." description="The first sent batch will appear here with sent, failed, and reply counts." />
        )}
      </SectionPanel>
    </div>
  );
}
