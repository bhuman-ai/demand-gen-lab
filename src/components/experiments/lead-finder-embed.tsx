"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { importExperimentProspectSelectionApi } from "@/lib/client-api";
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

type LeadFinderEmbedProps = {
  brandId: string;
  experimentId: string;
  enrichAnythingAppUrl: string;
  layout?: "inline" | "page";
  showBackLink?: boolean;
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

function extractOrigin(value: string) {
  try {
    return value ? new URL(value).origin : "";
  } catch {
    return "";
  }
}

function buildStudioUrl(baseUrl: string, parentOrigin: string) {
  if (!baseUrl) return "";

  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = `${pathname || ""}/tables/new`;
  url.searchParams.set("embed", "1");
  url.searchParams.set("parentOrigin", parentOrigin);
  url.searchParams.set("parentLabel", "lastb2b");
  return url.toString();
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
  return <Badge variant="muted">Ready</Badge>;
}

export default function LeadFinderEmbed({
  brandId,
  experimentId,
  enrichAnythingAppUrl,
  layout = "inline",
  showBackLink = false,
  onImported,
}: LeadFinderEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const importBusyRef = useRef(false);
  const isPage = layout === "page";
  const [iframeSrc, setIframeSrc] = useState("");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeError, setIframeError] = useState("");
  const [importState, setImportState] = useState<ImportState>({
    status: "idle",
    message: "Type who you want, press Search, then click Add leads.",
    parseErrors: [],
  });

  useEffect(() => {
    if (!enrichAnythingAppUrl) {
      setIframeError(
        "Set ENRICHANYTHING_APP_URL or NEXT_PUBLIC_ENRICHANYTHING_APP_URL to the running EnrichAnything app."
      );
      return;
    }

    try {
      setIframeLoaded(false);
      setIframeSrc(buildStudioUrl(enrichAnythingAppUrl, window.location.origin));
      setIframeError("");
    } catch {
      setIframeError("The EnrichAnything app URL is invalid.");
    }
  }, [enrichAnythingAppUrl]);

  useEffect(() => {
    const allowedOrigin = extractOrigin(enrichAnythingAppUrl);
    if (!allowedOrigin) {
      return;
    }

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== allowedOrigin) {
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
        iframeRef.current?.contentWindow?.postMessage(response, allowedOrigin);
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
          message: "No leads were sent from the finder.",
          parseErrors: [],
        });
        postResult({
          type: "lastb2b:import-result",
          requestId,
          ok: false,
          error: "No rows were sent from the finder.",
        });
        return;
      }

      importBusyRef.current = true;
      setImportState({
        status: "importing",
        message: `Adding ${rows.length} lead${rows.length === 1 ? "" : "s"} to this experiment...`,
        parseErrors: [],
      });

      try {
        const result = await importExperimentProspectSelectionApi(brandId, experimentId, {
          tableTitle: String(payload.tableTitle ?? ""),
          prompt: String(payload.prompt ?? ""),
          entityType: String(payload.entityType ?? ""),
          entityColumn: String(payload.entityColumn ?? ""),
          rows,
        });

        const summary =
          result.importedCount > 0
            ? `Added ${result.importedCount} lead${result.importedCount === 1 ? "" : "s"} to this experiment.`
            : "No leads were added from the finder.";

        setImportState({
          status: "success",
          message: summary,
          parseErrors: result.parseErrors.slice(0, 5),
          importedCount: result.importedCount,
          skippedCount: result.skippedCount,
          matchedCount: result.matchedCount,
          attemptedCount: result.attemptedCount,
          runId: result.runId,
        });

        postResult({
          type: "lastb2b:import-result",
          requestId,
          ok: true,
          importedCount: result.importedCount,
          skippedCount: result.skippedCount,
          matchedCount: result.matchedCount,
          attemptedCount: result.attemptedCount,
          runId: result.runId,
          message: summary,
        });

        Promise.resolve(
          onImported?.({
            runId: result.runId,
            importedCount: result.importedCount,
            skippedCount: result.skippedCount,
            matchedCount: result.matchedCount,
            attemptedCount: result.attemptedCount,
            parseErrors: result.parseErrors,
          })
        ).catch(() => undefined);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to import leads from the finder.";
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
    return () => window.removeEventListener("message", handleMessage);
  }, [brandId, enrichAnythingAppUrl, experimentId, onImported]);

  const wrapperClassName = isPage
    ? "mx-auto flex min-h-[calc(100vh-5rem)] max-w-[1560px] flex-col gap-4 px-4 py-5 md:px-6"
    : "space-y-3";
  const frameMinHeight = isPage ? "min-h-[720px]" : "min-h-[640px]";
  const frameHeight = isPage ? "h-[calc(100vh-12rem)]" : "h-[640px]";

  return (
    <div className={wrapperClassName}>
      {showBackLink ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="outline">
            <Link href={`/brands/${brandId}/experiments/${experimentId}/prospects`}>
              <ArrowLeft className="h-4 w-4" />
              Back to prospects
            </Link>
          </Button>
          <div className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
            {statusBadge(importState)}
            <span>Search here and add leads without leaving the experiment.</span>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3">
          <div>
            <div className="text-sm font-medium text-[color:var(--foreground)]">Find leads</div>
            <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
              Describe who you want, check the list, then click <span className="font-medium">Add leads</span>.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(importState)}
            {enrichAnythingAppUrl ? (
              <Button asChild size="sm" variant="ghost">
                <a href={enrichAnythingAppUrl} target="_blank" rel="noreferrer">
                  Open standalone
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            ) : null}
          </div>
        </div>

        {iframeError ? (
          <div className={`flex ${frameMinHeight} items-center justify-center p-6`}>
            <div className="max-w-lg rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-5 py-4 text-sm text-[color:var(--foreground)]">
              {iframeError}
            </div>
          </div>
        ) : iframeSrc ? (
          <div className={`relative ${frameMinHeight} bg-white`}>
            {!iframeLoaded ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--surface)]">
                <div className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading lead finder...
                </div>
              </div>
            ) : null}
            <iframe
              ref={iframeRef}
              title="Embedded lead finder"
              src={iframeSrc}
              onLoad={() => setIframeLoaded(true)}
              className={`${frameHeight} ${frameMinHeight} w-full border-0 bg-white`}
            />
          </div>
        ) : (
          <div className={`flex ${frameMinHeight} items-center justify-center text-sm text-[color:var(--muted-foreground)]`}>
            Preparing lead finder...
          </div>
        )}

        <div className="border-t border-[color:var(--border)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-[color:var(--foreground)]">
            {importState.status === "success" ? <CheckCircle2 className="h-4 w-4" /> : null}
            <span>{importState.message}</span>
          </div>

          {"attemptedCount" in importState ? (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge variant="muted">Tried: {importState.attemptedCount}</Badge>
              <Badge variant="success">Added: {importState.importedCount}</Badge>
              <Badge variant="muted">Verified: {importState.matchedCount}</Badge>
              <Badge variant="muted">Skipped: {importState.skippedCount}</Badge>
            </div>
          ) : null}

          {importState.parseErrors.length ? (
            <div className="mt-3 rounded-md border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] px-3 py-2 text-xs text-[color:var(--warning)]">
              {importState.parseErrors.join(" · ")}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
