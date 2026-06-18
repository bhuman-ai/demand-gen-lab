"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateBrandApi } from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, LeadRow } from "@/lib/factory-types";
import type { AudienceContact } from "@/lib/audience-data";
import {
  EmptyState,
  PageIntro,
  SectionPanel,
  StatLedger,
  TableHeaderCell,
  TableShell,
} from "@/components/ui/page-layout";

const makeId = () => `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

function manualContact(lead: LeadRow): AudienceContact {
  return {
    id: `manual:${lead.id}`,
    name: lead.name,
    email: "",
    title: "",
    company: "",
    domain: lead.channel,
    sources: ["manual"],
    status:
      lead.status === "qualified"
        ? "qualified"
        : lead.status === "closed"
          ? "closed"
          : lead.status === "contacted"
            ? "contacted"
            : "new",
    lastTouch: lead.lastTouch,
    firstSeenAt: lead.lastTouch,
    attempts: lead.status === "contacted" ? 1 : 0,
    sentCount: lead.status === "contacted" ? 1 : 0,
    scheduledCount: 0,
    failedCount: 0,
    replyCount: 0,
    lastSubject: "",
    replyIntent: "",
    replySentiment: "",
  };
}

function statusVariant(status: AudienceContact["status"]): "accent" | "success" | "muted" | "danger" {
  if (status === "qualified" || status === "replied") return "success";
  if (status === "closed" || status === "suppressed" || status === "unsubscribed") return "muted";
  if (status === "failed" || status === "bounced") return "danger";
  return "accent";
}

function sourceLabel(contact: AudienceContact) {
  return contact.sources
    .map((source) => (source === "manual" ? "Manual" : source === "reply" ? "Reply" : "Outbound"))
    .join(", ");
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export default function LeadsClient({
  brand,
  outreachContacts,
  generatedAt,
}: {
  brand: BrandRecord;
  outreachContacts: AudienceContact[];
  generatedAt: string;
}) {
  const [manualLeads, setManualLeads] = useState<LeadRow[]>(brand.leads || []);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<LeadRow>({
    id: makeId(),
    name: "",
    channel: "LinkedIn",
    status: "new",
    lastTouch: "",
  });

  const contacts = useMemo(() => {
    const manualIds = new Set((brand.leads || []).map((lead) => `manual:${lead.id}`));
    return [...manualLeads.map(manualContact), ...outreachContacts.filter((contact) => !manualIds.has(contact.id))];
  }, [brand.leads, manualLeads, outreachContacts]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((item) =>
      [item.name, item.email, item.title, item.company, item.domain, item.status, item.lastSubject, sourceLabel(item)]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [contacts, query]);

  const persist = async (next: LeadRow[]) => {
    setSaving(true);
    setError("");
    try {
      const updated = await updateBrandApi(brand.id, { leads: next });
      setManualLeads(updated.leads);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const contactedOrQueued = contacts.filter((contact) => contact.sentCount || contact.scheduledCount || contact.status === "contacted").length;
  const replyCount = contacts.filter((contact) => contact.replyCount > 0 || contact.status === "replied").length;
  const openCount = contacts.filter((contact) => !["closed", "suppressed", "unsubscribed"].includes(contact.status)).length;

  useEffect(() => {
    trackEvent("ops_module_opened", { module: "leads", brandId: brand.id });
  }, [brand.id]);

  return (
    <div className="space-y-8">
      <PageIntro
        title="Audience"
        aside={
          <StatLedger
            items={[
              {
                label: "Total people",
                value: formatCount(contacts.length),
                detail: contacts.length ? "Everyone known from manual, outbound, and reply history." : "No audience recorded yet.",
              },
              {
                label: "Queued or sent",
                value: formatCount(contactedOrQueued),
                detail: contactedOrQueued ? "People with scheduled or sent outreach." : "No outbound touch recorded.",
              },
              {
                label: "Replies",
                value: formatCount(replyCount),
                detail: replyCount ? "People with reply threads." : "No replies recorded.",
              },
              {
                label: "Open",
                value: formatCount(openCount),
                detail: "People still in motion.",
              },
            ]}
          />
        }
      />

      {!contacts.length ? (
        <EmptyState
          title="No audience yet."
          description="This page fills from manual people, outbound run leads, scheduled and sent emails, and reply threads."
          actions={
            <>
            <Button asChild size="sm" variant="outline">
              <Link href={`/brands/${brand.id}/campaigns`}>Open Outbound</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/outreach">Open Settings</Link>
            </Button>
            </>
          }
        />
      ) : null}

      <SectionPanel
        title="Audience register"
        description="Every known person from manual entry, outbound sourcing, scheduled sends, sent mail, and replies."
        actions={<Input placeholder="Filter audience" value={query} onChange={(event) => setQuery(event.target.value)} className="w-[18rem]" />}
      >
        <TableShell className="max-h-[68vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <TableHeaderCell className="sticky top-0 bg-[color:var(--surface)] pt-1">Name</TableHeaderCell>
                <TableHeaderCell className="sticky top-0 bg-[color:var(--surface)] pt-1">Company</TableHeaderCell>
                <TableHeaderCell className="sticky top-0 bg-[color:var(--surface)] pt-1">Email</TableHeaderCell>
                <TableHeaderCell className="sticky top-0 bg-[color:var(--surface)] pt-1">Source</TableHeaderCell>
                <TableHeaderCell className="sticky top-0 bg-[color:var(--surface)] pt-1">Status</TableHeaderCell>
                <TableHeaderCell align="right" className="sticky top-0 w-32 bg-[color:var(--surface)] pt-1">Last touch</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => (
                <tr key={contact.id} className="border-t border-[color:var(--border)] hover:bg-[color:var(--surface-muted)]">
                  <td className="py-2 pr-4">
                    <div className="font-medium text-[color:var(--foreground)]">{contact.name}</div>
                    {contact.title ? <div className="text-xs text-[color:var(--muted-foreground)]">{contact.title}</div> : null}
                  </td>
                  <td className="py-2 pr-4">
                    <div>{contact.company || "-"}</div>
                    {contact.domain ? <div className="text-xs text-[color:var(--muted-foreground)]">{contact.domain}</div> : null}
                  </td>
                  <td className="py-2 pr-4">{contact.email || "-"}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{sourceLabel(contact)}</td>
                  <td className="py-2">
                    <Badge variant={statusVariant(contact.status)}>{contact.status}</Badge>
                    {contact.attempts + contact.replyCount > 0 ? (
                      <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                        {contact.attempts + contact.replyCount} touch{contact.attempts + contact.replyCount === 1 ? "" : "es"}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">{formatDate(contact.lastTouch)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? <div className="py-6 text-sm text-[color:var(--muted-foreground)]">No audience contacts found.</div> : null}
        </TableShell>
      </SectionPanel>

      <SectionPanel title="Add lead" description="Record a manual person if the agent has not found them yet.">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="md:col-span-2">
            <Label>Name</Label>
            <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </div>
          <div>
            <Label>Channel</Label>
            <Input value={draft.channel} onChange={(event) => setDraft({ ...draft, channel: event.target.value })} />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as LeadRow["status"] })}>
              <option value="new">new</option>
              <option value="contacted">contacted</option>
              <option value="qualified">qualified</option>
              <option value="closed">closed</option>
            </Select>
          </div>
          <div>
            <Label>Last Touch</Label>
            <Input value={draft.lastTouch} onChange={(event) => setDraft({ ...draft, lastTouch: event.target.value })} />
          </div>
          <div className="md:col-span-5 flex justify-end">
            <Button
              type="button"
              onClick={async () => {
                if (!draft.name.trim()) return;
                const next = [{ ...draft, id: makeId(), name: draft.name.trim() }, ...manualLeads];
                await persist(next);
                setDraft({ id: makeId(), name: "", channel: "LinkedIn", status: "new", lastTouch: "" });
              }}
              disabled={saving}
            >
              Add person
            </Button>
          </div>
        </div>
      </SectionPanel>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <SectionPanel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[color:var(--muted-foreground)]">Updated {formatDate(generatedAt)}</div>
          <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/brands/${brand.id}`}>Back to Brand GPT</Link>
          </Button>
          <Button asChild>
            <Link href={`/brands/${brand.id}/campaigns`}>Go to Outbound</Link>
          </Button>
          </div>
        </div>
      </SectionPanel>
    </div>
  );
}
