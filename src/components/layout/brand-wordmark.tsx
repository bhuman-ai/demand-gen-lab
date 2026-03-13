import { cn } from "@/lib/utils";

type BrandWordmarkProps = {
  className?: string;
  lastClassName?: string;
  b2bClassName?: string;
  animated?: boolean;
  showTrail?: boolean;
};

export default function BrandWordmark({
  className,
  lastClassName,
  b2bClassName,
  animated = false,
  showTrail = true,
}: BrandWordmarkProps) {
  return (
    <span
      aria-label="last b2b"
      className={cn("brand-wordmark", showTrail ? "brand-wordmark--trail" : "", className)}
      data-animated={animated ? "true" : "false"}
    >
      <span className={cn("brand-wordmark__last", lastClassName)}>last</span>
      <span className={cn("brand-wordmark__b2b", b2bClassName)}>b2b</span>
    </span>
  );
}
