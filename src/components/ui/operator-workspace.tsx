import Link from "next/link";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

export function OperatorStatusStrip({
  icon,
  badge,
  badgeVariant = "muted",
  title,
  detail,
  meta,
  children,
  className,
}: {
  icon?: ReactNode;
  badge: string;
  badgeVariant?: BadgeVariant;
  title: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const content = (
    <span className="flex min-w-0 items-start gap-3">
      {icon ? (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--surface-muted)] text-[color:var(--muted-foreground)]">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant={badgeVariant}>{badge}</Badge>
          <span className="text-sm font-medium text-[color:var(--foreground)]">{title}</span>
        </span>
        {detail ? <span className="mt-1 block text-xs leading-5 text-[color:var(--muted-foreground)]">{detail}</span> : null}
      </span>
    </span>
  );

  if (children) {
    return (
      <details
        className={cn(
          "mx-auto mt-3 w-full max-w-[52rem] rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3",
          className
        )}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          {content}
          <span className="flex shrink-0 items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
            {meta}
            <ChevronDown className="h-4 w-4" />
          </span>
        </summary>
        <div className="mt-3 border-t border-[color:var(--border)] pt-3">{children}</div>
      </details>
    );
  }

  return (
    <section
      className={cn(
        "mx-auto mt-3 flex w-full max-w-[52rem] items-center justify-between gap-3 rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3",
        className
      )}
    >
      {content}
      {meta ? <span className="shrink-0 text-xs text-[color:var(--muted-foreground)]">{meta}</span> : null}
    </section>
  );
}

export function OperatorDrilldownLink({
  href,
  icon: Icon,
  label,
  detail,
  className,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  detail: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between gap-3 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3 text-sm transition-colors hover:bg-[color:var(--surface-hover)]",
        className
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <Icon className="h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]" />
        <span className="min-w-0">
          <span className="block font-medium text-[color:var(--foreground)]">{label}</span>
          <span className="block truncate text-xs text-[color:var(--muted-foreground)]">{detail}</span>
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]" />
    </Link>
  );
}
