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
  cleanup: MailboxPlacementCleanupResult;
};

export type MailboxPlacementCleanupResult = {
  attempted: boolean;
  ok: boolean;
  actions: string[];
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

function resolveSentMailbox(mailboxes: ImapMailbox[]) {
  return (
    mailboxByAttribute(mailboxes, ["\\Sent"]) ??
    mailboxByName(mailboxes, /(^|\/)(sent|sent mail)$/i)
  );
}

function normalizeMailboxSubject(value: string) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

class ImapClient {
  private socket: tls.TLSSocket | net.Socket | null = null;
  private connected = false;
  private tagCounter = 1;
  private selectedMailbox = "";
  private selectedMailboxReadOnly = true;

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

  async selectMailbox(mailboxName: string, readOnly: boolean) {
    if (this.selectedMailbox === mailboxName && this.selectedMailboxReadOnly === readOnly) return;
    const select = await this.command(`${readOnly ? "EXAMINE" : "SELECT"} ${imapQuoted(mailboxName)}`);
    if (!select.ok) {
      throw new Error(`IMAP ${readOnly ? "EXAMINE" : "SELECT"} failed for ${mailboxName}: ${select.raw.trim()}`);
    }
    this.selectedMailbox = mailboxName;
    this.selectedMailboxReadOnly = readOnly;
  }

  async examineMailbox(mailboxName: string) {
    return this.selectMailbox(mailboxName, true);
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

  async moveMailboxMessage(mailboxName: string, uid: number, destinationMailbox: string) {
    await this.selectMailbox(mailboxName, false);
    const move = await this.command(`UID MOVE ${Math.round(uid)} ${imapQuoted(destinationMailbox)}`);
    if (!move.ok) {
      throw new Error(`IMAP MOVE failed for ${mailboxName} uid ${uid}: ${move.raw.trim()}`);
    }
  }

  async addGmailLabels(mailboxName: string, uid: number, labels: string[]) {
    if (!labels.length) return;
    await this.selectMailbox(mailboxName, false);
    const store = await this.command(`UID STORE ${Math.round(uid)} +X-GM-LABELS (${labels.join(" ")})`);
    if (!store.ok) {
      throw new Error(`Gmail label add failed for ${mailboxName} uid ${uid}: ${store.raw.trim()}`);
    }
  }

  async removeGmailLabels(mailboxName: string, uid: number, labels: string[]) {
    if (!labels.length) return;
    await this.selectMailbox(mailboxName, false);
    const store = await this.command(`UID STORE ${Math.round(uid)} -X-GM-LABELS (${labels.join(" ")})`);
    if (!store.ok) {
      throw new Error(`Gmail label remove failed for ${mailboxName} uid ${uid}: ${store.raw.trim()}`);
    }
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

const NO_MAILBOX_CLEANUP: MailboxPlacementCleanupResult = {
  attempted: false,
  ok: true,
  actions: [],
  error: "",
};

function isGmailImapHost(host: string) {
  return /(^|\.)(gmail|googlemail)\.com$/i.test(host.trim());
}

async function cleanupMatchedPlacement(input: {
  client: ImapClient;
  mailbox: ImapMailboxConfig;
  placement: MailboxPlacementVerdict;
  matchedMailbox: string;
  matchedUid: number;
  inboxMailbox: string;
  archiveMailbox: string;
  moveSpamToInbox: boolean;
  archiveInboxHits: boolean;
}) {
  if (!input.matchedMailbox || !input.matchedUid) return NO_MAILBOX_CLEANUP;

  const actions: string[] = [];
  try {
    if (input.placement === "spam" && input.moveSpamToInbox) {
      if (isGmailImapHost(input.mailbox.host)) {
        await input.client.addGmailLabels(input.matchedMailbox, input.matchedUid, ["\\Inbox"]);
        await input.client.removeGmailLabels(input.matchedMailbox, input.matchedUid, ["\\Spam"]);
      } else {
        await input.client.moveMailboxMessage(input.matchedMailbox, input.matchedUid, input.inboxMailbox);
      }
      actions.push("moved_spam_to_inbox");
      return { attempted: true, ok: true, actions, error: "" };
    }

    if (input.placement === "inbox" && input.archiveInboxHits) {
      if (isGmailImapHost(input.mailbox.host)) {
        await input.client.removeGmailLabels(input.matchedMailbox, input.matchedUid, ["\\Inbox"]);
      } else if (input.archiveMailbox && input.archiveMailbox !== input.matchedMailbox) {
        await input.client.moveMailboxMessage(input.matchedMailbox, input.matchedUid, input.archiveMailbox);
      } else {
        return {
          attempted: false,
          ok: true,
          actions,
          error: "No archive mailbox was available",
        };
      }
      actions.push("archived_inbox_hit");
      return { attempted: true, ok: true, actions, error: "" };
    }

    return NO_MAILBOX_CLEANUP;
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      actions,
      error: error instanceof Error ? error.message : "Mailbox cleanup failed",
    };
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

export async function verifySentMailboxMessage(input: {
  mailbox: ImapMailboxConfig;
  recipient: string;
  subject: string;
  since?: Date;
  maxCandidates?: number;
}) {
  const client = new ImapClient(input.mailbox);
  try {
    await client.connect();
    const mailboxes = await client.listMailboxes();
    const sent = resolveSentMailbox(mailboxes)?.name ?? "";
    if (!sent) {
      return {
        ok: false,
        found: false,
        matchedMailbox: "",
        matchedUid: 0,
        error: "No sent mailbox was available",
      };
    }

    const since = formatImapSinceDate(input.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000));
    const uids = await client.searchMailbox(sent, [
      "SINCE",
      since,
      "TO",
      imapQuoted(input.recipient),
    ]);
    const expectedSubject = normalizeMailboxSubject(input.subject);
    const candidateLimit = Math.max(1, Math.min(25, Math.round(Number(input.maxCandidates ?? 10) || 10)));
    const candidates = uids.slice(-candidateLimit).reverse();

    for (const uid of candidates) {
      const message = await client.fetchMailboxMessage(sent, uid, 4_000);
      const candidateSubject = normalizeMailboxSubject(message?.subject ?? "");
      if (message && candidateSubject === expectedSubject) {
        return {
          ok: true,
          found: true,
          matchedMailbox: sent,
          matchedUid: uid,
          error: "",
        };
      }
    }

    return {
      ok: true,
      found: false,
      matchedMailbox: "",
      matchedUid: 0,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      found: false,
      matchedMailbox: "",
      matchedUid: 0,
      error: error instanceof Error ? error.message : "Sent mailbox verification failed",
    };
  } finally {
    await client.close();
  }
}

export async function inspectMailboxPlacement(input: {
  mailbox: ImapMailboxConfig;
  fromEmail: string;
  subject: string;
  since?: Date;
  cleanup?: {
    archiveInboxHits?: boolean;
    moveSpamToInbox?: boolean;
  };
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
      const matchedUid = inboxUids[inboxUids.length - 1] ?? 0;
      return {
        ok: true,
        placement: "inbox" as const,
        matchedMailbox: inbox,
        matchedUid,
        searchedMailboxes,
        error: "",
        cleanup: await cleanupMatchedPlacement({
          client,
          mailbox: input.mailbox,
          placement: "inbox",
          matchedMailbox: inbox,
          matchedUid,
          inboxMailbox: inbox,
          archiveMailbox: allMail,
          archiveInboxHits: input.cleanup?.archiveInboxHits === true,
          moveSpamToInbox: input.cleanup?.moveSpamToInbox === true,
        }),
      };
    }

    const spamUids = await searchOne(spam);
    if (spamUids.length) {
      const matchedUid = spamUids[spamUids.length - 1] ?? 0;
      return {
        ok: true,
        placement: "spam" as const,
        matchedMailbox: spam,
        matchedUid,
        searchedMailboxes,
        error: "",
        cleanup: await cleanupMatchedPlacement({
          client,
          mailbox: input.mailbox,
          placement: "spam",
          matchedMailbox: spam,
          matchedUid,
          inboxMailbox: inbox,
          archiveMailbox: allMail,
          archiveInboxHits: input.cleanup?.archiveInboxHits === true,
          moveSpamToInbox: input.cleanup?.moveSpamToInbox === true,
        }),
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
        cleanup: NO_MAILBOX_CLEANUP,
      };
    }

    return {
      ok: true,
      placement: "not_found" as const,
      matchedMailbox: "",
      matchedUid: 0,
      searchedMailboxes,
      error: "",
      cleanup: NO_MAILBOX_CLEANUP,
    };
  } catch (error) {
    return {
      ok: false,
      placement: "error" as const,
      matchedMailbox: "",
      matchedUid: 0,
      searchedMailboxes: [],
      error: error instanceof Error ? error.message : "Mailbox placement check failed",
      cleanup: NO_MAILBOX_CLEANUP,
    };
  } finally {
    await client.close();
  }
}
