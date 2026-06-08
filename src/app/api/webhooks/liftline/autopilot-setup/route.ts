import { NextResponse } from "next/server";
import {
  acceptLiftlineAutopilotSetup,
  isLiftlineAutopilotAuthorized,
  LiftlineAutopilotError,
} from "@/lib/liftline-autopilot";

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isLiftlineAutopilotAuthorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized Liftline webhook." }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const result = await acceptLiftlineAutopilotSetup(payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LiftlineAutopilotError) {
      return NextResponse.json(
        {
          ok: false,
          setupId: "",
          mode: "webhook",
          bridgeStatus: "failed",
          message: error.message,
          backendBrandId: error.backendBrandId,
          proof: error.proof,
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        setupId: "",
        mode: "webhook",
        bridgeStatus: "failed",
        message: error instanceof Error ? error.message : "Liftline setup failed.",
      },
      { status: 500 }
    );
  }
}
