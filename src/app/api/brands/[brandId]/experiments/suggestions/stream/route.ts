import type { ExperimentSuggestionStreamEvent } from "@/lib/factory-types";
import {
  generateExperimentSuggestionResult,
  serializeSuggestionGenerationError,
} from "@/lib/experiment-suggestion-tournament";

function encodeEvent(encoder: TextEncoder, event: ExperimentSuggestionStreamEvent) {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { refresh?: boolean };
  const refresh = Boolean(body.refresh);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      const enqueue = (event: ExperimentSuggestionStreamEvent) => {
        if (closed || request.signal.aborted) return;
        controller.enqueue(encodeEvent(encoder, event));
      };

      void (async () => {
        try {
          const result = await generateExperimentSuggestionResult({
            brandId,
            refresh,
            signal: request.signal,
            onEvent: async (event) => {
              enqueue(event);
            },
          });
          enqueue({ type: "done", result });
        } catch (error) {
          if (!request.signal.aborted) {
            const payload = serializeSuggestionGenerationError(error);
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
