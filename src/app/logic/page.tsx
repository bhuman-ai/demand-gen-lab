"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function LogicPage() {
  const [brandId] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("factory.activeBrandId") || "" : ""
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Logic</CardTitle>
          <CardDescription>Global campaign automation and execution rules.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Badge variant="muted">Active brand context: {brandId || "none selected"}</Badge>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Use this surface for sequencing logic, guardrails, and cross-campaign conditions.
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
        </CardContent>
      </Card>
    </div>
  );
}
