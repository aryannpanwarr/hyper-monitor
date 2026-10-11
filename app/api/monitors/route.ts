import { randomUUID } from "crypto";
import { after } from "next/server";
import { DEMO, demoEnabled, isOwner, publicChecksLeft } from "@/lib/demo";
import { tick } from "@/lib/scheduler";
import { getDb, update } from "@/lib/store";
import { FREQUENCIES, type Frequency, type Monitor } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isHttpUrl = (s: string) => {
  try {
    return ["http:", "https:"].includes(new URL(s).protocol);
  } catch {
    return false;
  }
};

export async function GET(req: Request) {
  const db = await getDb();
  const monitors = db.monitors.map(({ snapshot, schema, webhookUrl, ...m }) => ({
    ...m,
    hasWebhook: Boolean(webhookUrl),
    changes: db.changes.filter((c) => c.monitorId === m.id).length,
    lastChangeAt: db.changes.find((c) => c.monitorId === m.id)?.at ?? null,
  }));
  return Response.json({
    monitors,
    hasKey: Boolean(process.env.HYPERBROWSER_API_KEY),
    demo: {
      enabled: demoEnabled(),
      owner: isOwner(req),
      maxMonitors: DEMO.maxMonitors,
      frequencies: DEMO.frequencies,
      checksLeft: publicChecksLeft(db),
    },
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? "").trim();
  const watch = String(body.watch ?? "").trim();
  const webhookUrl = String(body.webhookUrl ?? "").trim();
  const frequency = body.frequency as Frequency;
  const owner = isOwner(req);
  const limited = demoEnabled() && !owner;

  if (!isHttpUrl(url)) return Response.json({ error: "Enter a full URL starting with http(s)://" }, { status: 400 });
  if (!(frequency in FREQUENCIES)) return Response.json({ error: "Pick how often to check" }, { status: 400 });
  if (webhookUrl && !isHttpUrl(webhookUrl)) return Response.json({ error: "Webhook must be an http(s) URL" }, { status: 400 });
  if (watch.length > 500) return Response.json({ error: "Keep the description under 500 characters" }, { status: 400 });
  if (limited && !DEMO.frequencies.includes(frequency)) {
    return Response.json({ error: "The demo checks every 6 hours or daily" }, { status: 400 });
  }
  if (limited && webhookUrl) return Response.json({ error: "Webhooks are off in the demo" }, { status: 400 });

  const now = new Date();
  const monitor: Monitor = {
    id: randomUUID(),
    url,
    watch,
    frequency,
    webhookUrl,
    paused: false,
    createdAt: now.toISOString(),
    schema: null,
    lastCheckedAt: null,
    nextRunAt: now.toISOString(), // first check (the baseline) runs right away
    lastStatus: "pending",
    pendingSince: null,
    owner: !limited,
    expiresAt: limited ? new Date(now.getTime() + DEMO.ttlMs).toISOString() : null,
    lastError: null,
    snapshot: null,
  };

  const error = await update((db) => {
    if (limited) {
      if (db.monitors.filter((m) => !m.owner).length >= DEMO.maxMonitors) {
        return `The demo is full (${DEMO.maxMonitors} pages). Try again later`;
      }
      if (publicChecksLeft(db) === 0) return "Today's demo checks are used up. Try again tomorrow";
    }
    db.monitors.unshift(monitor);
    return null;
  });
  if (error) return Response.json({ error }, { status: 429 });

  after(() => tick());
  return Response.json({ id: monitor.id }, { status: 201 });
}
