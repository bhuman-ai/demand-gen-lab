"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCcw,
  Sparkles,
  Trophy,
  WandSparkles,
} from "lucide-react";
import {
  fetchBrand,
  fetchBrandIntakePrefill,
  fetchSavedOutreachFlowTournamentApi,
  saveOutreachFlowTournamentResultApi,
  streamOutreachFlowTournamentApi,
} from "@/lib/client-api";
import { OUTREACH_FLOW_AGENTS } from "@/lib/outreach-flow-agent-data";
import { trackEvent } from "@/lib/telemetry-client";
import { cn } from "@/lib/utils";
import type {
  BrandRecord,
  OutreachFlowTournamentCandidate,
  OutreachFlowTournamentInput,
  OutreachFlowTournamentResult,
  OutreachFlowTournamentSavedResult,
  OutreachFlowTournamentStreamEvent,
  OutreachFlowTournamentTurn,
} from "@/lib/factory-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const FORM_STORAGE_PREFIX = "factory.outreachFlow";
const RESULT_STORAGE_PREFIX = "factory.outreachFlow.result";
const TURN_EASE = "motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]";

type OutreachFlowFormState = {
  target: string;
  desiredOutcome: string;
  offer: string;
  channel: string;
  firstValueAsset: string;
};

type BrandIntakePrefill = Awaited<ReturnType<typeof fetchBrandIntakePrefill>>;

type PrefillFeedback = {
  tone: "idle" | "success" | "error";
  message: string;
};

type DesiredOutcomeOption = {
  id: string;
  label: string;
  detail: string;
  value: string;
};

type GuidedChoice = {
  id: string;
  label: string;
  detail: string;
  value: string;
};

type StreamPhaseState = {
  phase: "planning" | "generating" | "judging" | "shortlisting";
  phaseLabel: string;
};

type StreamAgentState = Omit<OutreachFlowTournamentTurn, "status"> & {
  status: OutreachFlowTournamentTurn["status"] | "queued";
};

const INITIAL_FORM: OutreachFlowFormState = {
  target: "",
  desiredOutcome: "",
  offer: "",
  channel: "email",
  firstValueAsset: "",
};

function normalizeWebsiteForPrefill(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname || !parsed.hostname.includes(".")) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function mergePrefillValue(current: string, next: string, overwrite = false) {
  const normalizedNext = next.trim();
  if (!normalizedNext) return current;
  if (overwrite || !current.trim()) return normalizedNext;
  return current;
}

function firstMeaningful(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function firstListItem(...lists: Array<string[] | undefined>) {
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const trimmed = String(entry ?? "").trim();
      if (trimmed) return trimmed;
    }
  }
  return "";
}

function trimSentence(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
}

function dedupeText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function shortLabel(value: string, maxWords = 4) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function choiceId(prefix: string, value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${prefix}-${slug || "choice"}`;
}

function hostnameFromWebsite(value: string) {
  const normalized = normalizeWebsiteForPrefill(value);
  if (!normalized) return "";
  try {
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function buildOfferDraft(brand: BrandRecord, sitePrefill?: BrandIntakePrefill | null) {
  return trimSentence(
    firstMeaningful(brand.product, sitePrefill?.prefill.product, brand.name)
  );
}

function buildTargetDraft(
  brand: BrandRecord,
  offer: string,
  sitePrefill?: BrandIntakePrefill | null
) {
  const buyer = firstMeaningful(
    firstListItem(brand.idealCustomerProfiles),
    firstListItem(sitePrefill?.prefill.idealCustomerProfiles)
  );
  const market = firstMeaningful(
    firstListItem(brand.targetMarkets),
    firstListItem(sitePrefill?.prefill.targetMarkets)
  );
  const benefit = firstMeaningful(
    firstListItem(brand.keyBenefits),
    firstListItem(sitePrefill?.prefill.keyBenefits)
  );
  const normalizedOffer = trimSentence(offer);

  if (buyer && market && benefit) {
    return `${buyer} at ${market} who is actively trying to improve ${trimSentence(benefit)}`;
  }

  if (buyer && market) {
    return `${buyer} at ${market} who could realistically buy ${normalizedOffer}`;
  }

  if (buyer) {
    return `${buyer} who could realistically buy ${normalizedOffer}`;
  }

  if (market) {
    return `Decision-maker at ${market} who could realistically buy ${normalizedOffer}`;
  }

  return `Decision-maker at companies that look like a strong fit for ${normalizedOffer}`;
}

function buildDesiredOutcomeSignalText(
  brand: BrandRecord,
  sitePrefill?: BrandIntakePrefill | null
) {
  return [
    brand.product,
    brand.notes,
    ...brand.keyFeatures,
    ...brand.keyBenefits,
    ...brand.targetMarkets,
    ...brand.idealCustomerProfiles,
    sitePrefill?.prefill.product,
    ...(sitePrefill?.prefill.keyFeatures ?? []),
    ...(sitePrefill?.prefill.keyBenefits ?? []),
    ...(sitePrefill?.prefill.targetMarkets ?? []),
    ...(sitePrefill?.prefill.idealCustomerProfiles ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function buildDesiredOutcomeOptions(
  brand: BrandRecord,
  offer: string,
  sitePrefill?: BrandIntakePrefill | null
): DesiredOutcomeOption[] {
  const normalizedOffer = trimSentence(offer) || "the offer";
  const signalText = buildDesiredOutcomeSignalText(brand, sitePrefill);

  if (
    /(agency|consult|consulting|service|studio|fractional|commission|teardown|audit|review|done[- ]for[- ]you|implementation)/.test(
      signalText
    )
  ) {
    return [
      {
        id: "scope",
        label: "Scope the work",
        detail: "Get the context needed to shape the job.",
        value: `Get them to reply with the context needed to scope ${normalizedOffer}`,
      },
      {
        id: "sample",
        label: "Small sample",
        detail: "Move toward a low-risk first piece of work.",
        value: `Get them into an async thread that naturally leads to a small sample, teardown, or review tied to ${normalizedOffer}`,
      },
      {
        id: "fit",
        label: "See if it fits",
        detail: "Find out whether this is worth pursuing now.",
        value: `Get them into an async thread that naturally shows whether ${normalizedOffer} is worth pursuing now`,
      },
    ];
  }

  if (/(community|collective|membership|program|newsletter|network|cohort)/.test(signalText)) {
    return [
      {
        id: "fit",
        label: "Check fit",
        detail: "See whether the person belongs in this offer.",
        value: `Get them to reply with enough context to see whether ${normalizedOffer} is a fit`,
      },
      {
        id: "join",
        label: "Move toward joining",
        detail: "Make the next serious step joining or applying.",
        value: `Get them into an async thread that naturally makes joining ${normalizedOffer} the next serious step`,
      },
      {
        id: "route",
        label: "Route it right",
        detail: "Let them pass it to the right owner if relevant.",
        value: `Get them to route this to the right person if ${normalizedOffer} is relevant`,
      },
    ];
  }

  if (/(trial|signup|sign up|platform|software|saas|tool|app|workspace|automation|api|dashboard|self[- ]serve)/.test(signalText)) {
    return [
      {
        id: "try",
        label: "Try it",
        detail: "Move toward using the product directly.",
        value: `Get them into an async thread that naturally makes trying ${normalizedOffer} the next serious step`,
      },
      {
        id: "pilot",
        label: "Start small",
        detail: "Move toward a low-risk first pilot.",
        value: `Get them into an async thread that naturally leads to a small pilot of ${normalizedOffer}`,
      },
      {
        id: "fit",
        label: "Check workflow fit",
        detail: "See whether it fits how they work.",
        value: `Get them to reply with the context needed to see whether ${normalizedOffer} fits their workflow`,
      },
    ];
  }

  return [
    {
      id: "next-step",
      label: "Make it the next step",
      detail: "Keep the thread moving toward the offer.",
      value: `Get them into an async thread that naturally makes ${normalizedOffer} the next serious step`,
    },
    {
      id: "fit",
      label: "Check fit",
      detail: "See whether this is relevant before pushing harder.",
      value: `Get them to reply with enough context to see whether ${normalizedOffer} is a fit`,
    },
    {
      id: "small-start",
      label: "Start small",
      detail: "Move toward a light first use or test.",
      value: `Get them into an async thread that naturally leads to a small first step with ${normalizedOffer}`,
    },
  ];
}

function buildDesiredOutcomeDraft(
  brand: BrandRecord,
  offer: string,
  sitePrefill?: BrandIntakePrefill | null
) {
  return buildDesiredOutcomeOptions(brand, offer, sitePrefill)[0]?.value
    ?? `Get them into an async thread that naturally makes ${trimSentence(offer) || "the offer"} the next serious step`;
}

function buildBrandBriefDraft(brand: BrandRecord, sitePrefill?: BrandIntakePrefill | null) {
  const offer = buildOfferDraft(brand, sitePrefill);
  return {
    offer,
    target: buildTargetDraft(brand, offer, sitePrefill),
    desiredOutcome: buildDesiredOutcomeDraft(brand, offer, sitePrefill),
    hostname: firstMeaningful(sitePrefill?.signals.hostname, hostnameFromWebsite(brand.website)),
  };
}

function buildTargetOptions(
  brand: BrandRecord,
  offer: string,
  sitePrefill?: BrandIntakePrefill | null
): GuidedChoice[] {
  const choices: GuidedChoice[] = [];
  const pushChoice = (label: string, detail: string, value: string) => {
    const normalizedValue = value.trim();
    if (!normalizedValue || choices.some((choice) => choice.value === normalizedValue)) return;
    choices.push({
      id: choiceId("target", normalizedValue),
      label,
      detail: detail.trim() || normalizedValue,
      value: normalizedValue,
    });
  };

  const draft = buildTargetDraft(brand, offer, sitePrefill);
  pushChoice("Best brand fit", draft, draft);

  const buyers = dedupeText([
    ...brand.idealCustomerProfiles,
    ...(sitePrefill?.prefill.idealCustomerProfiles ?? []),
  ]);
  const markets = dedupeText([
    ...brand.targetMarkets,
    ...(sitePrefill?.prefill.targetMarkets ?? []),
  ]);
  const benefits = dedupeText([
    ...brand.keyBenefits,
    ...(sitePrefill?.prefill.keyBenefits ?? []),
  ]);

  buyers.slice(0, 2).forEach((buyer, index) => {
    const market = markets[index] || markets[0] || "";
    const benefit = benefits[index] || benefits[0] || "";
    const value =
      buyer && market && benefit
        ? `${buyer} at ${market} who is actively trying to improve ${trimSentence(benefit)}`
        : buyer && market
          ? `${buyer} at ${market} who could realistically buy ${trimSentence(offer) || "the offer"}`
          : buyer;
    pushChoice(index === 0 ? "Tighter buyer fit" : "Alternate buyer fit", value, value);
  });

  if (markets[0]) {
    const broaderTarget = `Decision-maker at ${markets[0]} who could realistically buy ${trimSentence(offer) || "the offer"}`;
    pushChoice("Broader market fit", broaderTarget, broaderTarget);
  }

  return choices.slice(0, 4);
}

function firstValueLabel(asset: string) {
  const lower = asset.toLowerCase();
  if (/(article|interview|editorial|feature|coverage|spotlight)/.test(lower)) {
    return "Article or interview";
  }
  if (/(benchmark|research|study|report|note)/.test(lower)) {
    return "Research or benchmark";
  }
  if (/(trial|account|pilot|test)/.test(lower)) {
    return "Hands-on trial";
  }
  if (/(founder|q&a)/.test(lower)) {
    return "Founder access";
  }
  if (/(community|roundtable|event|panel)/.test(lower)) {
    return "Event or roundtable";
  }
  return shortLabel(asset, 5) || "Saved asset";
}

function buildFirstValueOptions(brand: BrandRecord): GuidedChoice[] {
  return dedupeText(brand.availableAssets).slice(0, 4).map((asset) => ({
    id: choiceId("asset", asset),
    label: firstValueLabel(asset),
    detail: asset,
    value: asset,
  }));
}

function prefillFeedbackClass(tone: PrefillFeedback["tone"]) {
  if (tone === "success") return "text-[color:var(--success)]";
  if (tone === "error") return "text-[color:var(--danger)]";
  return "text-[color:var(--muted-foreground)]";
}

function progressLabel(result: OutreachFlowTournamentResult | null, running: boolean) {
  if (running) {
    return {
      title: "Outreach-flow tournament is running",
      detail: "Live state below comes from real planning, drafting, judging, and shortlist events.",
    };
  }

  if (result) {
    return {
      title: "Shortlist is ready",
      detail: `${result.snapshot.accepted} of ${result.snapshot.ideas} ideas survived the gate.`,
    };
  }

  return {
    title: "Design a reply-first bridge system",
    detail: "Write the brief once, then let the arena pressure-test full persona, asset, and bridge systems for you.",
  };
}

function candidateTone(
  candidate: OutreachFlowTournamentCandidate
): "success" | "accent" | "danger" {
  if (candidate.accepted) return "success";
  if (candidate.decision === "revise") return "accent";
  return "danger";
}

function candidateLabel(candidate: OutreachFlowTournamentCandidate) {
  if (candidate.accepted) return "Accepted";
  if (candidate.decision === "revise") return "Needs rewrite";
  return "Rejected";
}

function findBranch(candidate: OutreachFlowTournamentCandidate, branchName: string) {
  return (
    candidate.branches.find(
      (branch) => branch.branch.trim().toLowerCase() === branchName.trim().toLowerCase()
    ) ?? null
  );
}

function candidateArchitectureDetails(candidate: OutreachFlowTournamentCandidate) {
  return [
    { label: "Persona", value: candidate.persona },
    { label: "Backing Asset", value: candidate.backingAsset },
    { label: "System Entry", value: candidate.entryVehicle },
    { label: "First Win", value: candidate.firstValue || candidate.whyReply },
    { label: "Opener", value: candidate.openerBody },
    { label: "Proof Loop", value: candidate.proofLoop },
    { label: "Bridge Trigger", value: candidate.bridgeTrigger },
    { label: "Bridge Moment", value: candidate.bridgeMoment },
    { label: "Handoff", value: candidate.handoffPlan },
    { label: "CTA", value: candidate.cta },
  ].filter((field) => field.value.trim());
}

function DetailField({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3",
        className
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
        {label}
      </p>
      <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">{value}</p>
    </div>
  );
}

function ChoiceCard({
  label,
  detail,
  active,
  onClick,
}: {
  label: string;
  detail: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-[16px] border px-4 py-3 text-left transition-[border-color,background-color,box-shadow] duration-200",
        active
          ? "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] shadow-[0_12px_28px_-20px_color-mix(in_srgb,var(--accent)_35%,transparent)]"
          : "border-[color:var(--border)] bg-[color:var(--surface-muted)]"
      )}
      onClick={onClick}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[color:var(--foreground)]">{label}</p>
        {active ? <Badge variant="accent">Selected</Badge> : null}
      </div>
      <p className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">{detail}</p>
    </button>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-2">
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          {label}
        </p>
        {hint ? (
          <p className="text-xs leading-5 text-[color:var(--muted-foreground)]">{hint}</p>
        ) : null}
      </div>
      {children}
    </label>
  );
}

function turnAcceptedCount(turn: OutreachFlowTournamentTurn) {
  return turn.acceptedTitles.length;
}

function seedStreamAgents(requestedAgents: number): StreamAgentState[] {
  return OUTREACH_FLOW_AGENTS.slice(0, requestedAgents).map((agent, index) => ({
    order: index + 1,
    agentId: agent.id,
    agentName: agent.name,
    agentStyle: agent.style,
    brief: agent.brief,
    status: "queued",
    ideas: [],
    acceptedTitles: [],
    error: "",
  }));
}

function upsertStreamAgent(streamAgents: StreamAgentState[], nextTurn: OutreachFlowTournamentTurn) {
  const copy = [...streamAgents];
  const existingIndex = copy.findIndex((agent) => agent.agentId === nextTurn.agentId);
  const nextAgent: StreamAgentState = {
    ...nextTurn,
    error: nextTurn.error || "",
  };

  if (existingIndex >= 0) {
    copy[existingIndex] = {
      ...copy[existingIndex],
      ...nextAgent,
    };
  } else {
    copy.push(nextAgent);
  }

  copy.sort((left, right) => left.order - right.order);
  return copy;
}

function streamAgentStatusLabel(agent: StreamAgentState) {
  if (agent.status === "queued") return "Queued";
  if (agent.status === "drafting") return "Drafting";
  if (agent.status === "failed") return "Failed";
  return `${agent.ideas.length} drafted`;
}

function streamAgentStatusVariant(agent: StreamAgentState) {
  if (agent.status === "drafting") return "accent";
  if (agent.status === "drafted") return "success";
  if (agent.status === "failed") return "danger";
  return "muted";
}

function readStoredResult(
  storageKey: string,
  brandId: string
): OutreachFlowTournamentSavedResult | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OutreachFlowTournamentSavedResult>;
    if (typeof parsed?.brandId !== "string" || parsed.brandId !== brandId) return null;
    if (!parsed.brief || typeof parsed.brief !== "object") return null;
    if (!parsed.result || typeof parsed.result !== "object") return null;
    if (typeof parsed.createdAt !== "string" || typeof parsed.updatedAt !== "string") return null;
    return parsed as OutreachFlowTournamentSavedResult;
  } catch {
    return null;
  }
}

function savedResultUpdatedAt(value: OutreachFlowTournamentSavedResult | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export default function OutreachFlowSuggestionsPanel({ brandId }: { brandId: string }) {
  const controllerRef = useRef<AbortController | null>(null);
  const autoPrefillKeyRef = useRef("");
  const hasStoredDraftRef = useRef(false);
  const userEditedBriefRef = useRef(false);
  const runningRef = useRef(false);
  const resultSyncKeyRef = useRef("");
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [sitePrefill, setSitePrefill] = useState<BrandIntakePrefill | null>(null);
  const [form, setForm] = useState<OutreachFlowFormState>(INITIAL_FORM);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<OutreachFlowTournamentResult | null>(null);
  const [desiredOutcomeChoiceId, setDesiredOutcomeChoiceId] = useState("");
  const [customTargetOpen, setCustomTargetOpen] = useState(false);
  const [customDesiredOutcomeOpen, setCustomDesiredOutcomeOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [streamPhase, setStreamPhase] = useState<StreamPhaseState | null>(null);
  const [streamAgents, setStreamAgents] = useState<StreamAgentState[]>([]);
  const [requestedAgents, setRequestedAgents] = useState(0);
  const [ideasPerAgent, setIdeasPerAgent] = useState(0);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [prefillFeedback, setPrefillFeedback] = useState<PrefillFeedback>({
    tone: "idle",
    message: "",
  });

  const storageKey = `${FORM_STORAGE_PREFIX}:${brandId}`;
  const resultStorageKey = `${RESULT_STORAGE_PREFIX}:${brandId}`;
  const normalizedBrandWebsite = useMemo(
    () => normalizeWebsiteForPrefill(brand?.website ?? ""),
    [brand?.website]
  );
  const brandHostname = useMemo(
    () => hostnameFromWebsite(normalizedBrandWebsite),
    [normalizedBrandWebsite]
  );
  const desiredOutcomeOptions = useMemo(() => {
    if (!brand) return [] as DesiredOutcomeOption[];
    const offer = trimSentence(form.offer) || buildOfferDraft(brand, sitePrefill);
    return buildDesiredOutcomeOptions(brand, offer, sitePrefill);
  }, [brand, form.offer, sitePrefill]);
  const baseTargetOptions = useMemo(() => {
    if (!brand) return [] as GuidedChoice[];
    const offer = trimSentence(form.offer) || buildOfferDraft(brand, sitePrefill);
    return buildTargetOptions(brand, offer, sitePrefill);
  }, [brand, form.offer, sitePrefill]);
  const targetOptions = useMemo(() => {
    const currentTarget = form.target.trim();
    if (!currentTarget || baseTargetOptions.some((choice) => choice.value === currentTarget)) {
      return baseTargetOptions;
    }
    return [
      {
        id: choiceId("target", currentTarget),
        label: "Current target",
        detail: currentTarget,
        value: currentTarget,
      },
      ...baseTargetOptions,
    ];
  }, [baseTargetOptions, form.target]);
  const baseFirstValueOptions = useMemo(() => {
    if (!brand) return [] as GuidedChoice[];
    return buildFirstValueOptions(brand);
  }, [brand]);
  const firstValueOptions = useMemo(() => {
    const currentAsset = form.firstValueAsset.trim();
    if (!currentAsset || baseFirstValueOptions.some((choice) => choice.value === currentAsset)) {
      return baseFirstValueOptions;
    }
    return [
      {
        id: choiceId("asset", currentAsset),
        label: "Current first value",
        detail: currentAsset,
        value: currentAsset,
      },
      ...baseFirstValueOptions,
    ];
  }, [baseFirstValueOptions, form.firstValueAsset]);
  const updateFormFromUser = useCallback(
    (
      updater:
        | Partial<OutreachFlowFormState>
        | ((current: OutreachFlowFormState) => OutreachFlowFormState)
    ) => {
      userEditedBriefRef.current = true;
      setForm((current) =>
        typeof updater === "function"
          ? (updater as (current: OutreachFlowFormState) => OutreachFlowFormState)(current)
          : { ...current, ...updater }
      );
    },
    []
  );
  const persistStoredResult = useCallback(
    (savedResult: OutreachFlowTournamentSavedResult | null) => {
      if (typeof window === "undefined") return;
      if (!savedResult) {
        window.localStorage.removeItem(resultStorageKey);
        return;
      }
      window.localStorage.setItem(resultStorageKey, JSON.stringify(savedResult));
    },
    [resultStorageKey]
  );
  const applySavedResult = useCallback(
    (savedResult: OutreachFlowTournamentSavedResult) => {
      setResult(savedResult.result);
      if (hasStoredDraftRef.current || userEditedBriefRef.current) return;
      setDesiredOutcomeChoiceId("");
      setCustomDesiredOutcomeOpen(false);
      setForm({
        target: savedResult.brief.target,
        desiredOutcome: savedResult.brief.desiredOutcome,
        offer: savedResult.brief.offer || "",
        channel: savedResult.brief.channel || "email",
        firstValueAsset: savedResult.brief.availableAssets?.[0] || "",
      });
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      hasStoredDraftRef.current = Boolean(raw);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<OutreachFlowFormState>;
      setForm((current) => ({
        ...current,
        target: typeof parsed.target === "string" ? parsed.target : current.target,
        desiredOutcome:
          typeof parsed.desiredOutcome === "string"
            ? parsed.desiredOutcome
            : current.desiredOutcome,
        offer: typeof parsed.offer === "string" ? parsed.offer : current.offer,
        channel: typeof parsed.channel === "string" ? parsed.channel : current.channel,
        firstValueAsset:
          typeof parsed.firstValueAsset === "string"
            ? parsed.firstValueAsset
            : current.firstValueAsset,
      }));
    } catch {
      hasStoredDraftRef.current = false;
    }
  }, [storageKey]);

  useEffect(() => {
    let mounted = true;
    controllerRef.current?.abort();
    controllerRef.current = null;
    userEditedBriefRef.current = false;
    setBrand(null);
    if (!hasStoredDraftRef.current) {
      setForm(INITIAL_FORM);
    }
    setSitePrefill(null);
    setCustomTargetOpen(false);
    setDesiredOutcomeChoiceId("");
    setCustomDesiredOutcomeOpen(false);
    setAdvancedOpen(false);
    setRunning(false);
    setError("");
    setResult(null);
    setStreamPhase(null);
    setStreamAgents([]);
    setRequestedAgents(0);
    setIdeasPerAgent(0);
    setPrefillFeedback({ tone: "idle", message: "" });

    const cachedSavedResult = readStoredResult(resultStorageKey, brandId);
    resultSyncKeyRef.current = "";
    if (cachedSavedResult && !runningRef.current) {
      applySavedResult(cachedSavedResult);
    }

    void fetchBrand(brandId)
      .then((loadedBrand) => {
        if (!mounted) return;
        setBrand(loadedBrand);
      })
      .catch(() => {});

    void fetchSavedOutreachFlowTournamentApi(brandId)
      .then((savedResult) => {
        if (!mounted || runningRef.current) return;

        const nextResult =
          savedResultUpdatedAt(cachedSavedResult) > savedResultUpdatedAt(savedResult)
            ? cachedSavedResult
            : savedResult;

        if (!nextResult) {
          persistStoredResult(null);
          return;
        }

        persistStoredResult(nextResult);
        applySavedResult(nextResult);

        if (
          cachedSavedResult &&
          nextResult === cachedSavedResult &&
          savedResultUpdatedAt(cachedSavedResult) > savedResultUpdatedAt(savedResult)
        ) {
          const syncKey = `${cachedSavedResult.brandId}:${cachedSavedResult.updatedAt}`;
          if (resultSyncKeyRef.current === syncKey) return;
          resultSyncKeyRef.current = syncKey;
          void saveOutreachFlowTournamentResultApi(brandId, {
            brief: cachedSavedResult.brief,
            result: cachedSavedResult.result,
          })
            .then((persisted) => {
              if (!mounted || !persisted || runningRef.current) return;
              persistStoredResult(persisted);
              applySavedResult(persisted);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [applySavedResult, brandId, persistStoredResult, resultStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(form));
  }, [form, storageKey]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    if (!brand) return;

    const draft = buildBrandBriefDraft(brand);
    setForm((current) => ({
      ...current,
      target: mergePrefillValue(current.target, draft.target),
      desiredOutcome: mergePrefillValue(current.desiredOutcome, draft.desiredOutcome),
      offer: mergePrefillValue(current.offer, draft.offer),
      firstValueAsset: mergePrefillValue(current.firstValueAsset, firstListItem(brand.availableAssets)),
    }));
  }, [brand]);

  const hydrateBriefFromBrand = useCallback(
    async (options?: { overwrite?: boolean; source?: "auto" | "manual" }) => {
      if (!brand) return;

      const overwrite = Boolean(options?.overwrite);
      const source = options?.source ?? "manual";
      const fallbackDraft = buildBrandBriefDraft(brand);
      const prefillKey = `${brand.id}:${normalizedBrandWebsite || "brand-profile"}`;

      if (overwrite) {
        setCustomTargetOpen(false);
        setDesiredOutcomeChoiceId("");
        setCustomDesiredOutcomeOpen(false);
      }

      if (source === "manual") {
        setPrefillFeedback({ tone: "idle", message: "" });
      }

      setForm((current) => ({
        ...current,
        target: mergePrefillValue(current.target, fallbackDraft.target, overwrite),
        desiredOutcome: mergePrefillValue(current.desiredOutcome, fallbackDraft.desiredOutcome, overwrite),
        offer: mergePrefillValue(current.offer, fallbackDraft.offer, overwrite),
        firstValueAsset: mergePrefillValue(
          current.firstValueAsset,
          firstListItem(brand.availableAssets),
          overwrite
        ),
      }));

      if (!normalizedBrandWebsite) {
        setSitePrefill(null);
        if (source === "manual") {
          setPrefillFeedback({
            tone: "error",
            message: "This brand does not have a usable website URL yet.",
          });
        }
        autoPrefillKeyRef.current = prefillKey;
        return;
      }

      setPrefillLoading(true);
      try {
        const sitePrefill = await fetchBrandIntakePrefill(normalizedBrandWebsite);
        setSitePrefill(sitePrefill);
        const draft = buildBrandBriefDraft(brand, sitePrefill);
        setForm((current) => ({
          ...current,
          target: mergePrefillValue(current.target, draft.target, overwrite),
          desiredOutcome: mergePrefillValue(current.desiredOutcome, draft.desiredOutcome, overwrite),
          offer: mergePrefillValue(current.offer, draft.offer, overwrite),
          firstValueAsset: mergePrefillValue(
            current.firstValueAsset,
            firstListItem(brand.availableAssets),
            overwrite
          ),
        }));
        setPrefillFeedback({
          tone: "success",
          message:
            source === "manual"
              ? `Brief refreshed from ${draft.hostname || brandHostname || "the brand site"}.`
              : `Brief drafted from ${draft.hostname || brandHostname || "the brand site"}.`,
        });
      } catch (err) {
        setSitePrefill(null);
        if (source === "manual") {
          setPrefillFeedback({
            tone: "error",
            message: err instanceof Error ? err.message : "Website analysis failed.",
          });
        }
      } finally {
        autoPrefillKeyRef.current = prefillKey;
        setPrefillLoading(false);
      }
    },
    [brand, brandHostname, normalizedBrandWebsite]
  );

  useEffect(() => {
    if (!brand) return;
    const prefillKey = `${brand.id}:${normalizedBrandWebsite || "brand-profile"}`;
    if (autoPrefillKeyRef.current === prefillKey) return;
    void hydrateBriefFromBrand({ source: "auto" });
  }, [brand, hydrateBriefFromBrand, normalizedBrandWebsite]);

  useEffect(() => {
    if (!baseTargetOptions.length) {
      if (form.target.trim() && !customTargetOpen) {
        setCustomTargetOpen(true);
      }
      return;
    }

    const currentTarget = form.target.trim();
    if (!currentTarget) {
      setCustomTargetOpen(false);
      setForm((current) =>
        current.target.trim()
          ? current
          : {
              ...current,
              target: baseTargetOptions[0]?.value || "",
            }
      );
      return;
    }

    if (baseTargetOptions.some((option) => option.value === currentTarget)) {
      if (customTargetOpen) setCustomTargetOpen(false);
      return;
    }

    if (!customTargetOpen) {
      setCustomTargetOpen(true);
    }
  }, [baseTargetOptions, customTargetOpen, form.target]);

  useEffect(() => {
    if (!baseFirstValueOptions.length) return;
    if (form.firstValueAsset.trim()) return;
    setForm((current) =>
      current.firstValueAsset.trim()
        ? current
        : {
            ...current,
            firstValueAsset: baseFirstValueOptions[0]?.value || "",
          }
    );
  }, [baseFirstValueOptions, form.firstValueAsset]);

  useEffect(() => {
    if (!desiredOutcomeOptions.length) return;

    if (customDesiredOutcomeOpen || desiredOutcomeChoiceId === "custom") {
      return;
    }

    if (desiredOutcomeChoiceId) {
      const selectedOption = desiredOutcomeOptions.find((option) => option.id === desiredOutcomeChoiceId);
      if (!selectedOption) return;
      if (form.desiredOutcome.trim() === selectedOption.value) return;
      setForm((current) => ({
        ...current,
        desiredOutcome: selectedOption.value,
      }));
      return;
    }

    const matchedOption = desiredOutcomeOptions.find(
      (option) => option.value === form.desiredOutcome.trim()
    );
    if (matchedOption) {
      setDesiredOutcomeChoiceId(matchedOption.id);
      return;
    }

    if (form.desiredOutcome.trim()) {
      setDesiredOutcomeChoiceId("custom");
      setCustomDesiredOutcomeOpen(true);
      return;
    }

    const fallbackOption = desiredOutcomeOptions[0];
    if (!fallbackOption) return;
    setDesiredOutcomeChoiceId(fallbackOption.id);
    setForm((current) => ({
      ...current,
      desiredOutcome: fallbackOption.value,
    }));
  }, [
    customDesiredOutcomeOpen,
    desiredOutcomeChoiceId,
    desiredOutcomeOptions,
    form.desiredOutcome,
  ]);

  const preparedInput = useMemo<OutreachFlowTournamentInput>(
    () => ({
      target: form.target.trim(),
      desiredOutcome: form.desiredOutcome.trim(),
      offer: form.offer.trim(),
      channel: form.channel.trim() || "email",
      availableAssets: form.firstValueAsset.trim() ? [form.firstValueAsset.trim()] : undefined,
    }),
    [form]
  );

  const canRun =
    Boolean(preparedInput.target.trim()) &&
    Boolean(preparedInput.desiredOutcome.trim()) &&
    !running;

  const progressCopy = progressLabel(result, running);
  const brandContextSummary = useMemo(() => {
    if (!brand) return "";
    const personaCount = brand.operablePersonas.length;
    const assetCount = brand.availableAssets.length;
    if (!personaCount && !assetCount) {
      return "The arena can still run, but adding real personas and assets in Outreach Settings makes these questions much smarter.";
    }
    return `Using ${personaCount} saved ${personaCount === 1 ? "persona" : "personas"} and ${assetCount} real ${assetCount === 1 ? "asset" : "assets"} from this brand.`;
  }, [brand]);
  const shortlisted = useMemo(
    () =>
      result?.shortlist
        .map((item) => ({
          item,
          candidate:
            result.allCandidates.find((candidate) => candidate.index === item.index) ?? null,
        }))
        .filter((entry) => entry.candidate) ?? [],
    [result]
  );

  const topCandidates = useMemo(() => result?.allCandidates.slice(0, 6) ?? [], [result]);
  const queuedCount = useMemo(
    () => streamAgents.filter((agent) => agent.status === "queued").length,
    [streamAgents]
  );
  const draftingCount = useMemo(
    () => streamAgents.filter((agent) => agent.status === "drafting").length,
    [streamAgents]
  );
  const draftedCount = useMemo(
    () => streamAgents.filter((agent) => agent.status === "drafted").length,
    [streamAgents]
  );
  const failedCount = useMemo(
    () => streamAgents.filter((agent) => agent.status === "failed").length,
    [streamAgents]
  );

  const handleStreamEvent = (event: OutreachFlowTournamentStreamEvent) => {
    if (event.type === "start") {
      setRunning(true);
      setRequestedAgents(event.requestedAgents);
      setIdeasPerAgent(event.ideasPerAgent);
      setStreamAgents(seedStreamAgents(event.requestedAgents));
      return;
    }

    if (event.type === "phase") {
      setRunning(true);
      setStreamPhase({
        phase: event.phase,
        phaseLabel: event.phaseLabel,
      });
      return;
    }

    if (
      event.type === "turn_started" ||
      event.type === "turn_completed" ||
      event.type === "turn_failed"
    ) {
      setStreamAgents((current) =>
        upsertStreamAgent(
          current.length
            ? current
            : seedStreamAgents(Math.max(requestedAgents, event.turn.order)),
          event.turn
        )
      );
      return;
    }

    if (event.type === "done") {
      setResult(event.result);
      setRunning(false);
      setStreamAgents(
        event.result.turns.map((turn) => ({
          ...turn,
          error: turn.error || "",
        }))
      );
      setError("");
      trackEvent("outreach_flow_tournament_ready", {
        brandId,
        shortlistCount: event.result.shortlist.length,
        acceptedCount: event.result.snapshot.accepted,
      });
      persistStoredResult({
        brandId,
        brief: event.brief,
        result: event.result,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (event.type === "error") {
      setRunning(false);
      setError([event.message, event.hint].filter(Boolean).join(" ") || "Failed to run outreach tournament");
    }
  };

  const runTournament = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError("");
    setRunning(true);
    setResult(null);
    setStreamPhase(null);
    setStreamAgents([]);
    setRequestedAgents(0);
    setIdeasPerAgent(0);

    try {
      await streamOutreachFlowTournamentApi(brandId, {
        ...preparedInput,
        signal: controller.signal,
        onEvent: handleStreamEvent,
      });
      trackEvent("outreach_flow_tournament_run", {
        brandId,
        target: preparedInput.target.slice(0, 120),
        desiredOutcome: preparedInput.desiredOutcome.slice(0, 120),
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setRunning(false);
      setError(err instanceof Error ? err.message : "Failed to run outreach tournament");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              Outreach-flow arena
            </p>
            <h3 className="text-base font-semibold text-[color:var(--foreground)]">
              {progressCopy.title}
            </h3>
            <p className="max-w-3xl text-sm leading-6 text-[color:var(--muted-foreground)]">
              {progressCopy.detail}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">Reply-first</Badge>
            <Badge variant="muted">Identity-led</Badge>
            <Badge variant="muted">Bridge aware</Badge>
            {result ? (
              <Badge variant="success">
                {result.snapshot.accepted} accepted / {result.snapshot.ideas} reviewed
              </Badge>
            ) : null}
          </div>
        </div>

        {running ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge variant="accent">{streamPhase?.phaseLabel || "Waiting for arena config"}</Badge>
            {requestedAgents ? (
              <Badge variant="muted">
                {draftedCount + failedCount} / {requestedAgents} agents finished drafting
              </Badge>
            ) : null}
            {draftingCount ? <Badge variant="muted">{draftingCount} drafting</Badge> : null}
            {queuedCount ? <Badge variant="muted">{queuedCount} queued</Badge> : null}
            {ideasPerAgent ? (
              <Badge variant="muted">
                {ideasPerAgent} {ideasPerAgent === 1 ? "idea" : "ideas"} per agent
              </Badge>
            ) : null}
            {failedCount ? <Badge variant="danger">{failedCount} failed</Badge> : null}
          </div>
        ) : null}
      </section>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(320px,0.88fr)_minmax(0,1.12fr)]">
        <div className="space-y-4 rounded-[22px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 md:p-5">
          <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  Guided brief
                </p>
                <h4 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                  Answer three quick questions
                </h4>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {brand ? <Badge variant="muted">{brand.name}</Badge> : null}
                {brandHostname ? <Badge variant="muted">{brandHostname}</Badge> : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!brand || prefillLoading}
                  onClick={() => {
                    void hydrateBriefFromBrand({ overwrite: true, source: "manual" });
                  }}
                >
                  <WandSparkles
                    className={`h-4 w-4 ${prefillLoading ? "motion-safe:animate-pulse" : ""}`}
                  />
                  {prefillLoading ? "Refreshing..." : "Refresh from site"}
                </Button>
              </div>
            </div>

            {prefillFeedback.message ? (
              <p className={cn("mt-3 text-xs leading-5", prefillFeedbackClass(prefillFeedback.tone))}>
                {prefillFeedback.message}
              </p>
            ) : brandHostname ? (
              <p className="mt-3 text-xs leading-5 text-[color:var(--muted-foreground)]">
                We draft the choices from the saved brand profile and {brandHostname}. You only need to write when none of the options fit.
              </p>
            ) : null}

            <div className="mt-4 grid gap-4">
              <FormField
                label="1. Who should this aim at?"
                hint="Pick the closest target. Only write your own if none fit."
              >
                <div className="space-y-3">
                  {targetOptions.length ? (
                    <div className="grid gap-2">
                      {targetOptions.map((option) => (
                        <ChoiceCard
                          key={option.id}
                          label={option.label}
                          detail={option.detail}
                          active={!customTargetOpen && form.target.trim() === option.value}
                          onClick={() => {
                            setCustomTargetOpen(false);
                            updateFormFromUser({ target: option.value });
                          }}
                        />
                      ))}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant={customTargetOpen ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        userEditedBriefRef.current = true;
                        setCustomTargetOpen(true);
                      }}
                    >
                      Use my own target
                    </Button>
                    {!customTargetOpen && form.target.trim() ? (
                      <p className="text-xs leading-5 text-[color:var(--muted-foreground)]">
                        We will send this exact target into the arena.
                      </p>
                    ) : null}
                  </div>

                  {customTargetOpen ? (
                    <Textarea
                      value={form.target}
                      onChange={(event) => updateFormFromUser({ target: event.target.value })}
                      placeholder="Content creators who actively talk about creator workflow and AI video"
                      rows={3}
                    />
                  ) : null}
                </div>
              </FormField>

              <FormField
                label="2. What should they get first?"
                hint="Choose the first real value. The arena still uses the saved brand personas behind the scenes."
              >
                {firstValueOptions.length ? (
                  <div className="grid gap-2">
                    {firstValueOptions.map((option) => (
                      <ChoiceCard
                        key={option.id}
                        label={option.label}
                        detail={option.detail}
                        active={form.firstValueAsset.trim() === option.value}
                        onClick={() => {
                          updateFormFromUser({ firstValueAsset: option.value });
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[16px] border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
                    No real first-value assets are saved on this brand yet. Add them in Outreach Settings to turn this into multiple choice.
                  </div>
                )}
              </FormField>

              <FormField
                label="3. Where should this lead?"
                hint="Pick the landing spot. Only write your own if none fit."
              >
                <div className="space-y-3">
                  <div className="grid gap-2">
                    {desiredOutcomeOptions.map((option) => {
                      const active =
                        !customDesiredOutcomeOpen && desiredOutcomeChoiceId === option.id;
                      return (
                        <ChoiceCard
                          key={option.id}
                          label={option.label}
                          detail={option.detail}
                          active={active}
                          onClick={() => {
                            setDesiredOutcomeChoiceId(option.id);
                            setCustomDesiredOutcomeOpen(false);
                            updateFormFromUser((current) => ({
                              ...current,
                              desiredOutcome: option.value,
                            }));
                          }}
                        />
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant={customDesiredOutcomeOpen ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        userEditedBriefRef.current = true;
                        setDesiredOutcomeChoiceId("custom");
                        setCustomDesiredOutcomeOpen(true);
                      }}
                    >
                      Use my own endpoint
                    </Button>
                    {!customDesiredOutcomeOpen && desiredOutcomeChoiceId && desiredOutcomeChoiceId !== "custom" ? (
                      <p className="text-xs leading-5 text-[color:var(--muted-foreground)]">
                        We keep one recommended path visible so you do not have to write this from scratch.
                      </p>
                    ) : null}
                  </div>

                  {customDesiredOutcomeOpen ? (
                    <Textarea
                      value={form.desiredOutcome}
                      onChange={(event) =>
                        updateFormFromUser({ desiredOutcome: event.target.value })
                      }
                      placeholder="Get them into an async thread that naturally makes the offer the next serious step"
                      rows={3}
                    />
                  ) : null}
                </div>
              </FormField>

              <div className="rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                  Saved brand context
                </p>
                <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                  {brandContextSummary}
                </p>
                {brand ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="muted">
                      {brand.operablePersonas.length} {brand.operablePersonas.length === 1 ? "persona" : "personas"}
                    </Badge>
                    <Badge variant="muted">
                      {brand.availableAssets.length} {brand.availableAssets.length === 1 ? "asset" : "assets"}
                    </Badge>
                    <Badge variant="muted">Offer: {form.offer.trim() || brand.product || brand.name}</Badge>
                    <Badge variant="muted">Channel: {form.channel.trim() || "email"}</Badge>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant={advancedOpen ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setAdvancedOpen((current) => !current);
                  }}
                >
                  {advancedOpen ? "Hide advanced fields" : "Show advanced fields"}
                </Button>
              </div>

              {advancedOpen ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField label="Offer">
                    <Input
                      value={form.offer}
                      onChange={(event) => updateFormFromUser({ offer: event.target.value })}
                      placeholder={brand?.product || brand?.name || "Underlying offer"}
                    />
                  </FormField>
                  <FormField label="Channel">
                    <Input
                      value={form.channel}
                      onChange={(event) => updateFormFromUser({ channel: event.target.value })}
                      placeholder="email"
                    />
                  </FormField>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="button" disabled={!canRun} onClick={runTournament}>
                <Sparkles className={`h-4 w-4 ${running ? "motion-safe:animate-pulse" : ""}`} />
                {running ? "Running arena..." : "Generate bridge options"}
              </Button>
              {running ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    controllerRef.current?.abort();
                    setRunning(false);
                    setStreamPhase(null);
                  }}
                >
                  Stop
                </Button>
              ) : result ? (
                <Button type="button" variant="outline" onClick={runTournament}>
                  <RefreshCcw className="h-4 w-4" />
                  Rerun
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-[22px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 md:p-5">
          {running ? (
            <>
              <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                      Arena board
                    </p>
                    <h4 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                      Live backend state
                    </h4>
                  </div>
                  <Badge variant="accent">Live</Badge>
                </div>

                <div className="mt-4 space-y-2">
                  {streamAgents.length ? (
                    streamAgents.map((agent) => (
                      <div
                        key={agent.agentId}
                        className={cn(
                          "rounded-[16px] border px-3 py-3 transition-[transform,background-color,border-color,box-shadow] duration-300",
                          TURN_EASE,
                          agent.status === "drafting"
                            ? "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] shadow-[0_12px_28px_-20px_color-mix(in_srgb,var(--accent)_35%,transparent)] motion-safe:-translate-y-0.5"
                            : agent.status === "failed"
                              ? "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]"
                              : "border-[color:var(--border)] bg-[color:var(--surface-muted)]"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="muted">Agent {agent.order}</Badge>
                              <Badge variant={streamAgentStatusVariant(agent)}>
                                {streamAgentStatusLabel(agent)}
                              </Badge>
                            </div>
                            <p className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">
                              {agent.agentName}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                              {agent.brief}
                            </p>
                          </div>
                          {agent.status === "drafted" ? (
                            <Badge variant="muted">
                              {agent.ideas.length} {agent.ideas.length === 1 ? "lane" : "lanes"}
                            </Badge>
                          ) : null}
                        </div>

                        {agent.status === "drafted" && agent.ideas[0] ? (
                          <div className="mt-3 rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3">
                            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                              First drafted lane
                            </p>
                            <p className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">
                              {agent.ideas[0].title}
                            </p>
                          </div>
                        ) : null}

                        {agent.status === "failed" && agent.error ? (
                          <p className="mt-3 text-sm leading-6 text-[color:var(--danger)]">
                            {agent.error}
                          </p>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[16px] border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
                      Waiting for the first arena event.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                      Runtime summary
                    </p>
                    <h4 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                      Arena phases and guardrails
                    </h4>
                  </div>
                  <Badge variant="muted">
                    {requestedAgents || 0} agents / {ideasPerAgent || 0} ideas
                  </Badge>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <DetailField
                    label="Current phase"
                    value={streamPhase?.phaseLabel || "Waiting for the first phase event"}
                  />
                  <DetailField
                    label="Drafting status"
                    value={`${draftedCount} drafted, ${draftingCount} drafting, ${queuedCount} queued${
                      failedCount ? `, ${failedCount} failed` : ""
                    }`}
                  />
                  <DetailField
                    label="Judge pressure"
                    value="If the opener feels like disguised cold outreach or the bridge looks staged, it gets cut."
                    className="border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]"
                  />
                  <DetailField
                    label="Filter rule"
                    value="The winner must survive reply pull, persona credibility, and bridge quality at the same time."
                  />
                </div>
              </div>
            </>
          ) : result ? (
            <>
              <div className="space-y-3">
                {shortlisted.map(({ item, candidate }, index) =>
                  candidate ? (
                    <article
                      key={`${item.index}:${item.title}`}
                      className="rounded-[20px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-4 shadow-[0_18px_48px_-30px_color-mix(in_srgb,var(--shadow)_55%,transparent)] md:px-5"
                    >
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="accent">Shortlist #{index + 1}</Badge>
                          <Badge variant={candidateTone(candidate)}>{candidateLabel(candidate)}</Badge>
                          {item.category ? <Badge variant="muted">{item.category}</Badge> : null}
                        </div>

                        <div className="space-y-2">
                          <h4 className="text-lg font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                            {item.title}
                          </h4>
                          <p className="text-sm leading-6 text-[color:var(--foreground)]">
                            {item.pitch}
                          </p>
                          <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                            {item.note}
                          </p>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-2">
                          {candidateArchitectureDetails(candidate).map((field) => (
                            <DetailField
                              key={`${item.index}:${field.label}`}
                              label={field.label}
                              value={field.value}
                            />
                          ))}
                        </div>

                        <div className="grid gap-3 lg:grid-cols-2">
                          {findBranch(candidate, "positive") ? (
                            <DetailField
                              label="Positive Branch"
                              value={findBranch(candidate, "positive")?.response || ""}
                            />
                          ) : null}
                          {findBranch(candidate, "skeptical") ? (
                            <DetailField
                              label="Skeptical Branch"
                              value={findBranch(candidate, "skeptical")?.response || ""}
                            />
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ) : null
                )}
              </div>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                    Manager pressure
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                    {result.pressureSummary}
                  </p>
                </div>
                <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                    Useful denial
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                    {result.strongestUsefulDenial || "No additional denial came back from the manager."}
                  </p>
                </div>
              </section>

              <section className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                      Agent board
                    </p>
                    <h4 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                      Who found useful territory
                    </h4>
                  </div>
                  <Badge variant="muted">
                    {result.snapshot.agents} agents / {result.snapshot.ideas} ideas
                  </Badge>
                </div>

                <div className="mt-4 space-y-2">
                  {result.turns.map((turn, index) => (
                    <div
                      key={`${turn.agentId}:${turn.agentName}`}
                      className="rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="muted">Agent {turn.order}</Badge>
                            <Badge variant={turnAcceptedCount(turn) > 0 ? "accent" : "muted"}>
                              {turnAcceptedCount(turn)} kept
                            </Badge>
                            {turn.status === "failed" ? (
                              <Badge variant="danger">Failed</Badge>
                            ) : null}
                          </div>
                          <p className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">
                            {turn.agentName}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                            {turn.brief}
                          </p>
                        </div>
                        {index < 3 ? (
                          <Badge variant={index === 0 ? "accent" : "muted"} className="gap-1">
                            <Trophy className="h-3.5 w-3.5" />
                            #{index + 1}
                          </Badge>
                        ) : null}
                      </div>

                      {turn.status === "failed" && turn.error ? (
                        <div className="mt-3 rounded-[14px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-3 py-3">
                          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--danger)]">
                            Failure
                          </p>
                          <p className="mt-2 text-sm leading-6 text-[color:var(--danger)]">
                            {turn.error}
                          </p>
                        </div>
                      ) : null}

                      {turn.ideas[0] ? (
                        <div className="mt-3 rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3">
                          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                            Lead lane
                          </p>
                          <p className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">
                            {turn.ideas[0].title}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-[color:var(--foreground)]">
                            {turn.ideas[0].openerBody}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                      Candidate board
                    </p>
                    <h4 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                      All scored lanes
                    </h4>
                  </div>
                  <Badge variant="muted">Top {topCandidates.length}</Badge>
                </div>

                <div className="mt-4 space-y-3">
                  {topCandidates.map((candidate) => (
                    <article
                      key={`${candidate.index}:${candidate.title}`}
                      className="rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={candidateTone(candidate)}>{candidateLabel(candidate)}</Badge>
                        <Badge variant="muted">Reply {candidate.replyLikelihood}%</Badge>
                        <Badge variant="muted">Credibility {candidate.personaCredibility}%</Badge>
                        <Badge variant="muted">Bridge {candidate.bridgeQuality}%</Badge>
                        <Badge variant="muted">Risk {candidate.suspicionRisk}%</Badge>
                      </div>
                      <h5 className="mt-3 text-base font-semibold text-[color:var(--foreground)]">
                        {candidate.title}
                      </h5>
                      <p className="mt-1 text-sm leading-6 text-[color:var(--foreground)]">
                        {candidate.summary || candidate.rationale}
                      </p>
                      {candidate.risks[0] ? (
                        <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
                          Main pushback: {candidate.risks[0]}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  What this tab does
                </p>
                <div className="mt-3 space-y-3 text-sm leading-6 text-[color:var(--foreground)]">
                  <p>
                    It does not write a cold email first. It chooses the opening environment first,
                    then pressure-tests whether that environment can survive a skeptical reply and
                    still bridge to the real offer.
                  </p>
                  <p>
                    The winners usually come from editorial, research, roundtable, or collaboration
                    frames that your team can actually support with real personas and assets.
                  </p>
                </div>
              </div>

              <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  Automatic setup
                </p>
                <div className="mt-3 space-y-3 text-sm leading-6 text-[color:var(--foreground)]">
                  <p>
                    The arena decides personas, assets, constraints, scoring rules, agent count,
                    and CTA timing by itself for each run.
                  </p>
                  {brand ? (
                    <p className="text-[color:var(--muted-foreground)]">
                      Brand context loaded from <span className="font-medium text-[color:var(--foreground)]">{brand.name}</span>.
                      Target, destination, and offer are seeded from the saved brand profile and
                      site when available.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
