"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ImportState =
  | {
      status: "idle";
      message: string;
      parseErrors: string[];
    }
  | {
      status: "importing";
      message: string;
      parseErrors: string[];
    }
  | {
      status: "success";
      message: string;
      parseErrors: string[];
      importedCount: number;
      skippedCount: number;
      matchedCount: number;
      attemptedCount: number;
      runId: string;
    }
  | {
      status: "error";
      message: string;
      parseErrors: string[];
    };

type LiveProspectTableEmbedProps = {
  initPath: string;
  importPath: string;
  onImported?: (result: {
    runId: string;
    importedCount: number;
    skippedCount: number;
    matchedCount: number;
    attemptedCount: number;
    parseErrors: string[];
  }) => void | Promise<void>;
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function coerceRows(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<Record<string, string>>;

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    return [
      Object.fromEntries(
        Object.entries(entry as Record<string, unknown>).map(([key, cell]) => [
          String(key),
          String(cell ?? ""),
        ])
      ),
    ];
  });
}

function statusBadge(state: ImportState) {
  if (state.status === "success") return <Badge variant="success">Added</Badge>;
  if (state.status === "error") return <Badge variant="accent">Needs attention</Badge>;
  if (state.status === "importing") return <Badge variant="accent">Adding leads</Badge>;
  return <Badge variant="muted">Live</Badge>;
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(
      data?.error ?? data?.message ?? "Request failed."
    ).trim();
    throw new Error(message || "Request failed.");
  }
  return data as Record<string, unknown>;
}

export default function LiveProspectTableEmbed({
  initPath,
  importPath,
  onImported,
}: LiveProspectTableEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const importBusyRef = useRef(false);
  const [iframeSrc, setIframeSrc] = useState("");
  const [iframeOrigin, setIframeOrigin] = useState("");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeError, setIframeError] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [tablePath, setTablePath] = useState("");
  const [importState, setImportState] = useState<ImportState>({
    status: "idle",
    message: "This table keeps collecting matching prospects over time.",
    parseErrors: [],
  });

  useEffect(() => {
    let canceled = false;
    setLoadingConfig(true);
    setIframeError("");
    setIframeLoaded(false);

    void fetch(initPath, { cache: "no-store" })
      .then((response) => readJson(response))
      .then((payload) => {
        if (canceled) return;
        const appUrl = String(payload.appUrl ?? "").trim().replace(/\/+$/, "");
        const tableId = String(payload.tableId ?? "").trim();
        if (!appUrl || !tableId) {
          throw new Error("Prospect table is missing app URL or table ID.");
        }
        const embedUrl = new URL(`${appUrl}/tables/${encodeURIComponent(tableId)}`);
        embedUrl.searchParams.set("embed", "1");
        embedUrl.searchParams.set("parentOrigin", window.location.origin);
        embedUrl.searchParams.set("parentLabel", "lastb2b");
        setIframeSrc(embedUrl.toString());
        setIframeOrigin(embedUrl.origin);
        setTablePath(`${appUrl}/tables/${encodeURIComponent(tableId)}`);
      })
      .catch((error) => {
        if (canceled) return;
        setIframeError(error instanceof Error ? error.message : "Failed to prepare prospect table.");
      })
      .finally(() => {
        if (!canceled) setLoadingConfig(false);
      });

    return () => {
      canceled = true;
    };
  }, [initPath]);

  useEffect(() => {
    if (!iframeOrigin) return;

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== iframeOrigin) {
        return;
      }

      const data = asObject(event.data);
      if (String(data.type ?? "") !== "enrichanything:import-table") {
        return;
      }

      const requestId = String(data.requestId ?? "").trim();
      const payload = asObject(data.payload);
      const rows = coerceRows(payload.rows);

      const postResult = (response: Record<string, unknown>) => {
        iframeRef.current?.contentWindow?.postMessage(response, iframeOrigin);
      };

      if (!requestId) {
        postResult({
          type: "lastb2b:import-result",
          ok: false,
          error: "Missing request id.",
        });
        return;
      }

      if (importBusyRef.current) {
        postResult({
          type: "lastb2b:import-result",
          requestId,
          ok: false,
          error: "An import is already in progress.",
        });
        return;
      }

      if (!rows.length) {
        setImportState({
          status: "error",
          message: "No leads were sent from the prospect table.",
          parseErrors: [],
        });
        postResult({
          type: "lastb2b:import-result",
          requestId,
          ok: false,
          error: "No rows were sent from the prospect table.",
        });
        return;
      }

      importBusyRef.current = true;
      setImportState({
        status: "importing",
        message: `Adding ${rows.length} lead${rows.length === 1 ? "" : "s"}...`,
        parseErrors: [],
      });

      try {
        const response = await fetch(importPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tableTitle: String(payload.tableTitle ?? ""),
            prompt: String(payload.prompt ?? ""),
            entityType: String(payload.entityType ?? ""),
            entityColumn: String(payload.entityColumn ?? ""),
            rows,
          }),
        });
        const result = await readJson(response);
        const importedCount = Number(result.importedCount ?? 0);
        const skippedCount = Number(result.skippedCount ?? 0);
        const matchedCount = Number(result.matchedCount ?? 0);
        const attemptedCount = Number(result.attemptedCount ?? 0);
        const runId = String(result.runId ?? "").trim();
        const parseErrors = Array.isArray(result.parseErrors)
          ? result.parseErrors.map((value) => String(value ?? ""))
          : [];
        const message =
          importedCount > 0
            ? `Added ${importedCount} lead${importedCount === 1 ? "" : "s"}.`
            : "No leads were added from the prospect table.";

        setImportState({
          status: "success",
          message,
          parseErrors: parseErrors.slice(0, 5),
          importedCount,
          skippedCount,
          matchedCount,
          attemptedCount,
          runId,
        });

        postResult({
          type: "lastb2b:import-result",
          requestId,
          ok: true,
          importedCount,
          skippedCount,
          matchedCount,
          attemptedCount,
          runId,
          message,
        });

        Promise.resolve(
          onImported?.({
            runId,
            importedCount,
            skippedCount,
            matchedCount,
            attemptedCount,
            parseErrors,
          })
        ).catch(() => undefined);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to import leads from the prospect table.";
        setImportState({
          status: "error",
          message,
          parseErrors: [],
        });
        postResult({
          type: "lastb2b:import-result",
          requestId,
          ok: false,
          error: message,
        });
      } finally {
        importBusyRef.current = false;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [iframeOrigin, importPath, onImported]);

  const summaryLine = useMemo(() => {
    if (importState.status !== "success") return null;
    return `${importState.attemptedCount} checked · ${importState.matchedCount} matched · ${importState.skippedCount} skipped`;
  }, [importState]);

  if (loadingConfig) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
        <div className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing live prospect table...
        </div>
      </div>
    );
  }

  if (iframeError) {
    return (
      <div className="rounded-xl border border-[color:var(--danger)]/40 bg-[color:var(--danger-soft)] p-4 text-sm text-[color:var(--danger)]">
        {iframeError}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-[color:var(--foreground)]">Live prospect table</div>
          <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
            This is the same EnrichAnything table, embedded here and kept live over time.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statusBadge(importState)}
          {tablePath ? (
            <Button type="button" variant="ghost" asChild>
              <a href={tablePath} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open full table
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
        {importState.message}
        {summaryLine ? <span className="ml-2 text-[color:var(--foreground)]">{summaryLine}</span> : null}
      </div>

      {importState.parseErrors.length ? (
        <div className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] px-3 py-2 text-xs text-[color:var(--warning)]">
          {importState.parseErrors.slice(0, 5).join(" · ")}
        </div>
      ) : null}

      <div className="relative overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]">
        {!iframeLoaded ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[color:var(--surface)]/90">
            <div className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading table...
            </div>
          </div>
        ) : null}
        <iframe
          ref={iframeRef}
          title="Live prospect table"
          src={iframeSrc}
          className="h-[720px] w-full bg-transparent"
          onLoad={() => setIframeLoaded(true)}
        />
      </div>

      {importState.status === "success" ? (
        <div className="inline-flex items-center gap-2 text-xs text-[color:var(--success)]">
          <CheckCircle2 className="h-3.5 w-3.5" />
          New rows can be added into this workflow directly from the table.
        </div>
      ) : null}
    </div>
  );
}
