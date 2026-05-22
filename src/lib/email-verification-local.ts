import net from "net";
import tls from "tls";
import { promises as dns } from "dns";

type SmtpOutcome = {
  status: "accepted" | "rejected" | "tempfail" | "unknown";
  code: number;
  message: string;
  catchAll: boolean | null;
  usedStartTls: boolean;
};

type MxRecord = {
  exchange: string;
  priority: number;
};

export type LocalVerificationOutcome = {
  verdict: "likely-valid" | "risky-valid" | "invalid" | "unknown";
  confidence: "high" | "medium" | "low";
  details: Record<string, unknown>;
  reason: string;
};

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const DEFAULT_PORT = 25;
const DEFAULT_TIMEOUT_MS = 10_000;

function nowMs() {
  return Date.now();
}

function parseBool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function normalizeEmail(email: string) {
  return String(email ?? "").trim().toLowerCase();
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(onTimeout()), Math.max(250, timeoutMs));
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function normalizeServiceUrl(value: unknown) {
  return String(value ?? "")
    .replace(/\\n/g, "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/\/+$/, "");
}

function normalizeServiceToken(value: unknown) {
  return String(value ?? "")
    .replace(/\\n/g, "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "");
}

function normalizeVerdict(value: unknown): LocalVerificationOutcome["verdict"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "likely-valid" ||
    normalized === "risky-valid" ||
    normalized === "invalid" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return "unknown";
}

function normalizeConfidence(value: unknown): LocalVerificationOutcome["confidence"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "low";
}

function randomLocalPart() {
  return `probe-${Math.random().toString(36).slice(2, 10)}`;
}

function isSmtpAccept(code: number) {
  return code >= 250 && code < 260;
}

function isSmtpReject(code: number) {
  return code >= 550 && code < 560;
}

function isSmtpTempFail(code: number) {
  return code >= 400 && code < 500;
}

function parseSmtpCode(line: string) {
  const match = line.match(/^(\d{3})/);
  if (!match) return 0;
  return Number(match[1]);
}

async function readSmtpResponse(socket: net.Socket, timeoutMs: number) {
  const started = nowMs();
  let buffer = "";

  return await new Promise<{ code: number; message: string }>((resolve, reject) => {
    let timeoutHandle: NodeJS.Timeout | null = setTimeout(() => {
      timeoutHandle = null;
      reject(new Error("smtp_timeout"));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (!/^\d{3}[ -]/.test(line)) continue;
        const code = parseSmtpCode(line);
        if (code && line[3] === " ") {
          cleanup();
          resolve({ code, message: line });
          return;
        }
      }
      if (nowMs() - started > timeoutMs) {
        cleanup();
        reject(new Error("smtp_timeout"));
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("smtp_closed"));
    };

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

async function writeSmtpCommand(
  socket: net.Socket,
  command: string,
  timeoutMs: number
) {
  socket.write(`${command}\r\n`);
  return await readSmtpResponse(socket, timeoutMs);
}

async function connectSmtp(host: string, timeoutMs: number) {
  const socket = net.createConnection({ host, port: DEFAULT_PORT });
  socket.setTimeout(timeoutMs);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
    socket.once("timeout", () => reject(new Error("smtp_timeout")));
  });
  return socket;
}

async function upgradeStartTls(
  socket: net.Socket,
  host: string,
  timeoutMs: number
) {
  return await new Promise<tls.TLSSocket>((resolve, reject) => {
    const tlsSocket = tls.connect(
      {
        socket,
        servername: host,
        timeout: timeoutMs,
      },
      () => resolve(tlsSocket)
    );
    tlsSocket.once("error", reject);
    tlsSocket.once("timeout", () => reject(new Error("smtp_timeout")));
  });
}

async function smtpVerifyMailbox(input: {
  mxHost: string;
  heloDomain: string;
  mailFrom: string;
  targetEmail: string;
  timeoutMs: number;
  useStartTls: boolean;
  checkCatchAll: boolean;
}) : Promise<SmtpOutcome> {
  let socket: net.Socket | tls.TLSSocket | null = null;
  let usedStartTls = false;
  try {
    socket = await connectSmtp(input.mxHost, input.timeoutMs);
    await readSmtpResponse(socket, input.timeoutMs);
    const ehlo = await writeSmtpCommand(socket, `EHLO ${input.heloDomain}`, input.timeoutMs);
    const supportsStartTls = /STARTTLS/i.test(ehlo.message);

    if (supportsStartTls && input.useStartTls) {
      await writeSmtpCommand(socket, "STARTTLS", input.timeoutMs);
      socket = await upgradeStartTls(socket, input.mxHost, input.timeoutMs);
      usedStartTls = true;
      await writeSmtpCommand(socket, `EHLO ${input.heloDomain}`, input.timeoutMs);
    }

    await writeSmtpCommand(socket, `MAIL FROM:<${input.mailFrom}>`, input.timeoutMs);
    const rcptTarget = await writeSmtpCommand(socket, `RCPT TO:<${input.targetEmail}>`, input.timeoutMs);
    const targetCode = rcptTarget.code;

    let catchAll: boolean | null = null;
    if (input.checkCatchAll) {
      const domain = input.targetEmail.split("@")[1] ?? "";
      const fake = `${randomLocalPart()}@${domain}`;
      const rcptFake = await writeSmtpCommand(socket, `RCPT TO:<${fake}>`, input.timeoutMs);
      const fakeAccepted = isSmtpAccept(rcptFake.code);
      const targetAccepted = isSmtpAccept(targetCode);
      if (targetAccepted || fakeAccepted) {
        catchAll = targetAccepted && fakeAccepted;
      }
    }

    await writeSmtpCommand(socket, "QUIT", input.timeoutMs);

    if (isSmtpAccept(targetCode)) {
      return {
        status: "accepted",
        code: targetCode,
        message: rcptTarget.message,
        catchAll,
        usedStartTls,
      };
    }
    if (isSmtpReject(targetCode)) {
      return {
        status: "rejected",
        code: targetCode,
        message: rcptTarget.message,
        catchAll,
        usedStartTls,
      };
    }
    if (isSmtpTempFail(targetCode)) {
      return {
        status: "tempfail",
        code: targetCode,
        message: rcptTarget.message,
        catchAll,
        usedStartTls,
      };
    }

    return {
      status: "unknown",
      code: targetCode,
      message: rcptTarget.message,
      catchAll,
      usedStartTls,
    };
  } catch (error) {
    return {
      status: "unknown",
      code: 0,
      message: String((error as Error)?.message ?? error ?? "smtp_error"),
      catchAll: null,
      usedStartTls,
    };
  } finally {
    if (socket) {
      socket.destroy();
    }
  }
}

export async function localVerifyEmail(input: {
  email: string;
  heloDomain: string;
  mailFrom: string;
  enableSmtp: boolean;
  enableStartTls: boolean;
  checkCatchAll: boolean;
  timeoutMs: number;
}) : Promise<LocalVerificationOutcome> {
  const normalized = normalizeEmail(input.email);
  if (!normalized || !EMAIL_RE.test(normalized)) {
    return {
      verdict: "invalid",
      confidence: "high",
      reason: "invalid_syntax",
      details: {
        provider: "local-verifier",
        syntax: "invalid",
      },
    };
  }

  const domain = normalized.split("@")[1] ?? "";
  let mxRecords: MxRecord[] = [];
  try {
    mxRecords = await withTimeout(
      dns.resolveMx(domain),
      Math.max(1_000, input.timeoutMs || DEFAULT_TIMEOUT_MS),
      () => [] as MxRecord[]
    );
  } catch (error) {
    return {
      verdict: "invalid",
      confidence: "high",
      reason: "no_mx",
      details: {
        provider: "local-verifier",
        mx_status: "no-mail-route",
        mx_error: String((error as Error)?.message ?? error ?? "resolveMx_failed"),
      },
    };
  }

  if (!mxRecords.length) {
    return {
      verdict: "invalid",
      confidence: "high",
      reason: "no_mx",
      details: {
        provider: "local-verifier",
        mx_status: "no-mail-route",
      },
    };
  }

  const selectedMx = [...mxRecords].sort((a, b) => a.priority - b.priority)[0]?.exchange ?? "";
  if (!input.enableSmtp || !selectedMx || !input.heloDomain || !input.mailFrom) {
    return {
      verdict: "unknown",
      confidence: "low",
      reason: "smtp_disabled",
      details: {
        provider: "local-verifier",
        mx_status: "mail-ready",
        mx_records: mxRecords,
        smtp: "skipped",
      },
    };
  }

  const smtp = await smtpVerifyMailbox({
    mxHost: selectedMx,
    heloDomain: input.heloDomain,
    mailFrom: input.mailFrom,
    targetEmail: normalized,
    timeoutMs: input.timeoutMs || DEFAULT_TIMEOUT_MS,
    useStartTls: input.enableStartTls,
    checkCatchAll: input.checkCatchAll,
  });

  if (smtp.status === "accepted") {
    return {
      verdict: smtp.catchAll ? "risky-valid" : "likely-valid",
      confidence: smtp.catchAll ? "medium" : "high",
      reason: smtp.catchAll ? "smtp_accept_catch_all" : "smtp_accept",
      details: {
        provider: "local-verifier",
        mx_status: "mail-ready",
        mx_records: mxRecords,
        smtp: {
          status: smtp.status,
          code: smtp.code,
          message: smtp.message,
          catch_all: smtp.catchAll,
          used_starttls: smtp.usedStartTls,
        },
      },
    };
  }

  if (smtp.status === "rejected") {
    return {
      verdict: "invalid",
      confidence: "high",
      reason: "smtp_reject",
      details: {
        provider: "local-verifier",
        mx_status: "mail-ready",
        mx_records: mxRecords,
        smtp: {
          status: smtp.status,
          code: smtp.code,
          message: smtp.message,
          catch_all: smtp.catchAll,
          used_starttls: smtp.usedStartTls,
        },
      },
    };
  }

  return {
    verdict: "unknown",
    confidence: "low",
    reason: smtp.status === "tempfail" ? "smtp_tempfail" : "smtp_unknown",
    details: {
      provider: "local-verifier",
      mx_status: "mail-ready",
      mx_records: mxRecords,
      smtp: {
        status: smtp.status,
        code: smtp.code,
        message: smtp.message,
        catch_all: smtp.catchAll,
        used_starttls: smtp.usedStartTls,
      },
    },
  };
}

export async function remoteVerifyEmail(input: {
  email: string;
  serviceUrl: string;
  serviceToken: string;
  allowPaidFallback: boolean;
  timeoutMs: number;
}) : Promise<LocalVerificationOutcome | null> {
  const serviceUrl = normalizeServiceUrl(input.serviceUrl);
  const serviceToken = normalizeServiceToken(input.serviceToken);
  if (!serviceUrl || !serviceToken) {
    return null;
  }

  const timeoutMs = Math.max(250, input.timeoutMs || DEFAULT_TIMEOUT_MS);
  const requestTimeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const probeTimeoutSeconds = Math.max(
    1,
    Math.min(requestTimeoutSeconds, Math.floor(Math.max(1_000, timeoutMs - 2_000) / 1000))
  );
  const controller = new AbortController();
  let timedOut = false;
  const timeoutResult = (): LocalVerificationOutcome => {
    timedOut = true;
    controller.abort();
    return {
      verdict: "unknown",
      confidence: "low",
      reason: "remote_verifier_timeout",
      details: {
        provider: "remote-local-verifier",
        timeout_ms: timeoutMs,
      },
    };
  };

  try {
    return await withTimeout(
      (async () => {
        const response = await fetch(`${serviceUrl}/verify`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceToken}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify({
            email: input.email,
            allow_paid_fallback: input.allowPaidFallback,
            timeout_ms: timeoutMs,
            timeout_seconds: requestTimeoutSeconds,
            probe_timeout_seconds: probeTimeoutSeconds,
          }),
          signal: controller.signal,
        });
        const payload = await withTimeout(
          response.json().catch(() => ({})),
          Math.min(5_000, timeoutMs),
          () => ({ parse_timeout: true })
        );
        if (!response.ok) {
          return {
            verdict: "unknown",
            confidence: "low",
            reason: `remote_verifier_http_${response.status}`,
            details: {
              provider: "remote-local-verifier",
              http_status: response.status,
              response: payload,
            },
          };
        }

        return {
          verdict: normalizeVerdict((payload as Record<string, unknown>).verdict),
          confidence: normalizeConfidence((payload as Record<string, unknown>).confidence),
          reason: String((payload as Record<string, unknown>).reason ?? "remote_verifier"),
          details: {
            provider: "remote-local-verifier",
            paid_used: Boolean((payload as Record<string, unknown>).paid_used),
            cached: Boolean((payload as Record<string, unknown>).cached),
            response: payload,
          },
        };
      })(),
      timeoutMs,
      timeoutResult
    );
  } catch (error) {
    const errorMessage = String((error as Error)?.message ?? error ?? "request_failed");
    const errorName = String((error as Error)?.name ?? "");
    if (timedOut || errorName === "AbortError" || errorMessage.toLowerCase().includes("aborted")) {
      return timeoutResult();
    }
    return {
      verdict: "unknown",
      confidence: "low",
      reason: "remote_verifier_request_failed",
      details: {
        provider: "remote-local-verifier",
        error: errorMessage,
      },
    };
  }
}

export function resolveLocalVerificationConfig() {
  const serviceUrl = normalizeServiceUrl(
    process.env.EMAIL_FINDER_LOCAL_VERIFIER_URL ?? process.env.EMAIL_VERIFIER_SERVICE_URL
  );
  const serviceToken = normalizeServiceToken(
    process.env.EMAIL_FINDER_LOCAL_VERIFIER_TOKEN ?? process.env.EMAIL_VERIFIER_SERVICE_TOKEN ?? ""
  );
  const serviceTimeoutMs = Math.max(
    2000,
    Math.min(60_000, Number(process.env.EMAIL_FINDER_LOCAL_VERIFIER_TIMEOUT_MS ?? 20_000) || 20_000)
  );
  const heloDomain = String(process.env.EMAIL_FINDER_SMTP_HELO_DOMAIN ?? "").trim();
  const mailFrom = String(process.env.EMAIL_FINDER_SMTP_MAIL_FROM ?? "").trim();
  const enableSmtp = parseBool(process.env.EMAIL_FINDER_LOCAL_SMTP_ENABLED, true);
  const enableStartTls = parseBool(process.env.EMAIL_FINDER_LOCAL_SMTP_STARTTLS, true);
  const checkCatchAll = parseBool(process.env.EMAIL_FINDER_LOCAL_SMTP_CATCH_ALL, true);
  const timeoutMs = Math.max(2000, Math.min(30_000, Number(process.env.EMAIL_FINDER_LOCAL_SMTP_TIMEOUT_MS ?? 10_000) || 10_000));

  return {
    serviceUrl,
    serviceToken,
    serviceTimeoutMs,
    heloDomain,
    mailFrom,
    enableSmtp: enableSmtp && Boolean(heloDomain && mailFrom),
    enableStartTls,
    checkCatchAll,
    timeoutMs,
  };
}
