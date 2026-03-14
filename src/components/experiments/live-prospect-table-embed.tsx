"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EMBED_READY_MESSAGE_TYPE = "enrichanything:embed-ready";
const EMBED_STATE_MESSAGE_TYPE = "enrichanything:embed-state";
const EMBED_IMPORT_MESSAGE_TYPE = "enrichanything:import-table";
const EMBED_HOST_INIT_MESSAGE_TYPE = "lastb2b:embed-init";
const EMBED_HOST_COMMAND_MESSAGE_TYPE = "lastb2b:embed-command";

type ImportMode = "auto" | "manual";
type ActivityTone = "neutral" | "success" | "warning" | "danger";

type ImportState =
  | {
      status: "idle";
      message: string;
      parseErrors: string[];
      mode: null;
    }
  | {
      status: "importing";
      message: string;
      parseErrors: string[];
      mode: ImportMode;
    }
  | {
      status: "success";
      message: string;
      parseErrors: string[];
      importedCount: number;
      skippedCount: number;
      matchedCount: number;
      attemptedCount: number;
      dedupedCount: number;
      runId: string;
      mode: ImportMode;
    }
  | {
      status: "error";
      message: string;
      parseErrors: string[];
      mode: ImportMode | null;
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
    dedupedCount: number;
    parseErrors: string[];
  }) => void | Promise<void>;
};

type ActivityItem = {
  id: string;
  message: string;
  tone: ActivityTone;
  meta: string;
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
  const pendingImportModeRef = useRef<ImportMode>("manual");
  const lastAutoImportSignatureRef = useRef("");
  const previousStateRef = useRef({
    prompt: "",
    isDiscovering: false,
    isEnriching: false,
    liveEnabled: false,
  });
  const [iframeSrc, setIframeSrc] = useState("");
  const [iframeOrigin, setIframeOrigin] = useState("");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [iframeError, setIframeError] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [autoAddEnabled, setAutoAddEnabled] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
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
    message: "AI will keep adding good leads automatically.",
    parseErrors: [],
    mode: null,
  });

  const pushActivity = (message: string, tone: ActivityTone = "neutral") => {
    const trimmed = message.trim();
    if (!trimmed) return;

    const meta = new Date().toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });

    setActivityItems((current) => {
      if (current[0]?.message === trimmed) {
        return current;
      }

      return [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          message: trimmed,
          tone,
          meta,
        },
        ...current,
      ].slice(0, 4);
    });
  };

  const postToEmbed = useCallback((message: Record<string, unknown>) => {
    if (!iframeRef.current?.contentWindow || !iframeOrigin) {
      return;
    }

    iframeRef.current.contentWindow.postMessage(message, iframeOrigin);
  }, [iframeOrigin]);

  const sendHostInit = useCallback(() => {
    postToEmbed({
      type: EMBED_HOST_INIT_MESSAGE_TYPE,
      theme: readHostThemeTokens(),
    });
  }, [postToEmbed]);

  const sendHostCommand = useCallback((command: string, payload: Record<string, unknown> = {}) => {
    postToEmbed({
      type: EMBED_HOST_COMMAND_MESSAGE_TYPE,
      command,
      payload,
    });
  }, [postToEmbed]);

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
          mode: null,
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
      const importMode = pendingImportModeRef.current;
      setImportState({
        status: "importing",
        message:
          importMode === "auto"
            ? `Checking ${rows.length} row${rows.length === 1 ? "" : "s"} and adding the good leads automatically...`
            : `Checking ${rows.length} row${rows.length === 1 ? "" : "s"} now...`,
        parseErrors: [],
        mode: importMode,
      });
      pushActivity(
        importMode === "auto"
          ? "Checking the latest rows and adding the good leads automatically."
          : "Checking the current rows now.",
        "neutral"
      );

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
        const dedupedCount = Number(result.dedupedCount ?? 0);
        const runId = String(result.runId ?? "").trim();
        const parseErrors = Array.isArray(result.parseErrors)
          ? result.parseErrors.map((value) => String(value ?? ""))
          : [];
        const message = importedCount > 0
          ? importMode === "auto"
            ? `AI added ${importedCount} lead${importedCount === 1 ? "" : "s"}.`
            : `Added ${importedCount} lead${importedCount === 1 ? "" : "s"}.`
          : dedupedCount > 0
            ? "The good leads in those rows were already added."
            : "No new verified work emails were ready to add.";

        setImportState({
          status: "success",
          message,
          parseErrors: parseErrors.slice(0, 5),
          importedCount,
          skippedCount,
          matchedCount,
          attemptedCount,
          dedupedCount,
          runId,
          mode: importMode,
        });
        pushActivity(
          importedCount > 0
            ? message
            : dedupedCount > 0
              ? `Checked ${attemptedCount} row${attemptedCount === 1 ? "" : "s"}. The good leads were already here.`
              : `Checked ${attemptedCount} row${attemptedCount === 1 ? "" : "s"}. No new verified work emails yet.`,
          importedCount > 0 ? "success" : dedupedCount > 0 ? "neutral" : "warning"
        );

        postResult({
          type: "lastb2b:import-result",
          requestId,
          ok: true,
          importedCount,
          skippedCount,
          matchedCount,
          attemptedCount,
          dedupedCount,
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
            dedupedCount,
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
          mode: importMode,
        });
        pushActivity(message, "danger");
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

  const requestImport = useCallback((mode: ImportMode) => {
    if (!iframeReady || importBusyRef.current || !tableState.hasRows) {
      return;
    }

    pendingImportModeRef.current = mode;
    sendHostCommand("add-leads");
  }, [iframeReady, sendHostCommand, tableState.hasRows]);

  const summaryLine = useMemo(() => {
    if (importState.status !== "success") return null;
    const parts = [
      `${importState.attemptedCount} checked`,
      `${importState.matchedCount} matched`,
    ];
    if (importState.dedupedCount > 0) {
      parts.push(`${importState.dedupedCount} already here`);
    }
    if (importState.skippedCount > 0) {
      parts.push(`${importState.skippedCount} skipped`);
    }
    return parts.join(" · ");
  }, [importState]);

  const tableBusy = tableState.isDiscovering || tableState.isEnriching || tableState.isLiveRunning;
  const normalizedPromptDraft = promptDraft.trim();
  const normalizedTablePrompt = tableState.prompt.trim();
  const hasPrompt = Boolean(normalizedPromptDraft || normalizedTablePrompt);
  const lastCheckedLabel = formatTimestamp(tableState.lastSuccessAt);
  const nextRunLabel = formatTimestamp(tableState.nextRunAt);
  const rowLabel = `${tableState.rowCount} row${tableState.rowCount === 1 ? "" : "s"}`;
  const autoImportSignature = [
    normalizedTablePrompt,
    tableState.rowCount,
    tableState.lastSuccessAt,
    tableState.lastRowsAppended,
  ].join("|");
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
  const assistantNote =
    importState.status === "importing"
      ? importState.mode === "auto"
        ? "Checking the latest rows and keeping the good leads automatically."
        : "Checking the current rows now."
      : importState.status === "success"
        ? importState.importedCount > 0
          ? "AI added the latest good leads. Open review if you want to inspect the table."
          : importState.dedupedCount > 0
            ? "The latest good leads were already in this experiment."
            : "AI checked the latest rows but did not find new verified work emails yet."
        : importState.status === "error"
          ? importState.message
          : tableState.isDiscovering
            ? "Looking for people who match that description."
            : tableState.isEnriching
              ? "Filling the extra columns for the rows already here."
              : normalizedPromptDraft && normalizedPromptDraft !== normalizedTablePrompt
                ? "Press Update search to use your new request."
                : normalizedTablePrompt
                  ? `Looking for: ${normalizedTablePrompt}`
                  : "Try “founders at self-funded SaaS companies in Europe”.";
  const manualAddLabel = importState.status === "importing" ? "Checking rows..." : "Add current table now";

  useEffect(() => {
    if (!iframeReady) return;

    const previous = previousStateRef.current;

    if (tableState.prompt && tableState.prompt !== previous.prompt) {
      pushActivity(`Now looking for ${tableState.prompt}.`, "neutral");
    }

    if (tableState.isDiscovering && !previous.isDiscovering) {
      pushActivity("Looking for more people who match your request.", "neutral");
    }

    if (tableState.isEnriching && !previous.isEnriching) {
      pushActivity("Checking work emails and filling in missing details.", "neutral");
    }

    if (tableState.liveEnabled !== previous.liveEnabled) {
      pushActivity(
        tableState.liveEnabled
          ? "AI will keep checking this search automatically."
          : "Auto-checking is paused.",
        tableState.liveEnabled ? "success" : "warning"
      );
    }

    previousStateRef.current = {
      prompt: tableState.prompt,
      isDiscovering: tableState.isDiscovering,
      isEnriching: tableState.isEnriching,
      liveEnabled: tableState.liveEnabled,
    };
  }, [
    iframeReady,
    tableState.isDiscovering,
    tableState.isEnriching,
    tableState.liveEnabled,
    tableState.prompt,
  ]);

  useEffect(() => {
    if (!autoAddEnabled || !iframeReady || importState.status === "importing" || tableBusy || !tableState.hasRows) {
      return;
    }

    const hasFreshRows =
      tableState.lastRowsAppended > 0 || Boolean(tableState.lastSuccessAt) || tableState.rowCount > 0;
    if (!hasFreshRows) {
      return;
    }

    if (lastAutoImportSignatureRef.current === autoImportSignature) {
      return;
    }

    lastAutoImportSignatureRef.current = autoImportSignature;
    requestImport("auto");
  }, [
    autoAddEnabled,
    autoImportSignature,
    iframeReady,
    importState.status,
    requestImport,
    tableBusy,
    tableState.hasRows,
    tableState.lastRowsAppended,
    tableState.lastSuccessAt,
    tableState.rowCount,
  ]);

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
    <div className="rounded-[28px] border border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="border-b border-[color:var(--border)] px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
              Prospects
            </div>
            <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">
              Tell AI who to find. It keeps the good leads automatically.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted">{rowLabel}</Badge>
            <Badge variant={tableState.liveEnabled ? "success" : "muted"}>
              {tableState.liveEnabled ? "Live" : "Paused"}
            </Badge>
            <Badge variant={autoAddEnabled ? "success" : "muted"}>
              {autoAddEnabled ? "Auto-add on" : "Auto-add off"}
            </Badge>
          </div>
        </div>

        <div className="mt-4 rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 md:p-4">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-col gap-2 xl:flex-row">
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
                placeholder="Who do you want to find?"
                className="h-12 flex-1 rounded-[16px] bg-[color:var(--surface)]"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="lg"
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
                  {tableState.isDiscovering ? "Finding..." : "Update search"}
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    sendHostCommand("toggle-live", { enabled: !tableState.liveEnabled });
                  }}
                  disabled={!iframeReady || tableBusy}
                >
                  {tableState.liveEnabled ? "Pause" : "Resume"}
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant={autoAddEnabled ? "secondary" : "outline"}
                  onClick={() => {
                    setAutoAddEnabled((current) => !current);
                  }}
                >
                  {autoAddEnabled ? "Auto-add on" : "Auto-add off"}
                </Button>
              </div>
            </div>

            <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                AI note
              </div>
              <div className="mt-2 text-sm text-[color:var(--foreground)]">{assistantNote}</div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                  Auto-add
                </div>
                <div className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">
                  {autoAddEnabled ? "Adding good leads for you" : "Waiting for your review"}
                </div>
              </div>
              <div className="rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                  In review
                </div>
                <div className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">{rowLabel}</div>
              </div>
              <div className="rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                  Last check
                </div>
                <div className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">
                  {lastCheckedLabel || "Waiting for the first run"}
                </div>
              </div>
            </div>

            <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                  Live activity
                </div>
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  {statusCopy}
                  {tableState.lastRowsAppended > 0 ? ` · ${tableState.lastRowsAppended} new last run` : ""}
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {activityItems.length ? (
                  activityItems.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-start justify-between gap-3 rounded-[14px] border px-3 py-2 text-sm ${
                        item.tone === "success"
                          ? "border-[color:var(--success)]/30 bg-[color:var(--success-soft)] text-[color:var(--success)]"
                          : item.tone === "warning"
                            ? "border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
                            : item.tone === "danger"
                              ? "border-[color:var(--danger)]/30 bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
                              : "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)]"
                      }`}
                    >
                      <span className="min-w-0 flex-1">{item.message}</span>
                      <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] opacity-70">
                        {item.meta}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-sm text-[color:var(--muted-foreground)]">
                    AI is ready. Tell it who to find and it will keep adding the good leads here.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {importState.parseErrors.length ? (
          <div className="mt-3 rounded-[18px] border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] px-3 py-2 text-xs text-[color:var(--warning)]">
            {importState.parseErrors.slice(0, 5).join(" · ")}
          </div>
        ) : null}
      </div>

      <div className="border-t border-[color:var(--border)] px-4 py-4 md:px-5">
        <div className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]">
          <button
            type="button"
            onClick={() => {
              setReviewOpen((current) => !current);
            }}
            className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
          >
            <div>
              <div className="text-sm font-semibold text-[color:var(--foreground)]">Review leads</div>
              <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                Open the table if you want to inspect rows, change columns, or add the current rows yourself.
              </div>
            </div>
            <div className="flex items-center gap-2">
              {summaryLine ? <Badge variant="muted">{summaryLine}</Badge> : null}
              <Badge variant="muted">{reviewOpen ? "Open" : "Closed"}</Badge>
              {reviewOpen ? (
                <ChevronUp className="h-4 w-4 text-[color:var(--muted-foreground)]" />
              ) : (
                <ChevronDown className="h-4 w-4 text-[color:var(--muted-foreground)]" />
              )}
            </div>
          </button>

          <div
            className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${
              reviewOpen ? "max-h-[980px] opacity-100" : "max-h-0 opacity-0"
            }`}
          >
            <div className="border-t border-[color:var(--border)] px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { label: "Criteria", tab: "search" as const },
                    { label: "Columns", tab: "columns" as const },
                    { label: "Details", tab: "row" as const },
                  ].map((item) => (
                    <Button
                      key={item.tab}
                      type="button"
                      size="sm"
                      variant={tableState.activeTab === item.tab ? "secondary" : "ghost"}
                      onClick={() => {
                        sendHostCommand("set-active-tab", { tab: item.tab });
                      }}
                      disabled={!iframeReady}
                    >
                      {item.label}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      sendHostCommand("set-active-tab", { tab: "columns" });
                      sendHostCommand("run-enrichment");
                    }}
                    disabled={!iframeReady || tableBusy || !tableState.hasRows || !tableState.hasColumns}
                  >
                    {tableState.isEnriching ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {tableState.isEnriching ? "Filling..." : "Fill columns"}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      requestImport("manual");
                    }}
                    disabled={!iframeReady || tableBusy || importState.status === "importing" || !tableState.hasRows}
                  >
                    {manualAddLabel}
                  </Button>
                  {importState.status === "success" && importState.importedCount > 0 ? (
                    <div className="inline-flex items-center gap-2 text-xs text-[color:var(--success)]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Added
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="relative border border-[color:var(--border)] bg-[color:var(--surface)]">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
