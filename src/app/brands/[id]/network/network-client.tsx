"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateBrandApi } from "@/lib/client-api";
import {
  buildSenderRoutingSignalFromDomainRow,
  rankSenderRoutingSignals,
  scoreSenderRoutingSignal,
  type SenderRoutingSignals,
} from "@/lib/sender-routing";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, DomainRow } from "@/lib/factory-types";
import {
  PageIntro,
  SectionPanel,
  StatLedger,
  TableHeaderCell,
  TableShell,
} from "@/components/ui/page-layout";
import { ExplainableHint } from "@/components/ui/explainable-hint";

const makeId = () => `domain_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const FILTERS = ["all", "queued", "warming", "attention", "ready"] as const;

type SenderFilter = (typeof FILTERS)[number];
type HealthDimension = "domainHealth" | "emailHealth" | "ipHealth" | "messagingHealth";
type HealthSummaryDimension =
  | "domainHealthSummary"
  | "emailHealthSummary"
  | "ipHealthSummary"
  | "messagingHealthSummary";

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

function normalizeDomainInput(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function stripUrl(value?: string) {
  if (!value) return "";
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function formatTimestamp(value?: string) {
  if (!value) return "No run logged";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No run logged";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function roleLabel(domain: DomainRow) {
  if (domain.role === "brand") return "Protected destination";
  if (domain.forwardingTargetUrl) return "Sender domain + forwarding";
  if (domain.role === "sender") return "Sender domain";
  return "Manual sender";
}

function automationStatusLabel(status: NonNullable<DomainRow["automationStatus"]>) {
  if (status === "queued") return "Queued";
  if (status === "testing") return "Testing";
  if (status === "warming") return "Warming";
  if (status === "attention") return "Attention";
  return "Ready";
}

function automationBadgeVariant(status: NonNullable<DomainRow["automationStatus"]>) {
  if (status === "ready") return "success";
  if (status === "warming" || status === "testing") return "accent";
  if (status === "attention") return "danger";
  return "muted";
}

function healthLabel(value: NonNullable<DomainRow["domainHealth"]>) {
  if (value === "healthy") return "Healthy";
  if (value === "watch") return "Watch";
  if (value === "risky") return "Risky";
  if (value === "queued") return "Queued";
  return "Unknown";
}

function healthBadgeVariant(value: NonNullable<DomainRow["domainHealth"]>) {
  if (value === "healthy") return "success";
  if (value === "watch") return "accent";
  if (value === "risky") return "danger";
  return "muted";
}

function dnsBadgeVariant(status?: DomainRow["dnsStatus"]) {
  if (status === "verified" || status === "configured") return "accent";
  if (status === "error") return "danger";
  return "muted";
}

function operationalStatusBadgeVariant(status: DomainRow["status"]) {
  if (status === "active") return "success";
  if (status === "warming") return "accent";
  return "danger";
}

function derivedAutomationStatus(row: DomainRow): NonNullable<DomainRow["automationStatus"]> {
  if (row.automationStatus) return row.automationStatus;
  if (row.role === "brand") return "ready";
  if (row.status === "risky" || row.dnsStatus === "error") return "attention";
  if (row.status === "warming") {
    return row.dnsStatus === "verified" ? "warming" : "testing";
  }
  if (row.dnsStatus === "pending" || row.dnsStatus === "configured") return "testing";
  return "ready";
}

function derivedHealth(row: DomainRow, dimension: HealthDimension): NonNullable<DomainRow["domainHealth"]> {
  const explicit = row[dimension];
  if (explicit) return explicit;

  const reputation = row.reputation.toLowerCase();
  const risky =
    row.status === "risky" ||
    row.dnsStatus === "error" ||
    reputation.includes("risky") ||
    reputation.includes("poor") ||
    reputation.includes("attention");
  if (risky) return "risky";

  const watch = reputation.includes("low") || reputation.includes("building") || reputation.includes("watch");
  const healthy = reputation.includes("good") || reputation.includes("high") || reputation.includes("strong");

  if (dimension === "domainHealth") {
    if (row.role === "brand") return "healthy";
    if (healthy || row.reputation.toLowerCase() === "protected") return "healthy";
    if (watch) return "watch";
    if (row.status === "warming" || row.dnsStatus === "pending" || row.dnsStatus === "configured") return "queued";
    return "unknown";
  }

  if (row.role === "brand") return "unknown";
  if (!row.fromEmail) return "unknown";
  if (healthy && row.status === "active") return "healthy";
  if (watch) return "watch";
  if (row.status === "warming" || row.dnsStatus !== "verified") return "queued";
  return "unknown";
}

function derivedHealthSummary(row: DomainRow, dimension: HealthSummaryDimension) {
  const explicit = row[dimension];
  if (explicit) return explicit;
  if (dimension === "domainHealthSummary") {
    return row.role === "brand"
      ? "Protected destination domain."
      : "Awaiting enough control probes to isolate domain effects.";
  }
  if (dimension === "emailHealthSummary") {
    return row.fromEmail
      ? "Awaiting mailbox-specific control probes."
      : "Mailbox-specific health starts when a sender mailbox is attached.";
  }
  if (dimension === "ipHealthSummary") {
    return row.fromEmail
      ? "Awaiting route-level control probes."
      : "Transport health starts when a sender mailbox is attached.";
  }
  return row.fromEmail
    ? "Awaiting both control and live-content probes."
    : "Message health starts when a sender mailbox and a real message both exist.";
}

function automationSummary(row: DomainRow) {
  if (row.automationSummary) return row.automationSummary;
  const status = derivedAutomationStatus(row);
  if (row.role === "brand") {
    return "Protected destination only. Spam-test probes stay on the satellite sender mailboxes.";
  }
  if (status === "attention") {
    return "Checks are blocked or degraded. Fix DNS, mailbox, IP, or message issues before more volume goes out.";
  }
  if (status === "warming") {
    return "Warmup is active. Domain, mailbox, IP, and message signals are still settling.";
  }
  if (status === "testing" || status === "queued") {
    return "DNS verification is still in flight. Warmup and isolated seed checks start as each sender becomes ready.";
  }
  return "Sender is ready for production volume. Keep watching the separate health signals.";
}

function automationTimingLabel(row: DomainRow) {
  if (row.lastHealthCheckAt) return `Last check ${formatTimestamp(row.lastHealthCheckAt)}`;
  if (row.nextHealthCheckAt) return `Next check ${formatTimestamp(row.nextHealthCheckAt)}`;
  return row.role === "brand" ? "No sender checks scheduled" : "Awaiting first automated check";
}

function filterBucket(row: DomainRow): Exclude<SenderFilter, "all"> {
  const status = derivedAutomationStatus(row);
  if (status === "attention") return "attention";
  if (status === "warming") return "warming";
  if (status === "ready") return "ready";
  return "queued";
}

function filterLabel(filter: SenderFilter) {
  if (filter === "all") return "All";
  if (filter === "queued") return "Queued checks";
  if (filter === "warming") return "Warming";
  if (filter === "attention") return "Attention";
  return "Ready";
}

function seedPolicyLabel(row: DomainRow) {
  if (row.role === "brand") return "No seed probes";
  const policy = row.seedPolicy ?? (row.fromEmail ? "rotating_pool" : "fresh_pool");
  if (policy === "tainted_mailbox") return "Pair retired";
  if (policy === "rotating_pool") return "Rotating pool";
  return "Fresh pool";
}

function seedPolicyDetail(row: DomainRow) {
  if (row.role === "brand") return "Protected destination domains do not receive spam-test probes.";
  const policy = row.seedPolicy ?? (row.fromEmail ? "rotating_pool" : "fresh_pool");
  if (policy === "tainted_mailbox") {
    return "This sender mailbox has already touched a seed inbox, so future probes must use a new pair.";
  }
  if (policy === "rotating_pool") {
    return "Seed inboxes rotate by sender mailbox so repeated probes do not bias later scores.";
  }
  return "The next sender mailbox gets an untouched seed inbox before warmup and health checks begin.";
}

function routingRoleBadgeVariant(role: "primary" | "standby" | "blocked" | "pending") {
  if (role === "primary") return "success";
  if (role === "standby") return "accent";
  if (role === "blocked") return "danger";
  return "muted";
}

function routingRoleLabel(role: "primary" | "standby" | "blocked" | "pending") {
  if (role === "primary") return "Primary route";
  if (role === "standby") return "Standby";
  if (role === "blocked") return "Blocked";
  return "Pending";
}

export default function NetworkClient({ brand }: { brand: BrandRecord }) {
  const [domains, setDomains] = useState<DomainRow[]>(brand.domains || []);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SenderFilter>("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draftDomain, setDraftDomain] = useState("");
  const domainInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return domains.filter((item) => {
      if (statusFilter !== "all" && filterBucket(item) !== statusFilter) return false;
      if (!needle) return true;
      return [
        item.domain,
        item.fromEmail ?? "",
        item.replyMailboxEmail ?? "",
        item.customerIoAccountName ?? "",
        automationSummary(item),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [domains, query, statusFilter]);

  const persist = async (next: DomainRow[]) => {
    setSaving(true);
    setError("");
    try {
      const updated = await updateBrandApi(brand.id, { domains: next });
      setDomains(updated.domains || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const ledgerItems = useMemo(
    () =>
      FILTERS.map((filter) => ({
        label: filterLabel(filter),
        value: formatCount(filter === "all" ? domains.length : domains.filter((item) => filterBucket(item) === filter).length),
        active: statusFilter === filter,
        onClick: () => setStatusFilter(filter),
      })),
    [domains, statusFilter]
  );

  const rankedRoutingSignals = useMemo(
    () =>
      rankSenderRoutingSignals(
        domains
          .map((row) => buildSenderRoutingSignalFromDomainRow(row))
          .filter((row): row is SenderRoutingSignals => Boolean(row))
      ),
    [domains]
  );
  const preferredRoutingSignal = useMemo(
    () => rankedRoutingSignals.find((signal) => signal.automationStatus !== "attention") ?? null,
    [rankedRoutingSignals]
  );
  const routingRoleBySenderId = useMemo(() => {
    const next = new Map<string, "primary" | "standby" | "blocked" | "pending">();
    for (const signal of rankedRoutingSignals) {
      if (signal.automationStatus === "attention") {
        next.set(signal.senderAccountId, "blocked");
        continue;
      }
      if (preferredRoutingSignal && signal.senderAccountId === preferredRoutingSignal.senderAccountId) {
        next.set(signal.senderAccountId, "primary");
        continue;
      }
      next.set(signal.senderAccountId, "standby");
    }
    return next;
  }, [rankedRoutingSignals, preferredRoutingSignal]);
  const standbyRoutingSignals = useMemo(
    () =>
      rankedRoutingSignals.filter(
        (signal) =>
          signal.automationStatus !== "attention" &&
          (!preferredRoutingSignal || signal.senderAccountId !== preferredRoutingSignal.senderAccountId)
      ),
    [rankedRoutingSignals, preferredRoutingSignal]
  );
  const blockedRoutingSignals = useMemo(
    () => rankedRoutingSignals.filter((signal) => signal.automationStatus === "attention"),
    [rankedRoutingSignals]
  );

  useEffect(() => {
    trackEvent("ops_module_opened", { module: "senders", brandId: brand.id });
  }, [brand.id]);

  return (
    <div className="space-y-8">
      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <PageIntro
        title={
          <span className="inline-flex items-center gap-2">
            <span>Senders</span>
            <ExplainableHint
              label="Explain Senders"
              title="What happens here"
            >
              <p>
                Add a sender domain and the system handles the rest: DNS checks, warmup, control probes, live-content
                probes, routing, and automatic pauses.
              </p>
              <p>
                Health is separated into four signals so problems are easier to isolate: domain, mailbox, transport,
                and message.
              </p>
            </ExplainableHint>
          </span>
        }
        actions={
          <Button type="button" onClick={() => domainInputRef.current?.focus()}>
            Add sender domain
          </Button>
        }
        aside={
          <StatLedger items={ledgerItems} />
        }
      />

      <SectionPanel
        title={
          <span className="inline-flex items-center gap-2">
            <span>Routing priority</span>
            <ExplainableHint
              label="Explain routing priority"
              title="How sender routing works"
            >
              <p>
                The system ranks sender mailboxes by automation state, recent inbox or spam placement, and separate
                health signals for domain, email, transport, and message.
              </p>
              <p>
                The top healthy sender becomes the primary route. Healthy backups stay on standby. Blocked senders stay
                out of rotation until they recover.
              </p>
            </ExplainableHint>
          </span>
        }
        className="border-[color:var(--border-strong)]"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
          <div className="space-y-3 border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={preferredRoutingSignal ? "success" : "muted"}>
                {preferredRoutingSignal ? "Primary route" : "No active route"}
              </Badge>
              {preferredRoutingSignal ? (
                <span className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                  score {Math.round(scoreSenderRoutingSignal(preferredRoutingSignal).routingScore)}
                </span>
              ) : null}
            </div>
            <div>
              <div className="font-medium text-[color:var(--foreground)]">
                {preferredRoutingSignal?.fromEmail || "No sender mailbox is ready yet"}
              </div>
              <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                {preferredRoutingSignal
                  ? `${preferredRoutingSignal.senderAccountName} · ${preferredRoutingSignal.domain}`
                  : "Attach a verified sender mailbox and let control plus content probes settle before production routing begins."}
              </div>
            </div>
            <div className="text-sm leading-6 text-[color:var(--foreground)]">
              {preferredRoutingSignal
                ? preferredRoutingSignal.automationSummary
                : "The system will choose the healthiest sender automatically once one clears setup, warmup, and probe checks."}
            </div>
          </div>
          <div className="space-y-3">
            <div className="border border-[color:var(--border)] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Standby senders</div>
              <div className="mt-3 space-y-2">
                {standbyRoutingSignals.slice(0, 3).length ? (
                  standbyRoutingSignals.slice(0, 3).map((signal) => (
                    <div key={signal.senderAccountId} className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-[color:var(--foreground)]">{signal.fromEmail}</div>
                        <div className="text-xs leading-5 text-[color:var(--muted-foreground)]">{signal.automationSummary}</div>
                      </div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">
                        {Math.round(scoreSenderRoutingSignal(signal).routingScore)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-[color:var(--muted-foreground)]">No standby sender yet.</div>
                )}
              </div>
            </div>
            <div className="border border-[color:var(--border)] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Blocked</div>
              <div className="mt-2 text-sm text-[color:var(--foreground)]">
                {blockedRoutingSignals.length
                  ? `${blockedRoutingSignals.length} sender${blockedRoutingSignals.length === 1 ? "" : "s"} currently out of rotation.`
                  : "No sender is blocked right now."}
              </div>
            </div>
          </div>
        </div>
      </SectionPanel>

      <SectionPanel
        title={
          <span className="inline-flex items-center gap-2">
            <span>Add sender domain</span>
            <ExplainableHint
              label="Explain sender setup"
              title="What happens after you add a domain"
            >
              <p>
                The system starts DNS verification immediately, then waits for a sender mailbox before it begins warmup
                and deliverability checks.
              </p>
              <p>
                Control probes test infrastructure without campaign copy. Production probes test the exact subject and
                body that the campaign will send.
              </p>
            </ExplainableHint>
          </span>
        }
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <Label htmlFor="sender-domain-input">Domain</Label>
            <Input
              id="sender-domain-input"
              ref={domainInputRef}
              value={draftDomain}
              placeholder="mail.lastb2b.com"
              onChange={(event) => setDraftDomain(event.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={async () => {
                const domain = normalizeDomainInput(draftDomain);
                if (!domain) return;
                if (domains.some((item) => item.domain.toLowerCase() === domain)) {
                  setError("Sender domain already exists.");
                  return;
                }
                const now = new Date().toISOString();
                const next = [
                  {
                    id: makeId(),
                    domain,
                    status: "warming",
                    warmupStage: "Queued for DNS + warmup",
                    reputation: "queued",
                    automationStatus: "queued",
                    automationSummary:
                      "Domain checks queued. Mailbox, IP, and message tests start as soon as a sender mailbox is attached.",
                    domainHealth: "queued",
                    emailHealth: "unknown",
                    ipHealth: "unknown",
                    messagingHealth: "unknown",
                    seedPolicy: "fresh_pool",
                    role: "sender",
                    registrar: "manual",
                    provider: "manual",
                    dnsStatus: "pending",
                    nextHealthCheckAt: now,
                  } satisfies DomainRow,
                  ...domains,
                ];
                await persist(next);
                setDraftDomain("");
              }}
              disabled={saving}
            >
              {saving ? "Saving..." : "Add sender domain"}
            </Button>
          </div>
        </div>
      </SectionPanel>

      <SectionPanel
        title={
          <span className="inline-flex items-center gap-2">
            <span>Sender queue</span>
            <ExplainableHint
              label="Explain sender queue"
              title="How to read this table"
            >
              <p>
                Each row shows one sender domain and its mailbox. The system keeps testing, warming, and routing that
                sender without asking the operator to manage the steps manually.
              </p>
              <p>
                Use the columns to see what is healthy, what is blocked, how the sender ranks for dispatch, and whether
                its seed pool is still clean.
              </p>
            </ExplainableHint>
          </span>
        }
        className="border-[color:var(--border-strong)]"
        actions={
          <Input
            placeholder="Search senders"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-[18rem]"
          />
        }
      >
        <TableShell>
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <TableHeaderCell>Sender</TableHeaderCell>
                <TableHeaderCell>Mailbox</TableHeaderCell>
                <TableHeaderCell>
                  <span className="inline-flex items-center gap-1.5">
                    <span>Automation</span>
                    <ExplainableHint
                      label="Explain automation state"
                      title="Automation state"
                    >
                      <p>
                        This is the sender lifecycle: queued, testing, warming, ready, or attention. The system moves
                        the sender forward automatically as checks pass.
                      </p>
                      <p>
                        Attention means the sender is blocked by a domain, mailbox, transport, or message issue and
                        should stay out of rotation.
                      </p>
                    </ExplainableHint>
                  </span>
                </TableHeaderCell>
                <TableHeaderCell>
                  <span className="inline-flex items-center gap-1.5">
                    <span>Health signals</span>
                    <ExplainableHint
                      label="Explain health signals"
                      title="Why there are four health signals"
                      align="center"
                    >
                      <p>
                        Domain health asks whether the domain itself is dragging placement down. Email health isolates
                        one mailbox against sibling mailboxes on the same domain.
                      </p>
                      <p>
                        Transport health reflects the shared sending route. Message health compares neutral control copy
                        against the real campaign subject and body to isolate content risk.
                      </p>
                    </ExplainableHint>
                  </span>
                </TableHeaderCell>
                <TableHeaderCell>Warmup</TableHeaderCell>
                <TableHeaderCell>
                  <span className="inline-flex items-center gap-1.5">
                    <span>Routing</span>
                    <ExplainableHint
                      label="Explain sender routing"
                      title="Routing role"
                    >
                      <p>
                        Primary means new sends go here first. Standby means the sender is healthy enough to use, but a
                        stronger sender currently outranks it.
                      </p>
                      <p>
                        Blocked means the sender is outside rotation until its health recovers. Pending means it is not
                        ready for routing yet.
                      </p>
                    </ExplainableHint>
                  </span>
                </TableHeaderCell>
                <TableHeaderCell>
                  <span className="inline-flex items-center gap-1.5">
                    <span>Seed policy</span>
                    <ExplainableHint
                      label="Explain seed policy"
                      title="Seed inbox rules"
                      align="right"
                    >
                      <p>
                        Probe inboxes are treated as consumables. Once a sender mailbox touches a seed inbox, that pair
                        is retired so later checks stay clean.
                      </p>
                      <p>
                        Fresh pool means the next probe still has untouched capacity. Rotating pool means the system is
                        using clean alternates. Pair retired means that mailbox needs a new seed pair.
                      </p>
                    </ExplainableHint>
                  </span>
                </TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="border-t border-[color:var(--border)] hover:bg-[color:var(--surface-muted)]">
                  <td className="py-3 pr-6 align-top">
                    <div className="font-medium text-[color:var(--foreground)]">{item.domain}</div>
                    <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                      {roleLabel(item)}
                      {item.customerIoAccountName ? ` · ${item.customerIoAccountName}` : ""}
                      {item.forwardingTargetUrl ? ` · forwards to ${stripUrl(item.forwardingTargetUrl)}` : ""}
                    </div>
                  </td>
                  <td className="py-3 pr-6 align-top">
                    <div className="font-medium text-[color:var(--foreground)]">{item.fromEmail || "Mailbox pending"}</div>
                    <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                      {item.replyMailboxEmail
                        ? `Replies route to ${item.replyMailboxEmail}`
                        : "Email-level checks start as soon as the sender mailbox is attached."}
                    </div>
                  </td>
                  <td className="py-3 pr-6 align-top">
                    <Badge variant={automationBadgeVariant(derivedAutomationStatus(item))}>
                      {automationStatusLabel(derivedAutomationStatus(item))}
                    </Badge>
                    <div className="mt-2 max-w-[24rem] text-sm leading-6 text-[color:var(--foreground)]">
                      {automationSummary(item)}
                    </div>
                    <div className="mt-2 text-xs leading-5 text-[color:var(--muted-foreground)]">
                      {automationTimingLabel(item)}
                    </div>
                  </td>
                  <td className="py-3 pr-6 align-top">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(
                        [
                          ["Domain", derivedHealth(item, "domainHealth"), derivedHealthSummary(item, "domainHealthSummary")],
                          ["Email", derivedHealth(item, "emailHealth"), derivedHealthSummary(item, "emailHealthSummary")],
                          ["Transport", derivedHealth(item, "ipHealth"), derivedHealthSummary(item, "ipHealthSummary")],
                          ["Message", derivedHealth(item, "messagingHealth"), derivedHealthSummary(item, "messagingHealthSummary")],
                        ] as Array<[string, NonNullable<DomainRow["domainHealth"]>, string]>
                      ).map(([label, value, summary]) => (
                        <div key={label} className="space-y-1.5">
                          <div className="text-[11px] text-[color:var(--muted-foreground)]">{label}</div>
                          <Badge variant={healthBadgeVariant(value)}>{healthLabel(value)}</Badge>
                          <div className="max-w-[13rem] text-[11px] leading-5 text-[color:var(--muted-foreground)]">
                            {summary}
                          </div>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 pr-6 align-top">
                    <div className="font-medium text-[color:var(--foreground)]">{item.warmupStage || "Not started"}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant={dnsBadgeVariant(item.dnsStatus)}>
                        {item.dnsStatus ? `DNS ${item.dnsStatus}` : "DNS pending"}
                      </Badge>
                      <Badge variant={operationalStatusBadgeVariant(item.status)}>
                        {item.status === "active" ? "Sending" : item.status === "warming" ? "Warming" : "At risk"}
                      </Badge>
                    </div>
                  </td>
                  <td className="py-3 pr-6 align-top">
                    <Badge
                      variant={routingRoleBadgeVariant(
                        item.customerIoAccountId
                          ? routingRoleBySenderId.get(item.customerIoAccountId) ?? "pending"
                          : item.role === "brand"
                            ? "pending"
                            : derivedAutomationStatus(item) === "attention"
                              ? "blocked"
                              : "pending"
                      )}
                    >
                      {routingRoleLabel(
                        item.customerIoAccountId
                          ? routingRoleBySenderId.get(item.customerIoAccountId) ?? "pending"
                          : item.role === "brand"
                            ? "pending"
                            : derivedAutomationStatus(item) === "attention"
                              ? "blocked"
                              : "pending"
                      )}
                    </Badge>
                    <div className="mt-2 max-w-[15rem] text-xs leading-5 text-[color:var(--muted-foreground)]">
                      {item.customerIoAccountId && routingRoleBySenderId.get(item.customerIoAccountId) === "primary"
                        ? "System routes new sends here first while the current health profile holds."
                        : item.customerIoAccountId && routingRoleBySenderId.get(item.customerIoAccountId) === "standby"
                          ? "Healthy enough to send, but currently held behind a stronger sender."
                          : derivedAutomationStatus(item) === "attention"
                            ? automationSummary(item)
                            : "Mailbox is not in routing yet."}
                    </div>
                  </td>
                  <td className="py-3 align-top">
                    <div className="font-medium text-[color:var(--foreground)]">{seedPolicyLabel(item)}</div>
                    <div className="mt-1 max-w-[16rem] text-xs leading-5 text-[color:var(--muted-foreground)]">
                      {seedPolicyDetail(item)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? (
            <div className="py-6 text-sm text-[color:var(--muted-foreground)]">
              {domains.length
                ? "No sender domains match the current filter."
                : "No sender domains yet. Add one to queue DNS verification, warmup, and seed checks."}
            </div>
          ) : null}
        </TableShell>
      </SectionPanel>
    </div>
  );
}
