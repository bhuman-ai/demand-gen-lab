"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ExplainableHintProps = {
  label: string;
  title?: string;
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  panelClassName?: string;
};

export function ExplainableHint({
  label,
  title,
  children,
  align = "left",
  className,
  panelClassName,
}: ExplainableHintProps) {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const rootRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={cn("relative inline-flex shrink-0", className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors",
          "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)]",
          "hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--background)]",
          open ? "border-[color:var(--border-strong)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)]" : ""
        )}
      >
        ?
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className={cn(
            "absolute top-full z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-[12px] border border-[color:var(--border-strong)] bg-[color:var(--surface)] p-3 shadow-[0_18px_50px_-26px_color-mix(in_srgb,var(--shadow)_86%,transparent)]",
            align === "left" ? "left-0" : "",
            align === "right" ? "right-0" : "",
            align === "center" ? "left-1/2 -translate-x-1/2" : "",
            panelClassName
          )}
        >
          <div className="space-y-2">
            {title ? (
              <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                {title}
              </div>
            ) : null}
            <div className="space-y-2 text-[13px] leading-6 text-[color:var(--foreground)]">{children}</div>
          </div>
        </div>
      ) : null}
    </span>
  );
}
