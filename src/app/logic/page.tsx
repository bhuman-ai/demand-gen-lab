"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageIntro, SectionPanel } from "@/components/ui/page-layout";

export default function LogicPage() {
  const [brandId] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("factory.activeBrandId") || "" : ""
  );

  return (
    <div className="space-y-8">
      <PageIntro
        eyebrow="System / logic"
        title="Keep automation rules close to the work they govern."
        description="Sequencing rules, guardrails, and campaign conditions should feel like part of the operating desk, not a detached utility panel."
      />

      <SectionPanel title="Logic desk" description="Automation rules and the current active brand context.">
        <div className="space-y-3">
          <Badge variant="muted">Active brand context: {brandId || "none selected"}</Badge>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Use this tool surface for sequencing rules, guardrails, and cross-campaign conditions.
          </p>
          {brandId ? (
            <Button asChild>
              <Link href={`/brands/${brandId}/campaigns`}>Open Active Brand Campaigns</Link>
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
