"use client";

import { useState } from "react";

type InboxMessage = {
  from: string;
  subject: string;
  sentiment: string;
  status: string;
  receivedAt: string;
};

type Brand = {
  id: string;
  brandName: string;
  inbox?: InboxMessage[];
};

type InboxClientProps = {
  brand: Brand;
};

export default function InboxClient({ brand }: InboxClientProps) {
  const [messages, setMessages] = useState<InboxMessage[]>(brand.inbox ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newMessage, setNewMessage] = useState<InboxMessage>({
    from: "",
    subject: "",
    sentiment: "Neutral",
    status: "New",
    receivedAt: "",
  });

  const persistMessages = async (nextMessages: InboxMessage[]) => {
    const response = await fetch("/api/brands", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: brand.id,
        inbox: nextMessages,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error ?? "Save failed");
    }
    const saved = Array.isArray(data?.brand?.inbox) ? (data.brand.inbox as InboxMessage[]) : [];
    return saved;
  };

  const addMessage = async () => {
    if (!newMessage.subject.trim()) return;
    setSaving(true);
    setError("");
    const nextMessages = [
      { ...newMessage, subject: newMessage.subject.trim(), from: newMessage.from.trim() },
      ...messages,
    ];
    setMessages(nextMessages);
    try {
      const saved = await persistMessages(nextMessages);
      setMessages(saved);
      setNewMessage({ from: "", subject: "", sentiment: "Neutral", status: "New", receivedAt: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const total = messages.length;
  const positive = messages.filter((message) => message.sentiment.toLowerCase() === "positive").length;
  const open = messages.filter((message) => message.status.toLowerCase() === "open").length;

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
      <div className="text-xs text-[color:var(--muted)]">Unified replies</div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {[
          { label: "Total replies", value: total },
          { label: "Positive", value: positive },
          { label: "Open threads", value: open },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-4 py-3"
          >
            <div className="text-[11px] text-[color:var(--muted)]">{item.label}</div>
            <div className="mt-1 text-sm text-[color:var(--foreground)]">{item.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <input
          value={newMessage.from}
          onChange={(event) => setNewMessage((prev) => ({ ...prev, from: event.target.value }))}
          placeholder="From"
          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
        />
        <input
          value={newMessage.subject}
          onChange={(event) => setNewMessage((prev) => ({ ...prev, subject: event.target.value }))}
          placeholder="Subject"
          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
        />
        <input
          value={newMessage.sentiment}
          onChange={(event) => setNewMessage((prev) => ({ ...prev, sentiment: event.target.value }))}
          placeholder="Sentiment"
          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
        />
        <input
          value={newMessage.status}
          onChange={(event) => setNewMessage((prev) => ({ ...prev, status: event.target.value }))}
          placeholder="Status"
          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
        />
        <div className="flex gap-2">
          <input
            value={newMessage.receivedAt}
            onChange={(event) => setNewMessage((prev) => ({ ...prev, receivedAt: event.target.value }))}
            placeholder="Received"
            className="h-9 flex-1 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
          />
          <button
            type="button"
            onClick={addMessage}
            disabled={saving}
            className="rounded-md border border-[color:var(--border)] px-3 text-xs text-[color:var(--foreground)]"
          >
            {saving ? "Saving" : "Add"}
          </button>
        </div>
      </div>
      {error ? <div className="mt-3 text-xs text-[color:var(--danger)]">{error}</div> : null}
      <div className="mt-5 overflow-hidden rounded-md border border-[color:var(--border)]">
        <div className="grid grid-cols-5 bg-[color:var(--background)]/60 text-[11px] text-[color:var(--muted)]">
          {["From", "Subject", "Sentiment", "Status", "Received"].map((label) => (
            <div key={label} className="px-3 py-2">
              {label}
            </div>
          ))}
        </div>
        {messages.map((row, index) => (
          <div key={`${row.subject}-${index}`} className="grid grid-cols-5 text-[11px] text-[color:var(--foreground)]">
            <div className="px-3 py-2">{row.from}</div>
            <div className="px-3 py-2">{row.subject}</div>
            <div className="px-3 py-2">{row.sentiment}</div>
            <div className="px-3 py-2">{row.status}</div>
            <div className="px-3 py-2">{row.receivedAt}</div>
          </div>
        ))}
        {!messages.length ? (
          <div className="px-3 py-3 text-[11px] text-[color:var(--muted)]">No replies yet.</div>
        ) : null}
      </div>
    </div>
  );
}
