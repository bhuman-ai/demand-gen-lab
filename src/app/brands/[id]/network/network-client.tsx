"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateBrandApi } from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, DomainRow } from "@/lib/factory-types";

const makeId = () => `domain_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

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

  useEffect(() => {
    trackEvent("ops_module_opened", { module: "network", brandId: brand.id });
  }, [brand.id]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Network</CardTitle>
          <CardDescription>Domains and reputation controls for {brand.name}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Domains</div>
            <div className="text-lg font-semibold">{domains.length}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Warming</div>
            <div className="text-lg font-semibold">{domains.filter((item) => item.status === "warming").length}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Risky</div>
            <div className="text-lg font-semibold">{riskyCount}</div>
          </div>
        </CardContent>
      </Card>

      {!domains.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start Here</CardTitle>
            <CardDescription>
              Add the sending domains you care about and track warmup and reputation.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/outreach">Outreach Settings</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/brands/${brand.id}/campaigns`}>Go to Campaigns</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Domain</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Domain Table</CardTitle>
          <Input
            placeholder="Filter domains"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
                <th className="pb-2">Domain</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Warmup</th>
                <th className="pb-2">Reputation</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="border-t border-[color:var(--border)]">
                  <td className="py-2">{item.domain}</td>
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
