"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateBrandApi } from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, DomainRow } from "@/lib/factory-types";
import {
  EmptyState,
  PageIntro,
  SectionPanel,
  StatLedger,
  TableHeaderCell,
  TableShell,
} from "@/components/ui/page-layout";

const makeId = () => `domain_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

export default function NetworkClient({ brand }: { brand: BrandRecord }) {
  const [domains, setDomains] = useState<DomainRow[]>(brand.domains || []);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<DomainRow>({
    id: makeId(),
    domain: "",
    status: "active",
    warmupStage: "Day 1",
    reputation: "low",
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return domains;
    return domains.filter((item) => item.domain.toLowerCase().includes(needle));
  }, [domains, query]);

  const persist = async (next: DomainRow[]) => {
    setSaving(true);
    setError("");
    try {
      const updated = await updateBrandApi(brand.id, { domains: next });
      setDomains(updated.domains);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const riskyCount = domains.filter((item) => item.status === "risky").length;

  const roleLabel = (domain: DomainRow) => {
    if (domain.role === "brand") return "Protected brand";
    if (domain.forwardingTargetUrl) return "Sender + forwarder";
    if (domain.role === "sender") return "Sender";
    return "Manual";
  };

  useEffect(() => {
    trackEvent("ops_module_opened", { module: "network", brandId: brand.id });
  }, [brand.id]);

  return (
    <div className="space-y-8">
      <PageIntro
        eyebrow={`${brand.name} / network`}
        title="Track the sender infrastructure that outbound depends on."
        description="Domains, warmup state, forwarding, and reputation need to live in the same product as the campaigns using them."
        aside={
          <StatLedger
            items={[
              {
                label: "Domains",
                value: formatCount(domains.length),
                detail: domains.length ? "All network records attached to this brand." : "No sending domain tracked yet.",
              },
              {
                label: "Warming",
                value: formatCount(domains.filter((item) => item.status === "warming").length),
                detail: "Domains still moving into production readiness.",
              },
              {
                label: "Risky",
                value: formatCount(riskyCount),
                detail: riskyCount ? "These domains need attention before scale." : "No flagged domain at the moment.",
              },
            ]}
          />
        }
      />

      {!domains.length ? (
        <EmptyState
          title="No domains tracked yet."
          description="Add the sending domains you care about and monitor warmup, forwarding, and reputation from the same desk."
          actions={
            <>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/outreach">Outreach Settings</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/brands/${brand.id}/campaigns`}>Open Campaigns</Link>
            </Button>
            </>
          }
        />
      ) : null}

      <SectionPanel title="Add domain" description="Record a sender domain and its current health without leaving the brand.">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="md:col-span-2">
            <Label>Domain</Label>
            <Input value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })} />
          </div>
          <div>
            <Label>Status</Label>
            <Select
              value={draft.status}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  status: event.target.value as DomainRow["status"],
                })
              }
            >
              <option value="active">active</option>
              <option value="warming">warming</option>
              <option value="risky">risky</option>
            </Select>
          </div>
          <div>
            <Label>Warmup Stage</Label>
            <Input value={draft.warmupStage} onChange={(event) => setDraft({ ...draft, warmupStage: event.target.value })} />
          </div>
          <div>
            <Label>Reputation</Label>
            <Input value={draft.reputation} onChange={(event) => setDraft({ ...draft, reputation: event.target.value })} />
          </div>
          <div className="md:col-span-5 flex justify-end">
            <Button
              type="button"
              onClick={async () => {
                if (!draft.domain.trim()) return;
                const next = [{ ...draft, id: makeId(), domain: draft.domain.trim() }, ...domains];
                await persist(next);
                setDraft({ id: makeId(), domain: "", status: "active", warmupStage: "Day 1", reputation: "low" });
              }}
              disabled={saving}
            >
              Add Domain
            </Button>
          </div>
        </div>
      </SectionPanel>

      <SectionPanel
        title="Domain register"
        description="Monitor forwarding, connection state, and reputation across the sender inventory."
        actions={
          <Input
            placeholder="Filter domains"
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
                <TableHeaderCell>Domain</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Forwarding</TableHeaderCell>
                <TableHeaderCell>Customer.io</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Warmup</TableHeaderCell>
                <TableHeaderCell>Reputation</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="border-t border-[color:var(--border)] hover:bg-[color:var(--surface-muted)]">
                  <td className="py-2">{item.domain}</td>
                  <td className="py-2">{roleLabel(item)}</td>
                  <td className="py-2">{item.forwardingTargetUrl || "n/a"}</td>
                  <td className="py-2">{item.customerIoAccountName || item.fromEmail || "n/a"}</td>
                  <td className="py-2">
                    <Badge variant={item.status === "risky" ? "danger" : item.status === "active" ? "success" : "muted"}>
                      {item.status}
                    </Badge>
                  </td>
                  <td className="py-2">{item.warmupStage}</td>
                  <td className="py-2">{item.reputation}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? <div className="py-6 text-sm text-[color:var(--muted-foreground)]">No domains found.</div> : null}
        </TableShell>
      </SectionPanel>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <SectionPanel>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/brands/${brand.id}`}>Back to Brand Home</Link>
          </Button>
          <Button asChild>
            <Link href={`/brands/${brand.id}/campaigns`}>Go to Campaigns</Link>
          </Button>
        </div>
      </SectionPanel>
    </div>
  );
}
