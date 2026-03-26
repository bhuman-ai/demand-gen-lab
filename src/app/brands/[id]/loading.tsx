function LoadingPulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-[14px] bg-[color:var(--surface-muted)] ${className}`} />;
}

export default function BrandRouteLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <LoadingPulse className="h-10 w-48" />
        <LoadingPulse className="h-5 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <LoadingPulse className="h-28 w-full" />
        <LoadingPulse className="h-28 w-full" />
        <LoadingPulse className="h-28 w-full" />
      </div>

      <div className="space-y-4 rounded-[20px] border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
        <LoadingPulse className="h-6 w-40" />
        <LoadingPulse className="h-4 w-72 max-w-full" />
        <div className="grid gap-3">
          <LoadingPulse className="h-16 w-full" />
          <LoadingPulse className="h-16 w-full" />
          <LoadingPulse className="h-16 w-full" />
        </div>
      </div>
    </div>
  );
}
