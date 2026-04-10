import type {
  OutreachFlowTournamentInput,
  OutreachFlowTournamentStreamEvent,
} from "@/lib/factory-types";
import { saveOutreachFlowResult } from "@/lib/outreach-flow-result-data";
import {
  runOutreachFlowTournament,
  serializeOutreachFlowTournamentError,
} from "@/lib/outreach-flow-tournament";

export const runtime = "nodejs";

function encodeEvent(encoder: TextEncoder, event: OutreachFlowTournamentStreamEvent) {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as OutreachFlowTournamentInput;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      const enqueue = (event: OutreachFlowTournamentStreamEvent) => {
        if (closed || request.signal.aborted) return;
        controller.enqueue(encodeEvent(encoder, event));
      };

      void (async () => {
        try {
          const tournament = await runOutreachFlowTournament({
            brandId,
            brief: body,
            signal: request.signal,
            onEvent: async (event) => {
              enqueue(event);
            },
          });
          await saveOutreachFlowResult({
            brandId,
            brief: tournament.brief,
            result: tournament.result,
          });
          enqueue({ type: "done", brief: tournament.brief, result: tournament.result });
        } catch (error) {
          if (!request.signal.aborted) {
            const payload = serializeOutreachFlowTournamentError(error);
            enqueue({
              type: "error",
              message: payload.error,
              hint: payload.hint,
              debug: payload.debug,
            });
          }
        } finally {
          close();
        }
      })();

      request.signal.addEventListener(
        "abort",
        () => {
          close();
        },
        { once: true }
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
