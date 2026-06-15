"use client";

import { RefreshCw, Send } from "lucide-react";
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
  createOutboxBatchApi,
  fetchOutboxConsole,
  type OutboxConsoleState,
} from "@/lib/client-api";
import type { BrandRecord } from "@/lib/factory-types";

const sampleFinderTargets = "name,company,domain,title,linkedin\nAlex Morgan,Example Co,example.com,Founder,";
const sampleContacts = "email,name,company,title\nalex@example.com,Alex Morgan,Example Co,Founder";
const sampleProspectQuery = "Heads of marketing at B2B SaaS companies hiring SDRs, 11-200 employees, United States";

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
  if (status === "failed" || status === "preflight_failed" || status === "canceled") return "danger" as const;
  if (status === "paused" || status === "scheduled" || status === "queued") return "accent" as const;
  return "muted" as const;
}

function policyVariant(state: string) {
  if (state === "healthy") return "success" as const;
  if (state === "paused") return "danger" as const;
  if (state === "constrained") return "accent" as const;
  return "muted" as const;
}

function pickSenderAccountId(state: OutboxConsoleState, preferredSenderAccountId: string) {
  const preferred = preferredSenderAccountId
    ? state.senders.find((sender) => sender.accountId === preferredSenderAccountId && sender.ready)
    : null;
  return preferred?.accountId || state.senders.find((sender) => sender.ready)?.accountId || state.senders[0]?.accountId || "";
}

function formatLaunchNotice(result: Awaited<ReturnType<typeof createOutboxBatchApi>>) {
  const sourcingPrefix = result.prospectSourcing ? `Sourced ${result.prospectSourcing.sourced} prospects. ` : "";
  const finderPrefix = result.finder ? `Found ${result.finder.found} with Airscale. ` : "";
  if (result.counts.sent > 0) {
    return `${sourcingPrefix}${finderPrefix}Sent ${result.counts.sent} now. Held ${result.counts.held}. Failed ${result.counts.failed}.`;
  }
  if (result.counts.held > 0) {
    return `${sourcingPrefix}${finderPrefix}Created ${result.counts.created} messages, all held by sender policy.`;
  }
  return `${sourcingPrefix}${finderPrefix}Created ${result.counts.created} messages. Failed ${result.counts.failed}.`;
}

function optionalNumericInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function OutboxClient({
  brand,
  preferredSenderAccountId = "",
}: {
  brand: BrandRecord;
  preferredSenderAccountId?: string;
}) {
  const [state, setState] = useState<OutboxConsoleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [senderAccountId, setSenderAccountId] = useState("");
  const [batchName, setBatchName] = useState("");
  const [sourceMode, setSourceMode] = useState<"auto" | "airscale" | "contacts">("auto");
  const [prospectQuery, setProspectQuery] = useState("");
  const [maxProspects, setMaxProspects] = useState("50");
  const [finderText, setFinderText] = useState("");
  const [contactsText, setContactsText] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [requestedSendNow, setRequestedSendNow] = useState("25");
  const [rejected, setRejected] = useState<Array<{ rowNumber: number; email: string; reason: string }>>([]);

  const refresh = async (nextSenderAccountId = senderAccountId) => {
    const next = await fetchOutboxConsole(brand.id, { senderAccountId: nextSenderAccountId });
    setState(next);
    setSenderAccountId((current) => current || pickSenderAccountId(next, preferredSenderAccountId));
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void fetchOutboxConsole(brand.id, { senderAccountId: preferredSenderAccountId })
      .then((next) => {
        if (!mounted) return;
        setState(next);
        const picked = pickSenderAccountId(next, preferredSenderAccountId);
        setSenderAccountId(picked);
        if (next.selectedPolicy?.availableNow) {
          setRequestedSendNow(String(Math.min(25, next.selectedPolicy.availableNow)));
        }
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load outbox");
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
  const policy = state?.selectedPolicy ?? null;
  const latest = state?.batches[0] ?? null;
  const totals = useMemo(() => {
    const batches = state?.batches ?? [];
    return batches.reduce(
      (acc, batch) => {
        acc.sent += batch.counts.sent;
        acc.held += batch.counts.scheduled;
        acc.replies += batch.counts.replies;
        acc.failed += batch.counts.failed + batch.counts.canceled + batch.counts.bounced;
        return acc;
      },
      { sent: 0, held: 0, replies: 0, failed: 0 }
    );
  }, [state]);

  const selectSender = (accountId: string) => {
    setSenderAccountId(accountId);
    setError("");
    void refresh(accountId);
  };

  const submit = async () => {
    setSubmitting(true);
    setError("");
    setNotice("");
    setRejected([]);
    try {
      const result = await createOutboxBatchApi(brand.id, {
        senderAccountId,
        batchName,
        sourceMode,
        contactsText: sourceMode === "contacts" ? contactsText : "",
        finderText: sourceMode === "airscale" ? finderText : "",
        prospectQuery: sourceMode === "auto" ? prospectQuery : "",
        prospectOffer: body || subject,
        maxProspects: sourceMode === "auto" ? optionalNumericInput(maxProspects) : undefined,
        subject,
        body,
        requestedSendNow: optionalNumericInput(requestedSendNow),
      });
      setRejected(result.rejected);
      setNotice(formatLaunchNotice(result));
      setBatchName("");
      setFinderText("");
      setContactsText("");
      await refresh(senderAccountId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch outbox batch");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-7">
      <PageIntro
        title="Outbox"
        description="Automatic prospect sourcing, Airscale email finding, policy-capped Customer.io sending, and a visible sent, held, failed, and reply ledger."
        actions={
          <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
        aside={
          <StatLedger
            items={[
              { label: "Sent", value: formatCount(totals.sent), detail: latest ? `Latest ${formatDateTime(latest.run.createdAt)}` : "-" },
              { label: "Held", value: formatCount(totals.held), detail: "Waiting for sender policy." },
              { label: "Replies", value: formatCount(totals.replies), detail: latest?.latestReplyAt ? formatDateTime(latest.latestReplyAt) : "No linked replies yet." },
              { label: "Failed", value: formatCount(totals.failed), detail: "Provider failed, bounced, or canceled." },
            ]}
          />
        }
      />

      <SectionPanel title="Sender policy">
        <div className="grid gap-px overflow-hidden rounded-[10px] border border-[color:var(--border)] bg-[color:var(--border)] md:grid-cols-5">
          {[
            ["State", policy?.senderState ?? "-"],
            ["Cap today", policy ? String(policy.dailyCap) : "-"],
            ["Sent today", policy ? String(policy.sentToday) : "-"],
            ["Can send now", policy ? String(policy.availableNow) : "-"],
            ["7d failures", policy ? String(policy.failedOrBouncedLast7d) : "-"],
          ].map(([label, value]) => (
            <div key={label} className="min-h-[64px] bg-[color:var(--surface)] px-4 py-3">
              <div className="text-xs text-[color:var(--muted-foreground)]">{label}</div>
              <div className="mt-1 text-lg font-semibold text-[color:var(--foreground)]">{value}</div>
            </div>
          ))}
        </div>
        {policy ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={policyVariant(policy.senderState)}>{policy.senderState}</Badge>
            {policy.reasons.length ? (
              <span className="text-[color:var(--muted-foreground)]">{policy.reasons.join(", ")}</span>
            ) : (
              <span className="text-[color:var(--muted-foreground)]">No policy blockers.</span>
            )}
          </div>
        ) : null}
      </SectionPanel>

      <SectionPanel title="New batch" description="Find prospects, resolve emails, and send only what policy allows now.">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label>Sender</Label>
                <Select value={senderAccountId} onChange={(event) => selectSender(event.target.value)}>
                  {(state?.senders ?? []).map((sender) => (
                    <option key={sender.accountId} value={sender.accountId}>
                      {sender.fromEmail || sender.name} {sender.ready ? "" : "(not ready)"}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Batch name</Label>
                <Input value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="June list" />
              </div>
              <div>
                <Label>Request now</Label>
                <Input value={requestedSendNow} onChange={(event) => setRequestedSendNow(event.target.value)} inputMode="numeric" />
              </div>
            </div>
            <div className="max-w-xs">
              <Label>Source</Label>
              <Select
                value={sourceMode}
                onChange={(event) => {
                  const value = event.target.value;
                  setSourceMode(value === "contacts" ? "contacts" : value === "airscale" ? "airscale" : "auto");
                  setError("");
                  setNotice("");
                  setRejected([]);
                }}
              >
                <option value="auto">Find prospects</option>
                <option value="airscale">Find emails for people</option>
                <option value="contacts">Paste emails</option>
              </Select>
            </div>
            {sourceMode === "auto" ? (
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(8rem,10rem)]">
                <div>
                  <Label>Target prospects</Label>
                  <Textarea
                    value={prospectQuery}
                    onChange={(event) => setProspectQuery(event.target.value)}
                    placeholder={sampleProspectQuery}
                    className="min-h-[120px]"
                  />
                </div>
                <div>
                  <Label>Find</Label>
                  <Input value={maxProspects} onChange={(event) => setMaxProspects(event.target.value)} inputMode="numeric" />
                </div>
              </div>
            ) : null}
            {sourceMode === "auto" ? null : (
              <div>
                <Label>{sourceMode === "airscale" ? "People to find" : "Contacts"}</Label>
                <Textarea
                  value={sourceMode === "airscale" ? finderText : contactsText}
                  onChange={(event) =>
                    sourceMode === "airscale" ? setFinderText(event.target.value) : setContactsText(event.target.value)
                  }
                  placeholder={sourceMode === "airscale" ? sampleFinderTargets : sampleContacts}
                  className="min-h-[180px] font-mono text-xs"
                />
              </div>
            )}
            <div>
              <Label>Subject</Label>
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Quick question for {{company}}" />
            </div>
            <div>
              <Label>Body</Label>
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} className="min-h-[180px]" />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => void submit()}
                disabled={submitting || !selectedSender?.ready || !policy || policy.senderState === "paused"}
                className="min-w-[9rem]"
              >
                <Send className="h-4 w-4" />
                {submitting
                  ? "Sending..."
                  : sourceMode === "auto"
                    ? "Find prospects + send"
                    : sourceMode === "airscale"
                      ? "Find emails + send"
                      : "Send allowed"}
              </Button>
            </div>
          </div>

          <div className="space-y-3 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
            <div className="text-sm font-medium text-[color:var(--foreground)]">Sender</div>
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
                  <TableHeaderCell align="right">Held</TableHeaderCell>
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
          <EmptyState title="No outbox batches yet." description="The first policy-capped send will appear here." />
        )}
      </SectionPanel>
    </div>
  );
}
