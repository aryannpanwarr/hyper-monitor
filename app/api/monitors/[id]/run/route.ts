import { after } from "next/server";
import { DEMO, demoEnabled, isOwner, publicChecksLeft, spendPublicCheck } from "@/lib/demo";
import { tick } from "@/lib/scheduler";
import { update } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STALE_PENDING_MS = 5 * 60_000;

/** "Check now": make the monitor due immediately and wake the scheduler. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const limited = demoEnabled() && !isOwner(req);
  const result = await update((db): [number, string] => {
    const m = db.monitors.find((x) => x.id === id);
    if (!m) return [404, "Not found"];
    if (m.paused) return [409, "Resume the monitor first"];
    if (m.lastStatus === "pending" && m.pendingSince && Date.now() - Date.parse(m.pendingSince) < STALE_PENDING_MS) {
      return [409, "Already checking"];
    }
    if (limited) {
      const since = m.lastCheckedAt ? Date.now() - Date.parse(m.lastCheckedAt) : Infinity;
      if (since < DEMO.checkNowCooldownMs) {
        const mins = Math.ceil((DEMO.checkNowCooldownMs - since) / 60_000);
        return [429, `Checked recently. Try again in ${mins} min`];
      }
      if (publicChecksLeft(db) === 0) return [429, "Today's demo checks are used up. Try again tomorrow"];
      // Visitor monitors spend when the check runs; the owner's spend here.
      if (m.owner) spendPublicCheck(db);
    }
    m.nextRunAt = new Date().toISOString();
    return [200, "ok"];
  });
  const [status, message] = result;
  if (status !== 200) return Response.json({ error: message }, { status });
  after(() => tick());
  return Response.json({ ok: true });
}
