import { randomUUID } from "crypto";
import { diffSnapshots, runCheck, sendWebhook } from "./check";
import { getDb, update } from "./store";
import { FREQUENCIES, type Change } from "./types";

const TICK_MS = 30_000;
const RETRY_MS = 5 * 60_000;
const MAX_CHANGES_PER_MONITOR = 50;

type State = { timer?: NodeJS.Timeout; running: boolean; rerun: boolean };
// Survives dev hot reloads, so only one loop ever runs.
const g = globalThis as typeof globalThis & { __hyperMonitor?: State };
const state: State = (g.__hyperMonitor ??= { running: false, rerun: false });

export function startScheduler() {
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), TICK_MS);
  void tick();
  console.log("[hyper-monitor] scheduler started");
}

/**
 * Runs every due monitor one at a time. Hyperbrowser's free plan allows a
 * single active browser, and sequential runs keep usage predictable.
 */
export async function tick() {
  if (state.running) {
    state.rerun = true;
    return;
  }
  state.running = true;
  try {
    do {
      state.rerun = false;
      const now = Date.now();
      const due = (await getDb()).monitors
        .filter((m) => !m.paused && Date.parse(m.nextRunAt) <= now)
        .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt));
      for (const m of due) await checkOne(m.id);
    } while (state.rerun);
  } finally {
    state.running = false;
  }
}

async function checkOne(id: string) {
  const m = (await getDb()).monitors.find((x) => x.id === id);
  if (!m) return;
  await update((db) => {
    const cur = db.monitors.find((x) => x.id === id);
    if (cur) cur.lastStatus = "pending";
  });

  try {
    const { snapshot, schema } = await runCheck(m);
    const at = new Date().toISOString();
    let change: Change | null = null;
    if (m.snapshot !== null && snapshot !== m.snapshot) {
      change = { id: randomUUID(), monitorId: id, at, webhook: "none", ...diffSnapshots(m.snapshot, snapshot) };
      if (m.webhookUrl) change.webhook = await sendWebhook(m, change);
    }
    await update((db) => {
      const cur = db.monitors.find((x) => x.id === id);
      if (!cur) return; // deleted while checking
      Object.assign(cur, {
        snapshot,
        schema,
        lastCheckedAt: at,
        lastStatus: "ok",
        lastError: null,
        nextRunAt: new Date(Date.now() + FREQUENCIES[cur.frequency]).toISOString(),
      });
      if (change) {
        db.changes.unshift(change);
        const mine = db.changes.filter((c) => c.monitorId === id);
        if (mine.length > MAX_CHANGES_PER_MONITOR) {
          const drop = new Set(mine.slice(MAX_CHANGES_PER_MONITOR).map((c) => c.id));
          db.changes = db.changes.filter((c) => !drop.has(c.id));
        }
      }
    });
  } catch (err) {
    await update((db) => {
      const cur = db.monitors.find((x) => x.id === id);
      if (!cur) return;
      Object.assign(cur, {
        lastCheckedAt: new Date().toISOString(),
        lastStatus: "error",
        lastError: err instanceof Error ? err.message : String(err),
        nextRunAt: new Date(Date.now() + Math.min(RETRY_MS, FREQUENCIES[cur.frequency])).toISOString(),
      });
    });
  }
}
