"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageIntro, SectionPanel } from "@/components/ui/page-layout";

export default function DoctorPage() {
  const [brandId] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("factory.activeBrandId") || "" : ""
  );

  return (
    <div className="space-y-8">
      <PageIntro
        eyebrow="System / doctor"
        title="Inspect delivery quality and failure points before they compound."
        description="Diagnostics belong inside the same product as campaigns and inbox, not in a separate tab that loses the operating context."
      />

      <SectionPanel title="Diagnostic desk" description="Recommended fixes and the current active brand context.">
        <div className="space-y-3">
          <Badge variant="muted">Active brand context: {brandId || "none selected"}</Badge>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Monitor delivery quality, response shifts, and conversion bottlenecks.
          </p>
          {brandId ? (
            <Button asChild>
              <Link href={`/brands/${brandId}/inbox`}>Open Active Brand Inbox</Link>
            </Button>
          ) : (
            <Button asChild>
              <Link href="/brands">Select Brand</Link>
            </Button>
          )}
        </div>
      </SectionPanel>
    </div>
  );
}
