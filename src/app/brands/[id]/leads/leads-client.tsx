"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateBrandApi } from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, LeadRow } from "@/lib/factory-types";

const makeId = () => `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export default function LeadsClient({ brand }: { brand: BrandRecord }) {
  const [leads, setLeads] = useState<LeadRow[]>(brand.leads || []);
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return leads;
    return leads.filter((item) => [item.name, item.channel, item.status].join(" ").toLowerCase().includes(needle));
  }, [leads, query]);

  const persist = async (next: LeadRow[]) => {
    setSaving(true);
    setError("");
    try {
      const updated = await updateBrandApi(brand.id, { leads: next });
      setLeads(updated.leads);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const qualified = leads.filter((lead) => lead.status === "qualified").length;

  useEffect(() => {
    trackEvent("ops_module_opened", { module: "leads", brandId: brand.id });
  }, [brand.id]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Leads</CardTitle>
          <CardDescription>Pipeline view for {brand.name}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Total Leads</div>
            <div className="text-lg font-semibold">{leads.length}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Qualified</div>
            <div className="text-lg font-semibold">{qualified}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Open</div>
            <div className="text-lg font-semibold">{leads.filter((lead) => lead.status !== "closed").length}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Add Lead</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
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
                const next = [{ ...draft, id: makeId(), name: draft.name.trim() }, ...leads];
                await persist(next);
                setDraft({ id: makeId(), name: "", channel: "LinkedIn", status: "new", lastTouch: "" });
              }}
              disabled={saving}
            >
              Add Lead
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Lead Table</CardTitle>
          <Input placeholder="Filter leads" value={query} onChange={(event) => setQuery(event.target.value)} className="max-w-xs" />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
                <th className="pb-2">Name</th>
                <th className="pb-2">Channel</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Last Touch</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr key={lead.id} className="border-t border-[color:var(--border)]">
                  <td className="py-2">{lead.name}</td>
                  <td className="py-2">{lead.channel}</td>
                  <td className="py-2">
                    <Badge
                      variant={lead.status === "qualified" ? "success" : lead.status === "closed" ? "muted" : "accent"}
                    >
                      {lead.status}
                    </Badge>
                  </td>
                  <td className="py-2">{lead.lastTouch || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? <div className="py-6 text-sm text-[color:var(--muted-foreground)]">No leads found.</div> : null}
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Button asChild variant="outline">
            <Link href={`/brands/${brand.id}`}>Back to Brand Home</Link>
          </Button>
          <Button asChild>
            <Link href={`/brands/${brand.id}/campaigns`}>Go to Campaigns</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
