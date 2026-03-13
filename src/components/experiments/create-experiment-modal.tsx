"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { createExperimentApi, draftExperimentFromPromptApi } from "@/lib/client-api";
import type { ExperimentRecord } from "@/lib/factory-types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SettingsModal } from "@/app/settings/outreach/settings-primitives";

const EXAMPLE_PROMPTS = [
  "Find self-funded SaaS founders who might qualify for AWS credits and offer a short eligibility review.",
  "Reach CTOs at small SaaS companies and offer help getting through customer security reviews faster.",
  "Target finance leads at bootstrapped software companies and offer a simple way to cut software renewal waste.",
];

export default function CreateExperimentModal({
  brandId,
  open,
  defaultName,
  onOpenChange,
  onCreated,
}: {
  brandId: string;
  open: boolean;
  defaultName: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (experiment: ExperimentRecord, source: "blank" | "ai_prompt") => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"" | "blank" | "ai">("");

  useEffect(() => {
    if (open) return;
    setError("");
    setMode("");
  }, [open]);

  const creating = Boolean(mode);
  const canGenerate = prompt.trim().length > 0;
  const helperText = useMemo(
    () =>
      prompt.trim()
        ? "AI will draft the experiment name, audience, and offer. You can still edit everything after."
        : "Describe who you want to reach and what you want to offer. One plain-English sentence is enough.",
    [prompt]
  );

  const createBlank = async () => {
    setMode("blank");
    setError("");
    try {
      const experiment = await createExperimentApi(brandId, { name: defaultName });
      onCreated(experiment, "blank");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create experiment");
    } finally {
      setMode("");
    }
  };

  const createWithAi = async () => {
    if (!prompt.trim()) return;
    setMode("ai");
    setError("");
    try {
      const draft = await draftExperimentFromPromptApi(brandId, { prompt: prompt.trim() });
      const experiment = await createExperimentApi(brandId, {
        name: draft.name || defaultName,
        audience: draft.audience,
        offer: draft.offer,
      });
      onCreated(experiment, "ai_prompt");
      setPrompt("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to draft experiment");
    } finally {
      setMode("");
    }
  };

  return (
    <SettingsModal
      open={open}
      onOpenChange={onOpenChange}
      title="Create experiment"
      description="Tell the AI what you want to test. It will draft the setup for you."
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => void createBlank()} disabled={creating}>
            {mode === "blank" ? "Creating..." : "Start blank"}
          </Button>
          <Button type="button" onClick={() => void createWithAi()} disabled={creating || !canGenerate}>
            <Sparkles className="h-4 w-4" />
            {mode === "ai" ? "Writing..." : "Write it for me"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-sm text-[color:var(--muted-foreground)]">
          {helperText}
        </div>
        <Textarea
          rows={5}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Example: Reach bootstrapped SaaS founders who are trying to cut cloud costs and offer a quick AWS credits eligibility review plus a checklist."
        />
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setPrompt(example)}
              className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1.5 text-xs text-[color:var(--muted-foreground)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--foreground)]"
            >
              {example}
            </button>
          ))}
        </div>
        {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
      </div>
    </SettingsModal>
  );
}
