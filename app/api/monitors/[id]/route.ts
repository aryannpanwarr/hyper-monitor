import { demoEnabled, isOwner } from "@/lib/demo";
import { getDb, update } from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = await getDb();
  const monitor = db.monitors.find((m) => m.id === id);
  if (!monitor) return Response.json({ error: "Not found" }, { status: 404 });
  const { schema, webhookUrl, ...rest } = monitor;
  return Response.json({
    monitor: { ...rest, hasWebhook: Boolean(webhookUrl) },
    changes: db.changes.filter((c) => c.monitorId === id),
  });
}

/** Visitors can manage the demo pages they add, not the owner's. */
async function guard(req: Request, id: string) {
  const m = (await getDb()).monitors.find((x) => x.id === id);
  if (!m) return Response.json({ error: "Not found" }, { status: 404 });
  if (demoEnabled() && m.owner && !isOwner(req)) {
    return Response.json({ error: "Only the owner can change this monitor" }, { status: 403 });
  }
  return null;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const denied = await guard(req, id);
  if (denied) return denied;
  const { paused } = await req.json().catch(() => ({}));
  if (typeof paused !== "boolean") return Response.json({ error: "Expected { paused: boolean }" }, { status: 400 });
  await update((db) => {
    const m = db.monitors.find((x) => x.id === id);
    if (m) m.paused = paused;
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const denied = await guard(req, id);
  if (denied) return denied;
  await update((db) => {
    db.monitors = db.monitors.filter((m) => m.id !== id);
    db.changes = db.changes.filter((c) => c.monitorId !== id);
  });
  return Response.json({ ok: true });
}
