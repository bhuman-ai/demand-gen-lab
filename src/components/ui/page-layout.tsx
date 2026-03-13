import * as React from "react";
import { cn } from "@/lib/utils";

export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
  aside,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: string;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  void eyebrow;

  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-4xl space-y-1.5">
          <h1 className="text-[1.6rem] font-semibold tracking-[-0.05em] text-[color:var(--foreground)] sm:text-[1.8rem]">
            {title}
          </h1>
          {description ? (
            <p className="max-w-[48rem] text-sm leading-6 text-[color:var(--muted-foreground)] sm:text-[0.95rem]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {aside ? <div>{aside}</div> : null}
    </section>
  );
}

export function StatLedger({
  items,
  className,
}: {
  items: Array<{
    label: string;
    value: React.ReactNode;
    detail?: React.ReactNode;
    active?: boolean;
    onClick?: () => void;
  }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-[10px] border border-[color:var(--border)] bg-[color:var(--border)]",
        className
      )}
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-[color:var(--surface)]"
        >
          {item.onClick ? (
            <button
              type="button"
              onClick={item.onClick}
              className={cn(
                "flex min-h-[72px] w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:var(--surface-muted)]",
                item.active ? "bg-[color:var(--surface-muted)]" : ""
              )}
            >
              <div className="min-w-0">
                <div className="text-[12px] text-[color:var(--muted-foreground)]">{item.label}</div>
                {item.detail ? (
                  <div className="mt-1 text-xs leading-5 text-[color:var(--foreground)]">{item.detail}</div>
                ) : null}
              </div>
              <div className="shrink-0 text-xl font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
                {item.value}
              </div>
            </button>
          ) : (
            <div className="flex min-h-[72px] items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[12px] text-[color:var(--muted-foreground)]">{item.label}</div>
                {item.detail ? (
                  <div className="mt-1 text-xs leading-5 text-[color:var(--foreground)]">{item.detail}</div>
                ) : null}
              </div>
              <div className="shrink-0 text-xl font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
                {item.value}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SectionPanel({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn("rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)]", className)}>
      {title || description || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--border)] px-4 py-3">
          <div className="max-w-3xl space-y-1">
            {title ? <h3 className="text-lg font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">{title}</h3> : null}
            {description ? <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn("px-4 py-4", contentClassName)}>{children}</div>
    </section>
  );
}

export function TableShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("overflow-x-auto", className)}>{children}</div>;
}

export function TableHeaderCell({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={cn(
        "pb-3 text-[12px] font-medium text-[color:var(--muted-foreground)]",
        align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      {children}
    </th>
  );
}

export function EmptyState({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-5", className)}>
      <div className="max-w-2xl">
        <div className="text-lg font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">{title}</div>
        <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">{description}</p>
      </div>
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}
