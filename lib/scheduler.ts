import { randomUUID } from "crypto";
import { diffSnapshots, runCheck, sendWebhook } from "./check";
import { demoEnabled, nextUtcMidnight, spendPublicCheck } from "./demo";
import { getDb, tryTickLock, update } from "./store";
import { FREQUENCIES, type Change } from "./types";

const TICK_MS = 30_000;
const RETRY_MS = 5 * 60_000;
const MAX_CHANGES_PER_MONITOR = 50;
/** Default time budget for one tick; serverless functions must finish in time. */
const DEFAULT_BUDGET_MS = 4 * 60_000;

type State = { timer?: NodeJS.Timeout; running: boolean };
// Survives dev hot reloads, so only one loop ever runs per process.
const g = globalThis as typeof globalThis & { __hyperMonitor?: State };
const state: State = (g.__hyperMonitor ??= { running: false });

/** Long-running servers (npm start) poll on a timer. Vercel uses /api/cron instead. */
export function startScheduler() {
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), TICK_MS);
  void tick();
  console.log("[hyper-monitor] scheduler started");
}

/**
 * Runs every due monitor one at a time until the time budget is used up.
 * Hyperbrowser's free plan allows a single active browser, and sequential
 * runs keep usage predictable.
 */
export async function tick({ budgetMs = DEFAULT_BUDGET_MS } = {}) {
  if (state.running) return; // the running tick picks up new due monitors
  state.running = true;
  const release = await tryTickLock(budgetMs + 60_000).catch(() => null);
  if (!release) {
    state.running = false;
    return;
  }
  const start = Date.now();
  try {
    await removeExpired();
    // Pick the most overdue monitor each time, so "Check now" requests made
    // while this runs are picked up too. Anything left waits for the next tick.
    while (Date.now() - start < budgetMs) {
      const now = Date.now();
      const next = (await getDb()).monitors
        .filter((m) => !m.paused && Date.parse(m.nextRunAt) <= now)
        .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))[0];
      if (!next) break;
      await checkOne(next.id);
    }
  } finally {
    state.running = false;
    await release();
  }
}

async function removeExpired() {
  const now = Date.now();
  await update((db) => {
    const expired = new Set(
      db.monitors.filter((m) => m.expiresAt && Date.parse(m.expiresAt) <= now).map((m) => m.id),
    );
    if (!expired.size) return;
    db.monitors = db.monitors.filter((m) => !expired.has(m.id));
    db.changes = db.changes.filter((c) => !expired.has(c.monitorId));
  });
}

async function checkOne(id: string) {
  // Claim the check; visitor monitors also spend from the daily demo budget.
  const m = await update((db) => {
    const cur = db.monitors.find((x) => x.id === id);
    if (!cur) return null;
    if (demoEnabled() && !cur.owner && !spendPublicCheck(db)) {
      Object.assign(cur, {
        lastStatus: "error",
        pendingSince: null,
        lastError: "Today's demo checks are used up. Next check after midnight UTC",
        nextRunAt: nextUtcMidnight(),
      });
      return null;
    }
    cur.lastStatus = "pending";
    cur.pendingSince = new Date().toISOString();
    return { ...cur };
  });
  if (!m) return;

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
        pendingSince: null,
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
        pendingSince: null,
        lastError: err instanceof Error ? err.message : String(err),
        nextRunAt: new Date(Date.now() + Math.min(RETRY_MS, FREQUENCIES[cur.frequency])).toISOString(),
      });
    });
  }
}
