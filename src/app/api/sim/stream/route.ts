import { collections } from "@/lib/db";
import { executeTickAndPersist, getOrInitSimState } from "@/lib/sim-runner";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      closed = true;
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const state = await getOrInitSimState();
      send(controller, { type: "status", status: state.status, simDate: state.simDate });

      const loop = async () => {
        if (closed) return;
        try {
          const { simState } = await collections();
          const current = await simState.findOne({ _id: "singleton" });
          if (!current || current.status !== "RUNNING") {
            send(controller, { type: "status", status: current?.status ?? "IDLE", simDate: current?.simDate });
            timeoutId = setTimeout(loop, 2000);
            return;
          }
          const result = await executeTickAndPersist();
          const updated = (await simState.findOne({ _id: "singleton" })) ?? current;
          send(controller, {
            type: "tick",
            simDate: updated.simDate,
            newEvents: result.newEvents,
            newPOsCount: result.newPOs.length,
            grCount: result.newLots.length,
          });
          const intervalMs = Math.max(50, Math.round(1000 / current.speedMultiplier));
          timeoutId = setTimeout(loop, intervalMs);
        } catch (err) {
          send(controller, { type: "error", message: String(err) });
          timeoutId = setTimeout(loop, 3000);
        }
      };

      loop();
    },
    cancel() {
      closed = true;
      if (timeoutId) clearTimeout(timeoutId);
      collections().then(({ simState }) => {
        simState.updateOne({ _id: "singleton" }, { $set: { status: "PAUSED" } });
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
