import { getDb, update } from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = await getDb();
  const monitor = db.monitors.find((m) => m.id === id);
  if (!monitor) return Response.json({ error: "Not found" }, { status: 404 });
  const { schema, ...rest } = monitor;
  return Response.json({ monitor: rest, changes: db.changes.filter((c) => c.monitorId === id) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { paused } = await req.json().catch(() => ({}));
  if (typeof paused !== "boolean") return Response.json({ error: "Expected { paused: boolean }" }, { status: 400 });
  const found = await update((db) => {
    const m = db.monitors.find((x) => x.id === id);
    if (m) m.paused = paused;
    return Boolean(m);
  });
  return found ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await update((db) => {
    db.monitors = db.monitors.filter((m) => m.id !== id);
    db.changes = db.changes.filter((c) => c.monitorId !== id);
  });
  return Response.json({ ok: true });
}
