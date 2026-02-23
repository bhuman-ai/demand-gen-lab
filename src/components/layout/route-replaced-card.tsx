"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/telemetry-client";

type RouteReplacedCardProps = {
  title: string;
  description: string;
  brandId: string;
};

export default function RouteReplacedCard({
  title,
  description,
  brandId,
}: RouteReplacedCardProps) {
  const pathname = usePathname();

  useEffect(() => {
    trackEvent("route_replaced_viewed", { pathname, brandId });
  }, [pathname, brandId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/brands/${brandId}/experiments`}>Open Experiments</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/brands/${brandId}/campaigns`}>Open Campaigns</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
