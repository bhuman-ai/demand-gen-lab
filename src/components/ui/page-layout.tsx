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
  title: string;
  description?: string;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_22rem] xl:gap-8", className)}>
      <div className="space-y-5">
        {eyebrow ? <div className="text-[12px] text-[color:var(--muted-foreground)]">{eyebrow}</div> : null}
        <div className="max-w-4xl">
          <h2 className="font-[family:var(--font-brand)] text-[clamp(2.35rem,5vw,4.75rem)] leading-[0.93] tracking-[-0.08em] text-[color:var(--foreground)]">
            {title}
          </h2>
          {description ? (
            <p className="mt-4 max-w-[44rem] text-[1.03rem] leading-8 text-[color:var(--muted-foreground)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
      {aside ? <div>{aside}</div> : null}
    </section>
  );
}

export function StatLedger({
  items,
  className,
}: {
  items: Array<{ label: string; value: React.ReactNode; detail?: React.ReactNode }>;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)]", className)}>
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn("grid gap-2 px-5 py-4", index < items.length - 1 ? "border-b border-[color:var(--border)]" : "")}
        >
          <div className="flex items-end justify-between gap-4">
            <div className="text-sm text-[color:var(--muted-foreground)]">{item.label}</div>
            <div className="font-[family:var(--font-brand)] text-[2rem] leading-none tracking-[-0.07em] text-[color:var(--foreground)]">
              {item.value}
            </div>
          </div>
          {item.detail ? <div className="text-sm leading-6 text-[color:var(--foreground)]">{item.detail}</div> : null}
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
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--border)] px-5 py-4">
          <div className="max-w-3xl space-y-1">
            {title ? <h3 className="text-lg font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">{title}</h3> : null}
            {description ? <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn("px-5 py-5", contentClassName)}>{children}</div>
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
    <section className={cn("rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-6", className)}>
      <div className="max-w-2xl">
        <div className="text-lg font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">{title}</div>
        <p className="mt-2 text-sm leading-7 text-[color:var(--muted-foreground)]">{description}</p>
      </div>
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}
