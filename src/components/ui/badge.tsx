import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
  {
    variants: {
      variant: {
        default: "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)]",
        muted: "border-[color:var(--border)] text-[color:var(--muted-foreground)]",
        success: "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]",
        danger: "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
        accent: "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] text-[color:var(--accent)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
