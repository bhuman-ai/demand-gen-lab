"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, Settings2 } from "lucide-react";
import { SettingsModal } from "@/app/settings/outreach/settings-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EMBED_READY_MESSAGE_TYPE = "enrichanything:embed-ready";
const EMBED_STATE_MESSAGE_TYPE = "enrichanything:embed-state";
const EMBED_IMPORT_MESSAGE_TYPE = "enrichanything:import-table";
const EMBED_HOST_INIT_MESSAGE_TYPE = "lastb2b:embed-init";
const EMBED_HOST_COMMAND_MESSAGE_TYPE = "lastb2b:embed-command";
const REVIEW_CHECKPOINT_ROWS = 20;
const DEFAULT_GOAL_COUNT = REVIEW_CHECKPOINT_ROWS;

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
  goalCount?: number;
  initialPrompt?: string;
  targetingLocked?: boolean;
  settings?: {
    oneContactPerCompany: boolean;
  };
  onReviewApproved?: () => void | Promise<void>;
  onSettingsChange?: (settings: {
    oneContactPerCompany: boolean;
  }) => void | Promise<void>;
  onTableStateChange?: (state: {
    rowCount: number;
    isSearching: boolean;
    prompt: string;
    lastSuccessAt: string;
    statusLabel: string;
  }) => void | Promise<void>;
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

function formatElapsedLabel(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "just now";
  }

  if (totalSeconds < 60) {
    return `${totalSeconds}s ago`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

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
  const explicitMode = document.documentElement.dataset.theme;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const mode = explicitMode === "dark" || (!explicitMode && prefersDark) ? "dark" : "light";

  return {
    mode,
    "--app-bg": "transparent",
    "--background": readThemeToken(rootStyles, "--background", mode === "dark" ? "#171c22" : "#f7f7f4"),
    "--panel": readThemeToken(rootStyles, "--surface", "#11161c"),
    "--panel-alt": readThemeToken(rootStyles, "--surface-muted", "#171d24"),
    "--surface-hover": readThemeToken(rootStyles, "--surface-hover", mode === "dark" ? "#262d35" : "#f2f4f1"),
    "--line": readThemeToken(rootStyles, "--border", "rgba(255, 255, 255, 0.08)"),
    "--line-strong": readThemeToken(rootStyles, "--border", "rgba(255, 255, 255, 0.12)"),
    "--text": readThemeToken(rootStyles, "--foreground", "#f4f7fb"),
    "--muted": readThemeToken(rootStyles, "--muted-foreground", "#94a0b3"),
    "--blue": readThemeToken(rootStyles, "--accent", "#d6dfef"),
    "--blue-strong": readThemeToken(rootStyles, "--accent", "#edf3ff"),
    "--accent-foreground": readThemeToken(rootStyles, "--accent-foreground", mode === "dark" ? "#161b22" : "#fafaf9"),
    "--accent-soft": readThemeToken(rootStyles, "--accent-soft", mode === "dark" ? "#2a3139" : "#eef1ec"),
    "--accent-border": readThemeToken(rootStyles, "--accent-border", mode === "dark" ? "#4d5660" : "#d7ddd4"),
    "--green": readThemeToken(rootStyles, "--success", "#7ed0a6"),
    "--green-bg": readThemeToken(rootStyles, "--success-soft", "rgba(88, 153, 116, 0.18)"),
    "--warning": readThemeToken(rootStyles, "--warning", mode === "dark" ? "#d7b35f" : "#ae7b1f"),
    "--warning-soft": readThemeToken(rootStyles, "--warning-soft", mode === "dark" ? "#3a3122" : "#f5ebd3"),
    "--danger": readThemeToken(rootStyles, "--danger", mode === "dark" ? "#ef8f88" : "#ba4b43"),
    "--danger-soft": readThemeToken(rootStyles, "--danger-soft", mode === "dark" ? "#392424" : "#f6e2df"),
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

function mergeEmbeddedTableState(
  current: EmbeddedTableState,
  incoming: EmbeddedTableState,
  fallbackPrompt = ""
): EmbeddedTableState {
  const currentPrompt = current.prompt.trim();
  const incomingPrompt = incoming.prompt.trim();
  const resolvedPrompt = incomingPrompt || currentPrompt || fallbackPrompt.trim();
  const promptChanged =
    Boolean(incomingPrompt) && Boolean(currentPrompt) && incomingPrompt !== currentPrompt;

  const resolvedRowCount = promptChanged
    ? incoming.rowCount
    : Math.max(current.rowCount, incoming.rowCount);
  const resolvedHasRows =
    resolvedRowCount > 0 || current.hasRows || incoming.hasRows;

  return {
    ...current,
    ...incoming,
    title: incoming.title || current.title,
    prompt: resolvedPrompt,
    rowCount: resolvedRowCount,
    hasRows: resolvedHasRows,
    hasColumns: current.hasColumns || incoming.hasColumns,
    lastSuccessAt: incoming.lastSuccessAt || current.lastSuccessAt,
    nextRunAt: incoming.nextRunAt || current.nextRunAt,
    lastRowsAppended: Math.max(current.lastRowsAppended, incoming.lastRowsAppended),
    statusMessage: incoming.statusMessage || current.statusMessage,
  };
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
  goalCount = DEFAULT_GOAL_COUNT,
  initialPrompt = "",
  targetingLocked = false,
  settings,
  onReviewApproved,
  onSettingsChange,
  onTableStateChange,
  onImported,
}: LiveProspectTableEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const importBusyRef = useRef(false);
  const pendingImportModeRef = useRef<ImportMode>("manual");
  const lastAutoImportSignatureRef = useRef("");
  const autoSearchPromptRef = useRef("");
  const lastAutoSearchResumeSignatureRef = useRef("");
  const lastStallRetrySignatureRef = useRef("");
  const initialEmbedStateHandledRef = useRef(false);
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
  const [allowLiveTable, setAllowLiveTable] = useState(false);
  const [reviewApproved, setReviewApproved] = useState(false);
  const [promptDraft, setPromptDraft] = useState(() => String(initialPrompt || "").trim());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [oneContactPerCompanyDraft, setOneContactPerCompanyDraft] = useState(
    settings?.oneContactPerCompany ?? true
  );
  const [statusNow, setStatusNow] = useState(() => Date.now());
  const [, setActivityItems] = useState<ActivityItem[]>([]);
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
    message: `AI is gathering the first ${REVIEW_CHECKPOINT_ROWS} leads for review.`,
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
    initialEmbedStateHandledRef.current = false;
    autoSearchPromptRef.current = "";
    lastAutoSearchResumeSignatureRef.current = "";
    lastAutoImportSignatureRef.current = "";
    lastStallRetrySignatureRef.current = "";
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
        setAllowLiveTable(Boolean(payload.enabled));
        setTableState((current) => ({
          ...current,
          title: String(payload.tableTitle ?? current.title ?? "").trim(),
          prompt: String(payload.discoveryPrompt ?? current.prompt ?? "").trim(),
          rowCount: Math.max(0, Number(payload.rowCount ?? current.rowCount ?? 0) || 0),
          hasRows:
            Math.max(0, Number(payload.rowCount ?? current.rowCount ?? 0) || 0) > 0 ||
            current.hasRows,
          statusMessage:
            Math.max(0, Number(payload.rowCount ?? current.rowCount ?? 0) || 0) > 0
              ? "Saved leads restored."
              : current.statusMessage,
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

  const normalizedInitialPrompt = String(initialPrompt || "").trim();

  useEffect(() => {
    setPromptDraft(tableState.prompt || normalizedInitialPrompt);
  }, [normalizedInitialPrompt, tableState.prompt]);

  useEffect(() => {
    setOneContactPerCompanyDraft(settings?.oneContactPerCompany ?? true);
  }, [settings?.oneContactPerCompany]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStatusNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

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
        setTableState((current) =>
          mergeEmbeddedTableState(
            current,
            normalizeTableState(data.payload),
            normalizedInitialPrompt
          )
        );
        sendHostInitFromEffect();
        return;
      }

      if (type === EMBED_STATE_MESSAGE_TYPE) {
        setTableState((current) =>
          mergeEmbeddedTableState(
            current,
            normalizeTableState(data.payload),
            normalizedInitialPrompt
          )
        );
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
  }, [iframeOrigin, importPath, normalizedInitialPrompt, onImported]);

  useEffect(() => {
    if (!iframeReady) {
      return;
    }

    const resendTheme = () => {
      sendHostInit();
    };

    resendTheme();

    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      resendTheme();
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = () => {
      resendTheme();
    };
    media.addEventListener?.("change", handleMediaChange);

    return () => {
      observer.disconnect();
      media.removeEventListener?.("change", handleMediaChange);
    };
  }, [iframeReady, sendHostInit]);

  const requestImport = useCallback((mode: ImportMode) => {
    if (!iframeReady || importBusyRef.current || !tableState.hasRows) {
      return;
    }

    pendingImportModeRef.current = mode;
    sendHostCommand("add-leads");
  }, [iframeReady, sendHostCommand, tableState.hasRows]);

  const tableBusy = tableState.isDiscovering || tableState.isEnriching || tableState.isLiveRunning;
  const normalizedPromptDraft = promptDraft.trim();
  const normalizedTablePrompt = tableState.prompt.trim();
  const promptForSearch = normalizedTablePrompt || normalizedPromptDraft || normalizedInitialPrompt;
  const hasPrompt = Boolean(promptForSearch);
  const promptDirty = Boolean(normalizedPromptDraft && normalizedPromptDraft !== normalizedTablePrompt);
  const reviewStorageKey = useMemo(
    () => (promptForSearch ? `lastb2b:prospects-review:${initPath}:${promptForSearch}` : ""),
    [initPath, promptForSearch]
  );
  const reviewPending = tableState.rowCount >= REVIEW_CHECKPOINT_ROWS && !reviewApproved;
  const lastSuccessMs = tableState.lastSuccessAt ? Date.parse(tableState.lastSuccessAt) : 0;
  const secondsSinceLastSuccess =
    lastSuccessMs > 0 ? Math.max(0, Math.floor((statusNow - lastSuccessMs) / 1000)) : null;
  const searchUnderGoal = hasPrompt && !reviewApproved && tableState.rowCount < goalCount;
  const searchLocked = hasPrompt && !reviewApproved && tableState.rowCount < goalCount;
  const autoImportSignature = [
    normalizedTablePrompt,
    tableState.rowCount,
    tableState.lastSuccessAt,
    tableState.lastRowsAppended,
  ].join("|");
  const autoSearchResumeSignature = [
    promptForSearch,
    tableState.rowCount,
    tableState.lastSuccessAt,
    tableState.lastRowsAppended,
  ].join("|");
  const searchStatusLabel = reviewPending
    ? "Review"
    : tableBusy
      ? "Searching"
      : searchUnderGoal
        ? secondsSinceLastSuccess !== null && secondsSinceLastSuccess >= 30
          ? "Retrying"
          : "Waiting"
        : reviewApproved
          ? "Approved"
          : tableState.rowCount >= goalCount
            ? "Ready"
            : "Waiting";
  const waitingForFirstResults =
    hasPrompt &&
    tableState.rowCount === 0 &&
    (tableBusy || searchUnderGoal || reviewApproved);
  const progressPercent = goalCount > 0 ? Math.min(100, (tableState.rowCount / goalCount) * 100) : 0;
  const progressFillPercent = searchLocked
    ? Math.max(progressPercent, tableState.rowCount > 0 ? 12 : 6)
    : progressPercent;
  const progressLabel = reviewPending
    ? `${tableState.rowCount} / ${goalCount} ready to review`
    : `${tableState.rowCount} / ${goalCount}`;
  const progressMetaLabel = reviewPending
    ? "Review leads"
    : searchLocked
      ? tableState.rowCount === 0
        ? "Finding first leads"
        : tableBusy
          ? "Searching"
        : secondsSinceLastSuccess !== null && secondsSinceLastSuccess >= 30
          ? "Trying again"
          : "Working"
      : reviewApproved
        ? tableState.rowCount === 0
          ? "Loading leads"
          : "Approved"
        : tableState.rowCount >= goalCount
        ? "Ready"
        : "Waiting";
  const settingsDirty = oneContactPerCompanyDraft !== (settings?.oneContactPerCompany ?? true);

  useEffect(() => {
    if (!iframeReady || initialEmbedStateHandledRef.current) {
      return;
    }

    initialEmbedStateHandledRef.current = true;

    if (tableBusy) {
      autoSearchPromptRef.current = promptForSearch;
    }
  }, [
    autoSearchResumeSignature,
    iframeReady,
    promptForSearch,
    tableBusy,
    tableState.rowCount,
  ]);

  useEffect(() => {
    Promise.resolve(
      onTableStateChange?.({
        rowCount: tableState.rowCount,
        isSearching: tableBusy,
        prompt: normalizedTablePrompt || normalizedPromptDraft,
        lastSuccessAt: tableState.lastSuccessAt,
        statusLabel: searchStatusLabel,
      })
    ).catch(() => undefined);
  }, [
    searchStatusLabel,
    tableState.lastSuccessAt,
    normalizedPromptDraft,
    normalizedTablePrompt,
    onTableStateChange,
    tableBusy,
    tableState.rowCount,
  ]);

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
    if (typeof window === "undefined") return;
    if (allowLiveTable) {
      setReviewApproved(true);
      return;
    }
    if (!reviewStorageKey) {
      setReviewApproved(false);
      return;
    }
    setReviewApproved(window.localStorage.getItem(reviewStorageKey) === "approved");
  }, [allowLiveTable, reviewStorageKey]);

  useEffect(() => {
    if (
      !iframeReady ||
      !initialEmbedStateHandledRef.current ||
      reviewApproved ||
      !hasPrompt ||
      tableBusy ||
      tableState.rowCount > 0 ||
      tableState.rowCount >= goalCount
    ) {
      return;
    }

    if (autoSearchPromptRef.current === promptForSearch) {
      return;
    }

    autoSearchPromptRef.current = promptForSearch;
    sendHostCommand("set-active-tab", { tab: "search" });
    if (promptForSearch && promptForSearch !== normalizedTablePrompt) {
      sendHostCommand("set-prompt", { prompt: promptForSearch });
    }
    sendHostCommand("run-search", { limit: goalCount });
    pushActivity("AI started searching for the first leads.", "neutral");
  }, [
    goalCount,
    hasPrompt,
    iframeReady,
    normalizedPromptDraft,
    normalizedTablePrompt,
    promptForSearch,
    reviewApproved,
    sendHostCommand,
    tableBusy,
    tableState.rowCount,
  ]);

  useEffect(() => {
    if (
      allowLiveTable ||
      !iframeReady ||
      !initialEmbedStateHandledRef.current ||
      reviewApproved ||
      !hasPrompt ||
      tableBusy ||
      tableState.rowCount <= 0 ||
      tableState.rowCount >= goalCount
    ) {
      return;
    }

    if (lastAutoSearchResumeSignatureRef.current === autoSearchResumeSignature) {
      return;
    }

    lastAutoSearchResumeSignatureRef.current = autoSearchResumeSignature;
    sendHostCommand("set-active-tab", { tab: "search" });
    if (promptForSearch && promptForSearch !== normalizedTablePrompt) {
      sendHostCommand("set-prompt", { prompt: promptForSearch });
    }
    sendHostCommand("run-search", { limit: goalCount });
    pushActivity(
      `AI found ${tableState.rowCount} lead${tableState.rowCount === 1 ? "" : "s"} so far and is looking for more.`,
      "neutral"
    );
  }, [
    allowLiveTable,
    autoSearchResumeSignature,
    goalCount,
    hasPrompt,
    iframeReady,
    normalizedPromptDraft,
    normalizedTablePrompt,
    promptForSearch,
    reviewApproved,
    sendHostCommand,
    tableBusy,
      tableState.rowCount,
  ]);

  useEffect(() => {
    if (
      allowLiveTable ||
      !iframeReady ||
      !initialEmbedStateHandledRef.current ||
      reviewApproved ||
      !hasPrompt ||
      promptDirty ||
      tableBusy ||
      tableState.rowCount >= goalCount
    ) {
      return;
    }

    const noProgressThresholdSeconds = tableState.rowCount > 0 ? 30 : 18;
    if (secondsSinceLastSuccess === null || secondsSinceLastSuccess < noProgressThresholdSeconds) {
      return;
    }

    const retrySignature = [
      promptForSearch,
      tableState.rowCount,
      tableState.lastSuccessAt || "none",
    ].join("|");

    if (lastStallRetrySignatureRef.current === retrySignature) {
      return;
    }

    lastStallRetrySignatureRef.current = retrySignature;
    sendHostCommand("set-active-tab", { tab: "search" });
    if (promptForSearch && promptForSearch !== normalizedTablePrompt) {
      sendHostCommand("set-prompt", { prompt: promptForSearch });
    }
    sendHostCommand("run-search", { limit: goalCount });
    pushActivity(
      tableState.rowCount > 0
        ? `No new leads for ${formatElapsedLabel(secondsSinceLastSuccess)}. Trying another search pass.`
        : "Still waiting for the first leads. Trying another search pass.",
      "warning"
    );
  }, [
    allowLiveTable,
    goalCount,
    hasPrompt,
    iframeReady,
    normalizedPromptDraft,
    normalizedTablePrompt,
    promptDirty,
    promptForSearch,
    reviewApproved,
    secondsSinceLastSuccess,
    sendHostCommand,
    tableBusy,
    tableState.lastSuccessAt,
    tableState.rowCount,
  ]);

  useEffect(() => {
    if (allowLiveTable || !iframeReady || !tableState.liveEnabled || tableBusy) {
      return;
    }

    sendHostCommand("toggle-live", { enabled: false });
  }, [allowLiveTable, iframeReady, sendHostCommand, tableBusy, tableState.liveEnabled]);

  useEffect(() => {
    if (!reviewApproved || !iframeReady || importState.status === "importing" || tableBusy || !tableState.hasRows) {
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
    autoImportSignature,
    iframeReady,
    importState.status,
    requestImport,
    reviewApproved,
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

  async function saveSettings() {
    if (!settingsDirty || !onSettingsChange) {
      setSettingsOpen(false);
      return;
    }

    setSettingsSaving(true);
    try {
      await onSettingsChange({
        oneContactPerCompany: oneContactPerCompanyDraft,
      });
      setSettingsOpen(false);
    } finally {
      setSettingsSaving(false);
    }
  }

  return (
    <>
    <div className="overflow-hidden rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface)] shadow-none">
      <div className="border-b border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-4 md:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <Input
            ref={promptInputRef}
            value={promptDraft}
            onChange={(event) => {
              setPromptDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (!iframeReady || searchLocked || !hasPrompt) return;
              if (normalizedPromptDraft && normalizedPromptDraft !== normalizedTablePrompt) {
                sendHostCommand("set-prompt", { prompt: normalizedPromptDraft });
              }
              sendHostCommand("set-active-tab", { tab: "search" });
              sendHostCommand("run-search", { limit: goalCount });
            }}
            placeholder="Find self-funded SaaS founders who might want AWS credits"
            readOnly={searchLocked || targetingLocked}
            aria-readonly={searchLocked || targetingLocked}
            className="h-12 flex-1 rounded-[14px] border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)] shadow-none focus-visible:ring-[color:var(--accent-border)] read-only:cursor-not-allowed read-only:opacity-85"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-12 rounded-[14px] px-3"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="h-4 w-4" />
              Settings
            </Button>
            {reviewPending ? (
              <>
                <Button
                  type="button"
                  className="border-[color:var(--accent-border)] bg-[color:var(--accent)] text-[color:var(--accent-foreground)] hover:opacity-95"
                  onClick={() => {
                    if (typeof window !== "undefined" && reviewStorageKey) {
                      window.localStorage.setItem(reviewStorageKey, "approved");
                    }
                    setReviewApproved(true);
                    pushActivity("Targeting looks good. AI will keep the good leads from this batch.", "success");
                    Promise.resolve(onReviewApproved?.()).catch(() => undefined);
                  }}
                >
                  Looks good
                </Button>
                {!targetingLocked ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-muted)]"
                    onClick={() => {
                      if (typeof window !== "undefined" && reviewStorageKey) {
                        window.localStorage.removeItem(reviewStorageKey);
                      }
                      setReviewApproved(false);
                      promptInputRef.current?.focus();
                    }}
                  >
                    Edit targeting
                  </Button>
                ) : null}
              </>
            ) : promptDirty && !searchLocked && !targetingLocked ? (
              <Button
                type="button"
                size="lg"
                className="border-[color:var(--accent-border)] bg-[color:var(--accent)] text-[color:var(--accent-foreground)] hover:opacity-95"
                onClick={() => {
                  if (typeof window !== "undefined" && reviewStorageKey) {
                    window.localStorage.removeItem(reviewStorageKey);
                  }
                  setReviewApproved(false);
                  sendHostCommand("set-prompt", { prompt: normalizedPromptDraft });
                  sendHostCommand("set-active-tab", { tab: "search" });
                  sendHostCommand("run-search", { limit: goalCount });
                }}
                disabled={!iframeReady || tableBusy || !normalizedPromptDraft}
              >
                <Search className="h-4 w-4" />
                Apply changes
              </Button>
            ) : !searchLocked && !targetingLocked ? (
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-muted)]"
                onClick={() => {
                  promptInputRef.current?.focus();
                  sendHostCommand("set-active-tab", { tab: "search" });
                }}
                disabled={!iframeReady}
              >
                Edit targeting
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
            <span>{progressLabel}</span>
            <span className="flex items-center gap-2">
              {searchLocked ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {progressMetaLabel}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
            <div
              className={`h-full rounded-full bg-[color:var(--accent)] transition-[width] duration-500 ${searchLocked ? "animate-pulse" : ""}`}
              style={{ width: `${progressFillPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="relative bg-[color:var(--surface)]">
        {!iframeLoaded ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[color:var(--surface)]">
            <div className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading table...
            </div>
          </div>
        ) : null}
        {iframeLoaded && waitingForFirstResults ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[color:var(--surface)]/94">
            <div className="w-full max-w-md px-6">
              <div className="mb-3 text-center text-xs font-medium uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                {tableBusy
                  ? "Finding first leads"
                  : reviewApproved
                    ? "Loading leads"
                    : "Waiting for first leads"}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
                <div className="h-full w-1/3 rounded-full bg-[color:var(--accent)] animate-pulse" />
              </div>
              <div className="mt-3 text-center text-xs text-[color:var(--muted-foreground)]">
                {reviewApproved
                  ? "Loading the saved leads for this experiment."
                  : "The first matching rows will appear here automatically."}
              </div>
            </div>
          </div>
        ) : null}
        <iframe
          ref={iframeRef}
          title="Live prospect table"
          src={iframeSrc}
          className="h-[860px] w-full bg-transparent"
          onLoad={() => {
            setIframeLoaded(true);
          }}
        />
      </div>
    </div>

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Lead settings"
        description="Adjust how this experiment turns matching rows into actual leads."
        panelClassName="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setSettingsOpen(false)} disabled={settingsSaving}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void saveSettings();
              }}
              disabled={settingsSaving || !settingsDirty}
            >
              {settingsSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        }
      >
        <label className="flex cursor-pointer items-start gap-3 rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border border-[color:var(--border)] bg-[color:var(--surface)]"
            checked={oneContactPerCompanyDraft}
            onChange={(event) => setOneContactPerCompanyDraft(event.target.checked)}
          />
          <div className="space-y-1">
            <div className="text-sm font-medium text-[color:var(--foreground)]">Only keep one contact per company</div>
            <div className="text-sm text-[color:var(--muted-foreground)]">
              When this is on, the experiment skips extra people from companies already represented in the lead pool.
              Turn it off if you want to contact multiple people at the same company.
            </div>
          </div>
        </label>
      </SettingsModal>
    </>
  );
}
