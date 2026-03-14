"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EMBED_READY_MESSAGE_TYPE = "enrichanything:embed-ready";
const EMBED_STATE_MESSAGE_TYPE = "enrichanything:embed-state";
const EMBED_IMPORT_MESSAGE_TYPE = "enrichanything:import-table";
const EMBED_HOST_INIT_MESSAGE_TYPE = "lastb2b:embed-init";
const EMBED_HOST_COMMAND_MESSAGE_TYPE = "lastb2b:embed-command";

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

type TableTab = "search" | "columns" | "row";

type EmbeddedTableState = {
  title: string;
  prompt: string;
  rowCount: number;
  columnCount: number;
  hasRows: boolean;
  hasColumns: boolean;
  liveEnabled: boolean;
  isDiscovering: boolean;
  isEnriching: boolean;
  isLiveRunning: boolean;
  activeTab: TableTab;
  lastSuccessAt: string;
  nextRunAt: string;
  lastRowsAppended: number;
  statusMessage: string;
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

function readThemeToken(
  styles: CSSStyleDeclaration,
  key: string,
  fallback: string
) {
  const value = styles.getPropertyValue(key).trim();
  return value || fallback;
}

function readHostThemeTokens() {
  if (typeof window === "undefined") {
    return {};
  }

  const rootStyles = window.getComputedStyle(document.documentElement);
  const bodyStyles = window.getComputedStyle(document.body);

  return {
    "--app-bg": "transparent",
    "--panel": readThemeToken(rootStyles, "--surface", "#11161c"),
    "--panel-alt": readThemeToken(rootStyles, "--surface-muted", "#171d24"),
    "--line": readThemeToken(rootStyles, "--border", "rgba(255, 255, 255, 0.08)"),
    "--line-strong": readThemeToken(rootStyles, "--border", "rgba(255, 255, 255, 0.12)"),
    "--text": readThemeToken(rootStyles, "--foreground", "#f4f7fb"),
    "--muted": readThemeToken(rootStyles, "--muted-foreground", "#94a0b3"),
    "--blue": readThemeToken(rootStyles, "--accent", "#d6dfef"),
    "--blue-strong": readThemeToken(rootStyles, "--accent", "#edf3ff"),
    "--green": readThemeToken(rootStyles, "--success", "#7ed0a6"),
    "--green-bg": readThemeToken(rootStyles, "--success-soft", "rgba(88, 153, 116, 0.18)"),
    "--sans": bodyStyles.fontFamily || '"IBM Plex Sans", "Avenir Next", sans-serif',
    "--shadow": "none",
  };
}

function normalizeTableState(value: unknown): EmbeddedTableState {
  const payload = asObject(value);
  const activeTab = String(payload.activeTab ?? "").trim();

  return {
    title: String(payload.title ?? "").trim(),
    prompt: String(payload.prompt ?? "").trim(),
    rowCount: Number(payload.rowCount ?? 0) || 0,
    columnCount: Number(payload.columnCount ?? 0) || 0,
    hasRows: Boolean(payload.hasRows),
    hasColumns: Boolean(payload.hasColumns),
    liveEnabled: Boolean(payload.liveEnabled),
    isDiscovering: Boolean(payload.isDiscovering),
    isEnriching: Boolean(payload.isEnriching),
    isLiveRunning: Boolean(payload.isLiveRunning),
    activeTab: activeTab === "columns" || activeTab === "row" ? activeTab : "search",
    lastSuccessAt: String(payload.lastSuccessAt ?? "").trim(),
    nextRunAt: String(payload.nextRunAt ?? "").trim(),
    lastRowsAppended: Number(payload.lastRowsAppended ?? 0) || 0,
    statusMessage: String(payload.statusMessage ?? "").trim(),
  };
}

function formatTimestamp(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data?.error ?? data?.message ?? "Request failed.").trim();
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
  const [iframeReady, setIframeReady] = useState(false);
  const [iframeError, setIframeError] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [promptDraft, setPromptDraft] = useState("");
  const [tableState, setTableState] = useState<EmbeddedTableState>({
    title: "",
    prompt: "",
    rowCount: 0,
    columnCount: 0,
    hasRows: false,
    hasColumns: false,
    liveEnabled: false,
    isDiscovering: false,
    isEnriching: false,
    isLiveRunning: false,
    activeTab: "search",
    lastSuccessAt: "",
    nextRunAt: "",
    lastRowsAppended: 0,
    statusMessage: "",
  });
  const [importState, setImportState] = useState<ImportState>({
    status: "idle",
    message: "Rows added here can be sent straight into this workflow.",
    parseErrors: [],
  });

  const postToEmbed = (message: Record<string, unknown>) => {
    if (!iframeRef.current?.contentWindow || !iframeOrigin) {
      return;
    }

    iframeRef.current.contentWindow.postMessage(message, iframeOrigin);
  };

  const sendHostInit = () => {
    postToEmbed({
      type: EMBED_HOST_INIT_MESSAGE_TYPE,
      theme: readHostThemeTokens(),
    });
  };

  const sendHostCommand = (command: string, payload: Record<string, unknown> = {}) => {
    postToEmbed({
      type: EMBED_HOST_COMMAND_MESSAGE_TYPE,
      command,
      payload,
    });
  };

  useEffect(() => {
    let canceled = false;
    setLoadingConfig(true);
    setIframeError("");
    setIframeLoaded(false);
    setIframeReady(false);

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
        embedUrl.searchParams.set("embedShell", "surface");
        embedUrl.searchParams.set("parentOrigin", window.location.origin);
        embedUrl.searchParams.set("parentLabel", "lastb2b");
        setIframeSrc(embedUrl.toString());
        setIframeOrigin(embedUrl.origin);
        setTableState((current) => ({
          ...current,
          title: String(payload.tableTitle ?? current.title ?? "").trim(),
          prompt: String(payload.discoveryPrompt ?? current.prompt ?? "").trim(),
        }));
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
    setPromptDraft(tableState.prompt);
  }, [tableState.prompt]);

  useEffect(() => {
    if (!iframeOrigin) return;

    const postToEmbedFromEffect = (message: Record<string, unknown>) => {
      if (!iframeRef.current?.contentWindow) {
        return;
      }

      iframeRef.current.contentWindow.postMessage(message, iframeOrigin);
    };

    const sendHostInitFromEffect = () => {
      postToEmbedFromEffect({
        type: EMBED_HOST_INIT_MESSAGE_TYPE,
        theme: readHostThemeTokens(),
      });
    };

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== iframeOrigin) {
        return;
      }

      const data = asObject(event.data);
      const type = String(data.type ?? "").trim();

      if (type === EMBED_READY_MESSAGE_TYPE) {
        setIframeReady(true);
        setTableState((current) => ({
          ...current,
          ...normalizeTableState(data.payload),
        }));
        sendHostInitFromEffect();
        return;
      }

      if (type === EMBED_STATE_MESSAGE_TYPE) {
        setTableState((current) => ({
          ...current,
          ...normalizeTableState(data.payload),
        }));
        return;
      }

      if (type !== EMBED_IMPORT_MESSAGE_TYPE) {
        return;
      }

      const requestId = String(data.requestId ?? "").trim();
      const payload = asObject(data.payload);
      const rows = coerceRows(payload.rows);

      const postResult = (response: Record<string, unknown>) => {
        postToEmbedFromEffect(response);
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
          message: "No leads were sent from the table.",
          parseErrors: [],
        });
        postResult({
          type: "lastb2b:import-result",
          requestId,
          ok: false,
          error: "No rows were sent from the table.",
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
            : "No leads were added from the table.";

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

  const tableBusy = tableState.isDiscovering || tableState.isEnriching || tableState.isLiveRunning;
  const normalizedPromptDraft = promptDraft.trim();
  const normalizedTablePrompt = tableState.prompt.trim();
  const hasPrompt = Boolean(normalizedPromptDraft || normalizedTablePrompt);
  const lastCheckedLabel = formatTimestamp(tableState.lastSuccessAt);
  const nextRunLabel = formatTimestamp(tableState.nextRunAt);
  const statusCopy = tableState.isDiscovering
    ? "Finding rows..."
    : tableState.isEnriching
      ? "Filling columns..."
      : tableState.isLiveRunning
        ? "Updating live table..."
        : tableState.liveEnabled
          ? nextRunLabel
            ? `Live is on. Next check ${nextRunLabel}.`
            : "Live is on."
          : "Live is off.";

  if (loadingConfig) {
    return (
      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
        <div className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing native prospect table...
        </div>
      </div>
    );
  }

  if (iframeError) {
    return (
      <div className="rounded-2xl border border-[color:var(--danger)]/40 bg-[color:var(--danger-soft)] p-4 text-sm text-[color:var(--danger)]">
        {iframeError}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="border-b border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-[color:var(--foreground)]">
              {tableState.title || "Prospect table"}
            </div>
            <div className="text-xs text-[color:var(--muted-foreground)]">
              Pick who belongs here, decide which columns to fill, and add the good rows when they look right.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted">{tableState.rowCount} rows</Badge>
            <Badge variant="muted">{tableState.columnCount} enrichments</Badge>
            <Badge variant={tableState.liveEnabled ? "success" : "muted"}>
              {tableState.liveEnabled ? "Live on" : "Live off"}
            </Badge>
            {importState.status === "success" ? <Badge variant="success">Added</Badge> : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              Who should this table find?
            </label>
            <Input
              value={promptDraft}
              onChange={(event) => {
                setPromptDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (!iframeReady || tableBusy || !hasPrompt) return;
                if (normalizedPromptDraft && normalizedPromptDraft !== normalizedTablePrompt) {
                  sendHostCommand("set-prompt", { prompt: normalizedPromptDraft });
                }
                sendHostCommand("set-active-tab", { tab: "search" });
                sendHostCommand("run-search");
              }}
              placeholder="Find self-funded SaaS founders who might qualify for AWS credits"
              className="h-11"
            />
            <div className="text-xs text-[color:var(--muted-foreground)]">
              Describe the people you want in plain English.
            </div>
            <div className="inline-flex flex-wrap gap-2">
              {[
                { label: "Criteria", tab: "search" as const },
                { label: "Columns", tab: "columns" as const },
                { label: "Details", tab: "row" as const },
              ].map((item) => (
                <Button
                  key={item.tab}
                  type="button"
                  variant={tableState.activeTab === item.tab ? "default" : "outline"}
                  onClick={() => {
                    sendHostCommand("set-active-tab", { tab: item.tab });
                  }}
                  disabled={!iframeReady}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 xl:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (normalizedPromptDraft && normalizedPromptDraft !== normalizedTablePrompt) {
                  sendHostCommand("set-prompt", { prompt: normalizedPromptDraft });
                }
                sendHostCommand("set-active-tab", { tab: "search" });
                sendHostCommand("run-search");
              }}
              disabled={!iframeReady || tableBusy || !hasPrompt}
            >
              {tableState.isDiscovering ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {tableState.isDiscovering ? "Finding..." : "Find rows"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                sendHostCommand("set-active-tab", { tab: "columns" });
                sendHostCommand("run-enrichment");
              }}
              disabled={!iframeReady || tableBusy || !tableState.hasRows || !tableState.hasColumns}
            >
              {tableState.isEnriching ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {tableState.isEnriching ? "Filling..." : "Fill columns"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                sendHostCommand("toggle-live", { enabled: !tableState.liveEnabled });
              }}
              disabled={!iframeReady || tableBusy}
            >
              {tableState.liveEnabled ? "Turn live off" : "Turn live on"}
            </Button>
            <Button
              type="button"
              onClick={() => {
                sendHostCommand("add-leads");
              }}
              disabled={!iframeReady || tableBusy || importState.status === "importing" || !tableState.hasRows}
            >
              {importState.status === "importing" ? "Adding..." : "Add leads"}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
          <span>{statusCopy}</span>
          {lastCheckedLabel ? <span>Checked {lastCheckedLabel}</span> : null}
          {tableState.lastRowsAppended > 0 ? (
            <span>{tableState.lastRowsAppended} new last run</span>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        {importState.status !== "idle" ? (
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
            {importState.message}
            {summaryLine ? <span className="ml-2 text-[color:var(--foreground)]">{summaryLine}</span> : null}
          </div>
        ) : normalizedTablePrompt ? (
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
            <span className="text-[color:var(--foreground)]">Current criteria:</span> {normalizedTablePrompt}
          </div>
        ) : null}

        {importState.parseErrors.length ? (
          <div className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] px-3 py-2 text-xs text-[color:var(--warning)]">
            {importState.parseErrors.slice(0, 5).join(" · ")}
          </div>
        ) : null}

        <div className="relative overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]">
          {!iframeLoaded ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[color:var(--surface)]/92">
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
            className="h-[760px] w-full bg-transparent"
            onLoad={() => {
              setIframeLoaded(true);
              sendHostInit();
              sendHostCommand("refresh-state");
            }}
          />
        </div>

        {importState.status === "success" ? (
          <div className="inline-flex items-center gap-2 text-xs text-[color:var(--success)]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Those leads are now available inside this workflow.
          </div>
        ) : null}
      </div>
    </div>
  );
}
