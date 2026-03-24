import { Suspense } from "react";
import OutreachSettingsClient from "./outreach-settings-client";

export default function OutreachSettingsPage() {
  return (
    <Suspense fallback={null}>
      <OutreachSettingsClient />
    </Suspense>
  );
}
