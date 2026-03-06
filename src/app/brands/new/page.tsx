"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBrandApi, generateExperimentSuggestions } from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";

type NicheOption = {
  id: string;
  label: string;
  subniches: string[];
};

const NICHE_OPTIONS: NicheOption[] = [
  {
    id: "saas",
    label: "B2B SaaS",
    subniches: ["Sales Tech", "RevOps", "Marketing Automation", "Customer Success", "Analytics"],
  },
  {
    id: "services",
    label: "Agencies & Services",
    subniches: ["Performance Marketing", "Creative Studio", "Outbound Agency", "Consulting", "Recruiting"],
  },
  {
    id: "fintech",
    label: "Fintech",
    subniches: ["Payments", "Lending", "Treasury", "Compliance", "Accounting"],
  },
  {
    id: "healthcare",
    label: "Healthcare",
    subniches: ["Health IT", "Med Device", "Provider Ops", "Revenue Cycle", "Patient Engagement"],
  },
  {
    id: "legal",
    label: "Legal & Compliance",
    subniches: ["Legal Tech", "Contract Ops", "eDiscovery", "Case Management", "Risk/Compliance"],
  },
  {
    id: "ecommerce",
    label: "E-commerce & Retail",
    subniches: ["DTC", "Marketplaces", "Merchandising", "Loyalty", "Post-purchase"],
  },
  {
    id: "industrial",
    label: "Industrial & Logistics",
    subniches: ["Manufacturing", "Supply Chain", "Procurement", "Fleet", "Warehouse Ops"],
  },
];

const PERSONA_OPTIONS = [
  "Founder / CEO",
  "VP Marketing",
  "Demand Gen Manager",
  "Sales Leader",
  "Revenue Operations",
  "Customer Success Leader",
  "Operations Manager",
  "IT / Systems Owner",
  "Finance Leader",
];

function dedupeLines(lines: string[]) {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const line of lines) {
    const value = line.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(value);
  }
  return rows;
}

function inferPrimaryNiche(markets: string[]) {
  const normalized = markets.map((row) => row.toLowerCase());
  for (const option of NICHE_OPTIONS) {
    const optionLabel = option.label.toLowerCase();
    if (normalized.some((row) => row.includes(optionLabel))) return option.id;
    const matchedSub = option.subniches.some((sub) => normalized.some((row) => row.includes(sub.toLowerCase())));
    if (matchedSub) return option.id;
  }
  return "";
}

function inferSubniches(markets: string[], nicheId: string) {
  const niche = NICHE_OPTIONS.find((row) => row.id === nicheId);
  if (!niche) return [];
  const normalized = markets.map((row) => row.toLowerCase());
  return niche.subniches.filter((sub) => normalized.some((row) => row.includes(sub.toLowerCase())));
}

export default function NewBrandPage() {
  const router = useRouter();
  const [website, setWebsite] = useState("");
  const [name, setName] = useState("");
  const [tone, setTone] = useState("");
  const [product, setProduct] = useState("");
  const [notes, setNotes] = useState("");
  const [targetMarkets, setTargetMarkets] = useState<string[]>([]);
  const [idealCustomerProfiles, setIdealCustomerProfiles] = useState<string[]>([]);
  const [keyFeatures, setKeyFeatures] = useState<string[]>([]);
  const [keyBenefits, setKeyBenefits] = useState<string[]>([]);
  const [selectedPrimaryNicheId, setSelectedPrimaryNicheId] = useState("");
  const [selectedSubniches, setSelectedSubniches] = useState<string[]>([]);
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([]);
  const [oneInputContext, setOneInputContext] = useState("");
  const [prefillRan, setPrefillRan] = useState(false);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedPrimaryNiche = NICHE_OPTIONS.find((row) => row.id === selectedPrimaryNicheId) ?? null;
  const stepProgress = {
    website: Boolean(website.trim()),
    niche: Boolean(selectedPrimaryNicheId),
    subniches: selectedSubniches.length > 0,
    personas: selectedPersonas.length > 0,
  };
  const previewTargetMarkets = dedupeLines([
    selectedPrimaryNiche?.label ?? "",
    ...selectedSubniches,
    ...targetMarkets,
  ]);
  const previewIcps = dedupeLines([...selectedPersonas, ...idealCustomerProfiles]);

  const runPrefill = async () => {
    if (!website.trim()) return;
    setError("");
    setPrefillLoading(true);
    try {
      const response = await fetch("/api/intake/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: website }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "Prefill failed");
        return;
      }
      setName(String(data?.prefill?.brandName ?? name));
      setTone(String(data?.prefill?.tone ?? tone));
      setProduct(String(data?.prefill?.product ?? product));
      setNotes(String(data?.prefill?.proof ?? notes));
      setTargetMarkets(Array.isArray(data?.prefill?.targetMarkets) ? data.prefill.targetMarkets : []);
      setIdealCustomerProfiles(
        Array.isArray(data?.prefill?.idealCustomerProfiles) ? data.prefill.idealCustomerProfiles : []
      );
      setKeyFeatures(Array.isArray(data?.prefill?.keyFeatures) ? data.prefill.keyFeatures : []);
      setKeyBenefits(Array.isArray(data?.prefill?.keyBenefits) ? data.prefill.keyBenefits : []);
      setPrefillRan(true);
      const markets = Array.isArray(data?.prefill?.targetMarkets) ? data.prefill.targetMarkets : [];
      const inferredPrimary = inferPrimaryNiche(markets);
      if (inferredPrimary) {
        setSelectedPrimaryNicheId(inferredPrimary);
        setSelectedSubniches(inferSubniches(markets, inferredPrimary));
      }
    } catch {
      setError("Prefill failed");
    } finally {
      setPrefillLoading(false);
    }
  };

  const toggleSubniche = (value: string) => {
    setSelectedSubniches((prev) =>
      prev.includes(value) ? prev.filter((row) => row !== value) : [...prev, value]
    );
  };

  const togglePersona = (value: string) => {
    setSelectedPersonas((prev) =>
      prev.includes(value) ? prev.filter((row) => row !== value) : [...prev, value]
    );
  };

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      let parsedHost = "";
      try {
        parsedHost = new URL(website).hostname.replace(/^www\./, "");
      } catch {
        parsedHost = website.trim();
      }
      const fallbackName = parsedHost || "New Brand";
      const quizMarkets = dedupeLines([
        selectedPrimaryNiche?.label ?? "",
        ...selectedSubniches,
      ]);
      const finalTargetMarkets = dedupeLines([...quizMarkets, ...targetMarkets]);
      const finalIcp = dedupeLines([...selectedPersonas, ...idealCustomerProfiles]);
      const finalNotes = [notes.trim(), oneInputContext.trim()].filter(Boolean).join("\n\n");

      const brand = await createBrandApi({
        name: name.trim() || fallbackName,
        website,
        tone: tone.trim(),
        product: product.trim(),
        notes: finalNotes,
        targetMarkets: finalTargetMarkets,
        idealCustomerProfiles: finalIcp,
        keyFeatures: dedupeLines(keyFeatures),
        keyBenefits: dedupeLines(keyBenefits),
      });
      localStorage.setItem("factory.activeBrandId", brand.id);
      trackEvent("brand_created", { brandId: brand.id, name: brand.name });
      await generateExperimentSuggestions(brand.id, true).catch(() => []);
      router.push(`/brands/${brand.id}/experiments?from=quiz`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-5 pb-28">
      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={stepProgress.website ? "success" : "muted"}>1 Website</Badge>
          <Badge variant={stepProgress.niche ? "success" : "muted"}>2 Primary niche</Badge>
          <Badge variant={stepProgress.subniches ? "success" : "muted"}>3 Subniches</Badge>
          <Badge variant={stepProgress.personas ? "success" : "muted"}>4 Personas</Badge>
        </div>
        <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">
          Mobbin-inspired setup: compact steps, chip selection, then one sticky action rail.
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Brand Setup Quiz</CardTitle>
          <CardDescription>
            One input to start: website. Then select niche + subniches and we generate your experiment feed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={runPrefill} disabled={prefillLoading || !website.trim()}>
              <Sparkles className="h-4 w-4" />
              {prefillLoading ? "Analyzing website..." : "Analyze Website"}
            </Button>
            {prefillRan ? <Badge variant="success">Context loaded</Badge> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Go-To-Market Quiz</CardTitle>
          <CardDescription>
            Pick a primary niche first. Then choose subniches and personas with multi-select.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>1) Primary niche</Label>
            <div className="flex flex-wrap gap-2">
              {NICHE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    selectedPrimaryNicheId === option.id
                      ? "border-[color:var(--foreground)] bg-[color:var(--surface)] text-[color:var(--foreground)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--muted-foreground)]"
                  }`}
                  onClick={() => {
                    setSelectedPrimaryNicheId(option.id);
                    setSelectedSubniches((prev) => prev.filter((row) => option.subniches.includes(row)));
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>2) Subniches (multi-select)</Label>
            {selectedPrimaryNiche ? (
              <div className="flex flex-wrap gap-2">
                {selectedPrimaryNiche.subniches.map((subniche) => {
                  const selected = selectedSubniches.includes(subniche);
                  return (
                    <button
                      key={subniche}
                      type="button"
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                        selected
                          ? "border-[color:var(--foreground)] bg-[color:var(--surface)] text-[color:var(--foreground)]"
                          : "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--muted-foreground)]"
                      }`}
                      onClick={() => toggleSubniche(subniche)}
                    >
                      {subniche}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-[color:var(--muted-foreground)]">
                Select primary niche first.
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label>3) Buyer personas (multi-select)</Label>
            <div className="flex flex-wrap gap-2">
              {PERSONA_OPTIONS.map((persona) => {
                const selected = selectedPersonas.includes(persona);
                return (
                  <button
                    key={persona}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      selected
                        ? "border-[color:var(--foreground)] bg-[color:var(--surface)] text-[color:var(--foreground)]"
                        : "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--muted-foreground)]"
                    }`}
                    onClick={() => togglePersona(persona)}
                  >
                    {persona}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="oneInputContext">4) One extra context input (optional)</Label>
            <Textarea
              id="oneInputContext"
              value={oneInputContext}
              onChange={(event) => setOneInputContext(event.target.value)}
              placeholder="Anything specific we should prioritize in outreach?"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live Feed Inputs Preview</CardTitle>
          <CardDescription>
            This is exactly what will be used to generate your experiment suggestion feed.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">Target markets</div>
            <div className="flex flex-wrap gap-2">
              {previewTargetMarkets.length ? (
                previewTargetMarkets.map((item) => (
                  <Badge key={item} variant="muted">
                    {item}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-[color:var(--muted-foreground)]">No markets selected yet.</span>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">ICPs / personas</div>
            <div className="flex flex-wrap gap-2">
              {previewIcps.length ? (
                previewIcps.map((item) => (
                  <Badge key={item} variant="muted">
                    {item}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-[color:var(--muted-foreground)]">No personas selected yet.</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Generated Context (Optional Review)</CardTitle>
          <CardDescription>
            Website analysis fills this automatically. Edit only if needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="name">Brand Name</Label>
              <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tone">Tone</Label>
              <Input id="tone" value={tone} onChange={(event) => setTone(event.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="product">Product Summary</Label>
            <Textarea
              id="product"
              value={product}
              onChange={(event) => setProduct(event.target.value)}
              placeholder="What the product does and why it matters."
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">Proof / Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Proof points from site analysis."
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">Detected Features</div>
              <div className="flex flex-wrap gap-2">
                {keyFeatures.length ? keyFeatures.map((item) => (
                  <Badge key={item} variant="muted">{item}</Badge>
                )) : <span className="text-xs text-[color:var(--muted-foreground)]">None yet</span>}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Detected Benefits</div>
              <div className="flex flex-wrap gap-2">
                {keyBenefits.length ? keyBenefits.map((item) => (
                  <Badge key={item} variant="muted">{item}</Badge>
                )) : <span className="text-xs text-[color:var(--muted-foreground)]">None yet</span>}
              </div>
            </div>
          </div>

          {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-20 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 shadow-[0_12px_32px_-20px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-[color:var(--muted-foreground)]">
            Showing setup completeness: {Number(stepProgress.website) + Number(stepProgress.niche) + Number(stepProgress.subniches) + Number(stepProgress.personas)}/4
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => router.push("/brands")}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={saving || !website.trim()}>
              {saving ? "Creating brand and feed..." : "Finish Quiz & Generate Feed"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
