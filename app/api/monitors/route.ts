import { randomUUID } from "crypto";
import { tick } from "@/lib/scheduler";
import { getDb, update } from "@/lib/store";
import { FREQUENCIES, type Frequency, type Monitor } from "@/lib/types";

export const dynamic = "force-dynamic";

const isHttpUrl = (s: string) => {
  try {
    return ["http:", "https:"].includes(new URL(s).protocol);
  } catch {
    return false;
  }
};

export async function GET() {
  const db = await getDb();
  const monitors = db.monitors.map(({ snapshot, schema, ...m }) => ({
    ...m,
    changes: db.changes.filter((c) => c.monitorId === m.id).length,
    lastChangeAt: db.changes.find((c) => c.monitorId === m.id)?.at ?? null,
  }));
  return Response.json({ monitors, hasKey: Boolean(process.env.HYPERBROWSER_API_KEY) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? "").trim();
  const watch = String(body.watch ?? "").trim();
  const webhookUrl = String(body.webhookUrl ?? "").trim();
  const frequency = body.frequency as Frequency;

  if (!isHttpUrl(url)) return Response.json({ error: "Enter a full URL starting with http(s)://" }, { status: 400 });
  if (!(frequency in FREQUENCIES)) return Response.json({ error: "Pick how often to check" }, { status: 400 });
  if (webhookUrl && !isHttpUrl(webhookUrl)) return Response.json({ error: "Webhook must be an http(s) URL" }, { status: 400 });
  if (watch.length > 500) return Response.json({ error: "Keep the description under 500 characters" }, { status: 400 });

  const now = new Date().toISOString();
  const monitor: Monitor = {
    id: randomUUID(),
    url,
    watch,
    frequency,
    webhookUrl,
    paused: false,
    createdAt: now,
    schema: null,
    lastCheckedAt: null,
    nextRunAt: now, // first check (the baseline) runs right away
    lastStatus: "pending",
    lastError: null,
    snapshot: null,
  };
  await update((db) => db.monitors.unshift(monitor));
  void tick();
  return Response.json({ id: monitor.id }, { status: 201 });
}
