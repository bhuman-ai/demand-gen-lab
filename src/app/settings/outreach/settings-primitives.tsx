"use client";

import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function InfoHint({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group">
      <span
        tabIndex={0}
        aria-label="Field help"
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[color:var(--border)] text-[10px] font-semibold text-[color:var(--muted-foreground)] outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
      >
        ?
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-[130%] z-20 w-72 -translate-x-1/2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1 text-[11px] leading-relaxed text-[color:var(--foreground)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

export function FieldLabel({ htmlFor, label, help }: { htmlFor: string; label: string; help: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      <InfoHint text={help} />
    </div>
  );
}

export function formatRelativeTimeLabel(value: string, fallback = "Never checked") {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;

  const diffMs = parsed.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  if (absMs < 60_000) return "Just now";

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < hour) {
    return formatter.format(Math.round(diffMs / minute), "minute");
  }
  if (absMs < day) {
    return formatter.format(Math.round(diffMs / hour), "hour");
  }
  if (absMs < 7 * day) {
    return formatter.format(Math.round(diffMs / day), "day");
  }
  return parsed.toLocaleDateString();
}

export function SettingsModal({
  open,
  title,
  description,
  children,
  footer,
  panelClassName,
  bodyClassName,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  panelClassName?: string;
  bodyClassName?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const headingId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 px-4 py-6 md:items-center">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 cursor-default"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={description ? descriptionId : undefined}
        className={`relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[0_12px_32px_-16px_color-mix(in_srgb,var(--shadow)_82%,transparent)] ${
          panelClassName ?? ""
        }`}
      >
        <div className="border-b border-[color:var(--border)] px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 id={headingId} className="text-lg font-semibold">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="text-sm text-[color:var(--muted-foreground)]">
                  {description}
                </p>
              ) : null}
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className={`overflow-y-auto px-5 py-5 md:px-6 ${bodyClassName ?? ""}`}>{children}</div>
        {footer ? <div className="border-t border-[color:var(--border)] px-5 py-4 md:px-6">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
