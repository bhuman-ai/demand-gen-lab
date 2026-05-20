"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageIntro, SectionPanel } from "@/components/ui/page-layout";
import {
  createMissionApi,
  fetchBrand,
  fetchMissions,
} from "@/lib/client-api";
import type { BrandRecord } from "@/lib/factory-types";
import type { Mission } from "@/lib/mission-types";

function statusLabel(status: Mission["status"]) {
  return status.replaceAll("_", " ");
}

export default function MissionsClient({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [targetCustomerText, setTargetCustomerText] = useState("");
  const [loading, setLoading] = useState(true);
  const [going, setGoing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    void Promise.all([fetchBrand(brandId), fetchMissions(brandId)])
      .then(([brandRow, missionRows]) => {
        if (!mounted) return;
        setBrand(brandRow);
        setMissions(missionRows);
        setWebsiteUrl(brandRow.website || "");
        setTargetCustomerText((brandRow.idealCustomerProfiles ?? []).join("\n"));
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load missions");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [brandId]);

  const latestMission = missions[0] ?? null;

  return (
    <div className="space-y-7">
      <PageIntro
        title="Start AI campaign"
        description="Paste the site, describe the customers, and LastB2B starts the safe first batch."
      />

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading...</div> : null}

      <SectionPanel
        title="Campaign goal"
        description="The AI handles targeting, tests, inbox warmup, and deliverability checks."
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="websiteUrl">Website</Label>
            <Input
              id="websiteUrl"
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="targetCustomers">Target customers</Label>
            <Textarea
              id="targetCustomers"
              value={targetCustomerText}
              onChange={(event) => setTargetCustomerText(event.target.value)}
              placeholder="B2B SaaS founders hiring SDRs"
            />
          </div>
          <div>
            <Button
              type="button"
              disabled={going || !websiteUrl.trim() || !targetCustomerText.trim()}
              onClick={async () => {
                setGoing(true);
                setError("");
                try {
                  const mission = await createMissionApi(brandId, {
                    websiteUrl,
                    targetCustomerText,
                    autopilot: true,
                  });
                  setMissions((current) => [mission, ...current.filter((row) => row.id !== mission.id)]);
                  router.push(`/brands/${brandId}/missions/${mission.id}`);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to start AI campaign");
                } finally {
                  setGoing(false);
                }
              }}
            >
              <Sparkles className="h-4 w-4" />
              {going ? "Starting..." : "Go"}
            </Button>
          </div>
        </div>
      </SectionPanel>

      {latestMission ? (
        <SectionPanel title="Recent missions" description="Open one to see the current move, risk, and results.">
          <div className="grid gap-2">
            {missions.slice(0, 5).map((mission) => (
              <Link
                key={mission.id}
                href={`/brands/${brandId}/missions/${mission.id}`}
                className="flex items-center justify-between rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2.5 text-sm transition-colors hover:bg-[color:var(--surface-hover)]"
              >
                <span className="min-w-0 truncate">{mission.generatedPlan.offerSummary || mission.websiteUrl}</span>
                <span className="shrink-0 text-xs text-[color:var(--muted-foreground)]">{statusLabel(mission.status)}</span>
              </Link>
            ))}
          </div>
        </SectionPanel>
      ) : !loading ? (
        <EmptyState
          title="No missions yet."
          description={brand ? `Start the first AI campaign for ${brand.name}.` : "Start the first AI campaign."}
        />
      ) : null}
    </div>
  );
}
