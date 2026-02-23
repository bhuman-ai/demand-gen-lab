"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBrandApi } from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";

function StringListEditor({
  id,
  label,
  description,
  placeholder,
  values,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (values.some((row) => row.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...values, value]);
    setDraft("");
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="text-xs text-[color:var(--muted-foreground)]">{description}</div>
      <div className="flex flex-wrap gap-2">
        {values.map((item) => (
          <Badge key={`${id}_${item}`} variant="muted" className="gap-1 pr-1">
            <span>{item}</span>
            <button
              type="button"
              aria-label={`Remove ${item}`}
              className="rounded-full p-1 hover:bg-[color:var(--surface-muted)]"
              onClick={() => onChange(values.filter((row) => row !== item))}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        <Button type="button" variant="outline" onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
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
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
    } catch {
      setError("Prefill failed");
    } finally {
      setPrefillLoading(false);
    }
  };

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const brand = await createBrandApi({
        name,
        website,
        tone,
        product,
        notes,
        targetMarkets,
        idealCustomerProfiles,
        keyFeatures,
        keyBenefits,
      });
      localStorage.setItem("factory.activeBrandId", brand.id);
      trackEvent("brand_created", { brandId: brand.id, name: brand.name });
      router.push(`/brands/${brand.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Create Brand</CardTitle>
          <CardDescription>
            Add website, then prefill target markets, ICPs, product context, features, and benefits.
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
              {prefillLoading ? "Prefilling market and ICP context..." : "Scrape & Prefill"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand Context</CardTitle>
          <CardDescription>
            This context powers experiment targeting, message generation, and campaign quality.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tone">Tone</Label>
            <Input id="tone" value={tone} onChange={(event) => setTone(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="product">Product Summary</Label>
            <Textarea
              id="product"
              value={product}
              onChange={(event) => setProduct(event.target.value)}
              placeholder="What the product does, for whom, and why it matters."
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <StringListEditor
              id="targetMarkets"
              label="Target Markets"
              description="Add one or more market segments."
              placeholder="e.g. Mid-market B2B SaaS"
              values={targetMarkets}
              onChange={setTargetMarkets}
            />
            <StringListEditor
              id="icps"
              label="Ideal Customer Profiles (ICPs)"
              description="Add one or more buyer profiles."
              placeholder="e.g. VP Sales at 50-500 employee SaaS"
              values={idealCustomerProfiles}
              onChange={setIdealCustomerProfiles}
            />
            <StringListEditor
              id="features"
              label="Key Features"
              description="Core capabilities users buy."
              placeholder="e.g. AI-personalized video generation"
              values={keyFeatures}
              onChange={setKeyFeatures}
            />
            <StringListEditor
              id="benefits"
              label="Key Benefits"
              description="Business outcomes users care about."
              placeholder="e.g. Higher reply rate with less manual work"
              values={keyBenefits}
              onChange={setKeyBenefits}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes">Proof / Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Proof points, social proof, results, and constraints."
            />
          </div>

          {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
          <div className="flex gap-2">
            <Button type="button" onClick={save} disabled={saving || !name.trim() || !website.trim()}>
              {saving ? "Saving..." : "Save Brand"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push("/brands")}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
