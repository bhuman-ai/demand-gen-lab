"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBrandApi } from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";

export default function NewBrandPage() {
  const router = useRouter();
  const [website, setWebsite] = useState("");
  const [name, setName] = useState("");
  const [tone, setTone] = useState("");
  const [notes, setNotes] = useState("");
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
      setNotes(String(data?.prefill?.proof ?? notes));
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
      const brand = await createBrandApi({ name, website, tone, notes });
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
    <div className="mx-auto grid max-w-3xl gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Create Brand</CardTitle>
          <CardDescription>Use prefill to bootstrap context, then save and move into campaigns.</CardDescription>
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
              {prefillLoading ? "Prefilling..." : "Scrape & Prefill"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand Context</CardTitle>
          <CardDescription>These fields power campaign objective and generation quality.</CardDescription>
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
            <Label htmlFor="notes">Proof / Notes</Label>
            <Textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
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
