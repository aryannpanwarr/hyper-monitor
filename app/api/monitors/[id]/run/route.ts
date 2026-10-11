import { tick } from "@/lib/scheduler";
import { update } from "@/lib/store";

export const dynamic = "force-dynamic";

/** "Check now": make the monitor due immediately and wake the scheduler. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const status = await update((db) => {
    const m = db.monitors.find((x) => x.id === id);
    if (!m) return 404;
    if (m.paused) return 409;
    m.nextRunAt = new Date().toISOString();
    return 200;
  });
  if (status !== 200) {
    return Response.json({ error: status === 404 ? "Not found" : "Resume the monitor first" }, { status });
  }
  void tick();
  return Response.json({ ok: true });
}
