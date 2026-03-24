"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  PageIntro,
  SectionPanel,
  StatLedger,
  TableHeaderCell,
  TableShell,
} from "@/components/ui/page-layout";
import type { BrandRecord, InboxEvalRun, InboxEvalScenario } from "@/lib/factory-types";
import { fetchInboxEvalLab, fetchInboxEvalRun, runInboxEval } from "@/lib/client-api";

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function verdictBadge(run: InboxEvalRun | null) {
  const verdict = run?.scorecard?.verdict ?? "";
  if (verdict === "pass") return "success" as const;
  if (verdict === "fail") return "danger" as const;
  return "muted" as const;
}

export default function InboxEvalLabClient({ brand }: { brand: BrandRecord }) {
  const [scenarios, setScenarios] = useState<InboxEvalScenario[]>([]);
  const [runs, setRuns] = useState<InboxEvalRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedRun, setSelectedRun] = useState<InboxEvalRun | null>(null);
  const [runningScenarioId, setRunningScenarioId] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = async (nextSelectedRunId?: string) => {
    const data = await fetchInboxEvalLab(brand.id);
    setScenarios(data.scenarios);
    setRuns(data.runs);
    const targetRunId =
      nextSelectedRunId ||
      (selectedRunId && data.runs.some((item) => item.id === selectedRunId)
        ? selectedRunId
        : data.runs[0]?.id ?? "");
    setSelectedRunId(targetRunId);
    if (targetRunId) {
      const detail = await fetchInboxEvalRun(brand.id, targetRunId);
      setSelectedRun(detail);
    } else {
      setSelectedRun(null);
    }
  };

  useEffect(() => {
    let mounted = true;
    void fetchInboxEvalLab(brand.id)
      .then((data) => {
        if (!mounted) return;
        setScenarios(data.scenarios);
        setRuns(data.runs);
        if (data.runs[0]) {
          setSelectedRunId(data.runs[0].id);
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load inbox eval lab");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [brand.id]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null);
      return;
    }
    let mounted = true;
    setDetailLoading(true);
    void fetchInboxEvalRun(brand.id, selectedRunId)
      .then((run) => {
        if (!mounted) return;
        setSelectedRun(run);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load eval run");
      })
      .finally(() => {
        if (mounted) setDetailLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [brand.id, selectedRunId]);

  const stats = useMemo(() => {
    const completed = runs.filter((run) => run.status === "completed");
    const passed = completed.filter((run) => run.scorecard?.verdict === "pass");
    const failed = completed.filter((run) => run.scorecard?.verdict === "fail");
    const avgOverall =
      completed.length > 0
        ? completed.reduce((sum, run) => sum + (run.scorecard?.overall ?? 0), 0) / completed.length
        : 0;
    return { completed, passed, failed, avgOverall };
  }, [runs]);

  return (
    <div className="space-y-8">
      <PageIntro
        title="Inbox Eval Lab"
        description="Run replayable roleplay scenarios against the inbox manager, then inspect transcripts, scorecards, and failure patterns."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/brands/${brand.id}/inbox`}>Back to Inbox</Link>
            </Button>
            <Button asChild>
              <Link href={`/brands/${brand.id}/campaigns`}>Go to Campaigns</Link>
            </Button>
          </>
        }
        aside={
          <StatLedger
            items={[
              { label: "Scenarios", value: scenarios.length, detail: "Starter replayable inbox-manager probes." },
              { label: "Completed", value: stats.completed.length, detail: "Finished eval runs for this brand." },
              { label: "Pass", value: stats.passed.length, detail: "Runs with strong safety and strategy handling." },
              { label: "Avg Score", value: formatPercent(stats.avgOverall), detail: "Average overall score across completed runs." },
            ]}
          />
        }
      />

      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading eval lab...</div> : null}
      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      {!loading && !scenarios.length ? (
        <EmptyState
          title="No eval scenarios loaded."
          description="The inbox eval lab expects a built-in scenario library. If this persists, the deployment is missing scenario definitions."
        />
      ) : null}

      <SectionPanel
        title="Scenario Library"
        description="These scenarios drive deterministic roleplay and end-of-run scoring. Start with the normal cases, then move into curveballs and adversarial probes."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {scenarios.map((scenario) => (
            <div
              key={scenario.id}
              className="rounded-[10px] border border-[color:var(--border)] px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">
                    {scenario.name}
                  </div>
                  <div className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                    {scenario.description}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="muted">{formatLabel(scenario.category)}</Badge>
                    <Badge variant="muted">{formatLabel(scenario.difficulty)}</Badge>
                    <Badge variant="muted">{scenario.roleplayRules.maxTurns} turns</Badge>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={runningScenarioId === scenario.id}
                  onClick={async () => {
                    setRunningScenarioId(scenario.id);
                    setError("");
                    try {
                      const run = await runInboxEval(brand.id, scenario.id);
                      await refresh(run.id);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to run inbox eval");
                    } finally {
                      setRunningScenarioId("");
                    }
                  }}
                >
                  {runningScenarioId === scenario.id ? "Running..." : "Run Scenario"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SectionPanel>

      <SectionPanel title="Recent Runs" description="Select a run to inspect the score breakdown and transcript.">
        <TableShell>
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <TableHeaderCell>Scenario</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Verdict</TableHeaderCell>
                <TableHeaderCell>Overall</TableHeaderCell>
                <TableHeaderCell>Completed</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className={`border-t border-[color:var(--border)] ${
                    selectedRunId === run.id ? "bg-[color:var(--surface-muted)]" : "hover:bg-[color:var(--surface-muted)]"
                  }`}
                >
                  <td className="py-2">
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <div className="font-medium text-[color:var(--foreground)]">{run.scenarioName}</div>
                      <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{run.scenarioId}</div>
                    </button>
                  </td>
                  <td className="py-2">
                    <Badge variant={run.status === "failed" ? "danger" : run.status === "completed" ? "success" : "muted"}>
                      {formatLabel(run.status)}
                    </Badge>
                  </td>
                  <td className="py-2">
                    {run.scorecard ? (
                      <Badge variant={verdictBadge(run)}>{formatLabel(run.scorecard.verdict)}</Badge>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="py-2">{run.scorecard ? formatPercent(run.scorecard.overall) : "-"}</td>
                  <td className="py-2">{formatDateTime(run.completedAt || run.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
        {!runs.length ? (
          <div className="pt-4 text-sm text-[color:var(--muted-foreground)]">
            No runs yet. Launch a scenario to create the first replay.
          </div>
        ) : null}
      </SectionPanel>

      <SectionPanel
        title="Run Detail"
        description={
          selectedRun
            ? "Score breakdown and transcript for the selected run."
            : "Select a run to inspect it."
        }
      >
        {!selectedRun ? (
          <div className="text-sm text-[color:var(--muted-foreground)]">Select a run to inspect it.</div>
        ) : detailLoading ? (
          <div className="text-sm text-[color:var(--muted-foreground)]">Loading run detail...</div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="text-lg font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
                    {selectedRun.scenarioName}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="muted">{selectedRun.scenario.category}</Badge>
                    <Badge variant="muted">{selectedRun.scenario.difficulty}</Badge>
                    <Badge variant={selectedRun.status === "failed" ? "danger" : selectedRun.status === "completed" ? "success" : "muted"}>
                      {formatLabel(selectedRun.status)}
                    </Badge>
                    {selectedRun.scorecard ? (
                      <Badge variant={verdictBadge(selectedRun)}>{formatLabel(selectedRun.scorecard.verdict)}</Badge>
                    ) : null}
                  </div>
                </div>
                <div className="text-right text-sm text-[color:var(--muted-foreground)]">
                  <div>Started {formatDateTime(selectedRun.startedAt)}</div>
                  <div className="mt-1">Completed {formatDateTime(selectedRun.completedAt || selectedRun.updatedAt)}</div>
                </div>
              </div>
              {selectedRun.scorecard ? (
                <div className="mt-4 grid gap-px overflow-hidden rounded-[10px] border border-[color:var(--border)] bg-[color:var(--border)] md:grid-cols-5">
                  <div className="bg-[color:var(--surface)] px-3 py-3">
                    <div className="text-[11px] text-[color:var(--muted-foreground)]">Overall</div>
                    <div className="mt-1 text-lg font-semibold text-[color:var(--foreground)]">{formatPercent(selectedRun.scorecard.overall)}</div>
                  </div>
                  <div className="bg-[color:var(--surface)] px-3 py-3">
                    <div className="text-[11px] text-[color:var(--muted-foreground)]">Safety</div>
                    <div className="mt-1 text-lg font-semibold text-[color:var(--foreground)]">{formatPercent(selectedRun.scorecard.safety.score)}</div>
                  </div>
                  <div className="bg-[color:var(--surface)] px-3 py-3">
                    <div className="text-[11px] text-[color:var(--muted-foreground)]">Strategy</div>
                    <div className="mt-1 text-lg font-semibold text-[color:var(--foreground)]">{formatPercent(selectedRun.scorecard.strategy.score)}</div>
                  </div>
                  <div className="bg-[color:var(--surface)] px-3 py-3">
                    <div className="text-[11px] text-[color:var(--muted-foreground)]">State</div>
                    <div className="mt-1 text-lg font-semibold text-[color:var(--foreground)]">{formatPercent(selectedRun.scorecard.state.score)}</div>
                  </div>
                  <div className="bg-[color:var(--surface)] px-3 py-3">
                    <div className="text-[11px] text-[color:var(--muted-foreground)]">Outcome</div>
                    <div className="mt-1 text-lg font-semibold text-[color:var(--foreground)]">{formatPercent(selectedRun.scorecard.outcome.score)}</div>
                  </div>
                </div>
              ) : null}
              {selectedRun.scorecard?.summary ? (
                <div className="mt-4 text-sm leading-6 text-[color:var(--foreground)]">
                  {selectedRun.scorecard.summary}
                </div>
              ) : null}
              {selectedRun.lastError ? (
                <div className="mt-4 text-sm text-[color:var(--danger)]">{selectedRun.lastError}</div>
              ) : null}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[10px] border border-[color:var(--border)] px-4 py-4">
                <div className="text-sm font-semibold text-[color:var(--foreground)]">Failure Lens</div>
                <div className="mt-3 space-y-3 text-sm">
                  <div>
                    <div className="text-[11px] text-[color:var(--muted-foreground)]">Failure Type</div>
                    <div className="mt-1 text-[color:var(--foreground)]">
                      {selectedRun.scorecard ? formatLabel(selectedRun.scorecard.failureType) : "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[color:var(--muted-foreground)]">Safety Notes</div>
                    <div className="mt-1 space-y-2">
                      {(selectedRun.scorecard?.safety.notes ?? []).length ? (
                        (selectedRun.scorecard?.safety.notes ?? []).map((item) => (
                          <div key={item} className="rounded-[8px] border border-[color:var(--border)] px-3 py-2 text-[color:var(--foreground)]">
                            {item}
                          </div>
                        ))
                      ) : (
                        <div className="text-[color:var(--muted-foreground)]">No safety notes.</div>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[color:var(--muted-foreground)]">Strategy Notes</div>
                    <div className="mt-1 space-y-2">
                      {(selectedRun.scorecard?.strategy.notes ?? []).length ? (
                        (selectedRun.scorecard?.strategy.notes ?? []).map((item) => (
                          <div key={item} className="rounded-[8px] border border-[color:var(--border)] px-3 py-2 text-[color:var(--foreground)]">
                            {item}
                          </div>
                        ))
                      ) : (
                        <div className="text-[color:var(--muted-foreground)]">No strategy notes.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[10px] border border-[color:var(--border)] px-4 py-4">
                <div className="text-sm font-semibold text-[color:var(--foreground)]">Transcript</div>
                <div className="mt-3 space-y-3">
                  {selectedRun.transcript.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={item.actor === "persona" ? "accent" : item.actor === "manager" ? "muted" : "default"}>
                            {item.actor}
                          </Badge>
                          <div className="text-xs text-[color:var(--muted-foreground)]">Turn {item.turn}</div>
                        </div>
                        <div className="text-xs text-[color:var(--muted-foreground)]">{formatDateTime(item.at)}</div>
                      </div>
                      {item.subject ? (
                        <div className="mt-2 text-sm font-medium text-[color:var(--foreground)]">{item.subject}</div>
                      ) : null}
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[color:var(--foreground)]">
                        {item.body}
                      </div>
                      {item.decision ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="muted">{formatLabel(item.decision.recommendedMove)}</Badge>
                          {item.stateSummary ? (
                            <Badge variant="muted">{formatLabel(item.stateSummary.currentStage)}</Badge>
                          ) : null}
                          <Badge variant="muted">{formatPercent(item.decision.confidence)}</Badge>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </SectionPanel>
    </div>
  );
}
