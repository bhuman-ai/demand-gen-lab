import net from "node:net";
import tls from "node:tls";

type ImapMailboxConfig = {
  host: string;
  port: number;
  secure: boolean;
  email: string;
  password: string;
};

type ImapCommandResult = {
  ok: boolean;
  status: "OK" | "NO" | "BAD" | "";
  raw: string;
};

type ImapMailbox = {
  name: string;
  attributes: string[];
};

export type MailboxPlacementVerdict = "inbox" | "spam" | "all_mail_only" | "not_found" | "error";

export type MailboxPlacementResult = {
  ok: boolean;
  placement: MailboxPlacementVerdict;
  matchedMailbox: string;
  matchedUid: number;
  searchedMailboxes: string[];
  error: string;
};

export type MailboxFetchedMessage = {
  uid: number;
  mailboxName: string;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
};

function imapQuoted(value: string) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatImapSinceDate(input: Date) {
  return input
    .toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .replace(/\s+/g, "-");
}

function parseTaggedStatus(tag: string, raw: string): ImapCommandResult["status"] {
  const match = raw.match(new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD)\\b`, "i"));
  if (!match) return "";
  const status = match[1]?.toUpperCase();
  return status === "OK" || status === "NO" || status === "BAD" ? status : "";
}

function parseListMailboxes(raw: string): ImapMailbox[] {
  const rows = raw
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  const mailboxes: ImapMailbox[] = [];
  for (const row of rows) {
    const match = row.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.+)$/i);
    if (!match) continue;
    const attributes = match[1]
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const mailboxRaw = match[2]?.trim() ?? "";
    const mailboxName = mailboxRaw.replace(/^"/, "").replace(/"$/, "").replace(/\\"/g, '"');
    if (!mailboxName) continue;
    mailboxes.push({ name: mailboxName, attributes });
  }
  return mailboxes;
}

function parseSearchUids(raw: string) {
  const match = raw.match(/^\* SEARCH\s*(.*)$/im);
  const tokenBlob = match?.[1]?.trim() ?? "";
  return tokenBlob
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function extractImapLiteral(raw: string, pattern: RegExp) {
  const match = pattern.exec(raw);
  if (!match || typeof match.index !== "number") return "";
  const byteCount = Number(match[1] ?? 0);
  if (!Number.isFinite(byteCount) || byteCount <= 0) return "";
  const start = match.index + match[0].length;
  return raw.slice(start, start + byteCount);
}

function unfoldHeaderValue(value: string) {
  return value.replace(/\r?\n[ \t]+/g, " ").trim();
}

function parseHeaderValue(headersRaw: string, headerName: string) {
  const escaped = headerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = headersRaw.match(new RegExp(`^${escaped}:([\\s\\S]*?)(?:\\r?\\n[^ \\t]|$)`, "im"));
  if (!match) return "";
  return unfoldHeaderValue(match[1] ?? "");
}

function parseFetchedMailboxMessage(raw: string, mailboxName: string): MailboxFetchedMessage | null {
  const uidMatch = raw.match(/\bUID (\d+)\b/i);
  const uid = Number(uidMatch?.[1] ?? 0);
  if (!Number.isFinite(uid) || uid <= 0) return null;

  const headersRaw = extractImapLiteral(
    raw,
    /BODY\[HEADER\.FIELDS \(FROM TO SUBJECT MESSAGE-ID DATE\)\] \{(\d+)\}\r\n/i
  );
  const bodyRaw = extractImapLiteral(raw, /BODY\[TEXT\](?:<\d+>)? \{(\d+)\}\r\n/i);

  const messageId = parseHeaderValue(headersRaw, "Message-ID").replace(/^<|>$/g, "");
  return {
    uid,
    mailboxName,
    messageId,
    from: parseHeaderValue(headersRaw, "From"),
    to: parseHeaderValue(headersRaw, "To"),
    subject: parseHeaderValue(headersRaw, "Subject"),
    date: parseHeaderValue(headersRaw, "Date"),
    body: bodyRaw.trim(),
  };
}

function mailboxByAttribute(mailboxes: ImapMailbox[], expected: string[]) {
  const normalized = expected.map((value) => value.toLowerCase());
  return (
    mailboxes.find((mailbox) =>
      mailbox.attributes.some((attribute) => normalized.includes(attribute.toLowerCase()))
    ) ?? null
  );
}

function mailboxByName(mailboxes: ImapMailbox[], pattern: RegExp) {
  return mailboxes.find((mailbox) => pattern.test(mailbox.name.trim().toLowerCase())) ?? null;
}

function resolveInboxMailbox(mailboxes: ImapMailbox[]) {
  return mailboxByAttribute(mailboxes, ["\\Inbox"]) ?? mailboxByName(mailboxes, /^inbox$/i);
}

function resolveSpamMailbox(mailboxes: ImapMailbox[]) {
  return (
    mailboxByAttribute(mailboxes, ["\\Junk", "\\Spam"]) ??
    mailboxByName(mailboxes, /(^|\/)(spam|junk)$/i)
  );
}

function resolveAllMailMailbox(mailboxes: ImapMailbox[]) {
  return (
    mailboxByAttribute(mailboxes, ["\\All"]) ??
    mailboxByName(mailboxes, /(all mail|archive)$/i)
  );
}

class ImapClient {
  private socket: tls.TLSSocket | net.Socket | null = null;
  private connected = false;
  private tagCounter = 1;
  private selectedMailbox = "";

  constructor(private readonly options: ImapMailboxConfig) {}

  private readUntilTagged(tag: string) {
    return new Promise<string>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("IMAP socket not connected"));
        return;
      }
      let raw = "";
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`IMAP command timed out: ${tag}`));
      }, 15_000);

      const onData = (chunk: Buffer | string) => {
        raw += chunk.toString();
        if (new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD)\\b`, "i").test(raw)) {
          cleanup();
          resolve(raw);
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onEnd = () => {
        cleanup();
        reject(new Error("IMAP connection closed"));
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket?.off("data", onData);
        this.socket?.off("error", onError);
        this.socket?.off("end", onEnd);
      };

      this.socket.on("data", onData);
      this.socket.on("error", onError);
      this.socket.on("end", onEnd);
    });
  }

  async connect() {
    if (this.connected) return;
    const socket = this.options.secure
      ? tls.connect({
          host: this.options.host,
          port: this.options.port,
          servername: this.options.host,
        })
      : net.connect({
          host: this.options.host,
          port: this.options.port,
        });

    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      let greeting = "";
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("IMAP greeting timed out"));
      }, 15_000);

      const onConnect = () => {
        if (!this.options.secure) return;
      };
      const onData = (chunk: Buffer | string) => {
        greeting += chunk.toString();
        if (/\r?\n/.test(greeting) || /^\* /m.test(greeting)) {
          cleanup();
          resolve();
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        socket.off("connect", onConnect);
        socket.off("data", onData);
        socket.off("error", onError);
      };

      socket.on("connect", onConnect);
      socket.on("data", onData);
      socket.on("error", onError);
    });

    this.connected = true;
    const login = await this.command(`LOGIN ${imapQuoted(this.options.email)} ${imapQuoted(this.options.password)}`);
    if (!login.ok) {
      throw new Error(`IMAP login failed: ${login.raw.trim()}`);
    }
  }

  async command(commandText: string): Promise<ImapCommandResult> {
    if (!this.socket || !this.connected) {
      throw new Error("IMAP command attempted before connect");
    }
    const tag = `A${String(this.tagCounter++).padStart(4, "0")}`;
    this.socket.write(`${tag} ${commandText}\r\n`);
    const raw = await this.readUntilTagged(tag);
    const status = parseTaggedStatus(tag, raw);
    return {
      ok: status === "OK",
      status,
      raw,
    };
  }

  async listMailboxes() {
    const result = await this.command('LIST "" "*"');
    if (!result.ok) {
      throw new Error(`IMAP LIST failed: ${result.raw.trim()}`);
    }
    return parseListMailboxes(result.raw);
  }

  async examineMailbox(mailboxName: string) {
    if (this.selectedMailbox === mailboxName) return;
    const select = await this.command(`EXAMINE ${imapQuoted(mailboxName)}`);
    if (!select.ok) {
      throw new Error(`IMAP EXAMINE failed for ${mailboxName}: ${select.raw.trim()}`);
    }
    this.selectedMailbox = mailboxName;
  }

  async searchMailbox(mailboxName: string, criteria: string[]) {
    await this.examineMailbox(mailboxName);
    const search = await this.command(`UID SEARCH ${criteria.join(" ")}`);
    if (!search.ok) {
      throw new Error(`IMAP SEARCH failed for ${mailboxName}: ${search.raw.trim()}`);
    }
    return parseSearchUids(search.raw);
  }

  async fetchMailboxMessage(mailboxName: string, uid: number, maxBodyBytes = 16_000) {
    await this.examineMailbox(mailboxName);
    const fetch = await this.command(
      `UID FETCH ${uid} (UID BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT MESSAGE-ID DATE)] BODY.PEEK[TEXT]<0.${Math.max(512, maxBodyBytes)}>)`
    );
    if (!fetch.ok) {
      throw new Error(`IMAP FETCH failed for ${mailboxName} uid ${uid}: ${fetch.raw.trim()}`);
    }
    return parseFetchedMailboxMessage(fetch.raw, mailboxName);
  }

  async close() {
    if (!this.socket) return;
    try {
      if (this.connected) {
        await this.command("LOGOUT");
      }
    } catch {
      // Best effort close.
    }
    this.socket.end();
    this.socket.destroy();
    this.socket = null;
    this.connected = false;
  }
}

export async function listInboxMessages(input: {
  mailbox: ImapMailboxConfig;
  afterUid?: number;
  maxMessages?: number;
  maxBodyBytes?: number;
}) {
  const client = new ImapClient(input.mailbox);
  try {
    await client.connect();
    const mailboxes = await client.listMailboxes();
    const inbox = resolveInboxMailbox(mailboxes)?.name ?? "INBOX";
    const startUid = Math.max(0, Math.round(Number(input.afterUid ?? 0) || 0));
    const uids = await client.searchMailbox(
      inbox,
      startUid > 0 ? ["UID", `${startUid + 1}:*`] : ["ALL"]
    );
    const selectedUids =
      input.maxMessages && input.maxMessages > 0 ? uids.slice(-input.maxMessages) : uids;
    const messages: MailboxFetchedMessage[] = [];
    for (const uid of selectedUids) {
      const fetched = await client.fetchMailboxMessage(inbox, uid, input.maxBodyBytes ?? 16_000);
      if (fetched) messages.push(fetched);
    }
    return messages;
  } finally {
    await client.close();
  }
}

export async function inspectMailboxPlacement(input: {
  mailbox: ImapMailboxConfig;
  fromEmail: string;
  subject: string;
  since?: Date;
}) {
  const client = new ImapClient(input.mailbox);
  try {
    await client.connect();
    const mailboxes = await client.listMailboxes();
    const inbox = resolveInboxMailbox(mailboxes)?.name ?? "INBOX";
    const spam = resolveSpamMailbox(mailboxes)?.name ?? "";
    const allMail = resolveAllMailMailbox(mailboxes)?.name ?? "";
    const since = formatImapSinceDate(input.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000));
    const criteria = [
      "SINCE",
      since,
      "FROM",
      imapQuoted(input.fromEmail),
      "SUBJECT",
      imapQuoted(input.subject),
    ];

    const searchedMailboxes: string[] = [];
    const searchOne = async (mailboxName: string) => {
      if (!mailboxName || searchedMailboxes.includes(mailboxName)) return [];
      searchedMailboxes.push(mailboxName);
      return client.searchMailbox(mailboxName, criteria);
    };

    const inboxUids = await searchOne(inbox);
    if (inboxUids.length) {
      return {
        ok: true,
        placement: "inbox" as const,
        matchedMailbox: inbox,
        matchedUid: inboxUids[inboxUids.length - 1] ?? 0,
        searchedMailboxes,
        error: "",
      };
    }

    const spamUids = await searchOne(spam);
    if (spamUids.length) {
      return {
        ok: true,
        placement: "spam" as const,
        matchedMailbox: spam,
        matchedUid: spamUids[spamUids.length - 1] ?? 0,
        searchedMailboxes,
        error: "",
      };
    }

    const allMailUids = await searchOne(allMail);
    if (allMailUids.length) {
      return {
        ok: true,
        placement: "all_mail_only" as const,
        matchedMailbox: allMail,
        matchedUid: allMailUids[allMailUids.length - 1] ?? 0,
        searchedMailboxes,
        error: "",
      };
    }

    return {
      ok: true,
      placement: "not_found" as const,
      matchedMailbox: "",
      matchedUid: 0,
      searchedMailboxes,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      placement: "error" as const,
      matchedMailbox: "",
      matchedUid: 0,
      searchedMailboxes: [],
      error: error instanceof Error ? error.message : "Mailbox placement check failed",
    };
  } finally {
    await client.close();
  }
}
