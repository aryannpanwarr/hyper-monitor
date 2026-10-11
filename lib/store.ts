import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { Redis } from "@upstash/redis";
import type { Db } from "./types";

/**
 * Locally the data lives in data/db.json. On Vercel (no persistent disk) it
 * lives in Upstash Redis, configured by the KV_* or UPSTASH_* env vars that
 * the Vercel integration adds.
 */
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

const KEY = "hyper-monitor:db";
const LOCK = "hyper-monitor:lock";
const DB_PATH = path.join(process.env.HYPER_MONITOR_DATA_DIR || path.join(process.cwd(), "data"), "db.json");

const empty = (): Db => ({ monitors: [], changes: [], usage: { day: "", publicChecks: 0 } });

/** Fills in fields added after a monitor was saved, so older data keeps working. */
function withDefaults(raw: Partial<Db> | null): Db {
  const db = { ...empty(), ...(raw ?? {}) };
  db.monitors = db.monitors.map((m) => ({
    ...m,
    owner: m.owner ?? true,
    pendingSince: m.pendingSince ?? null,
    expiresAt: m.expiresAt ?? null,
  }));
  return db;
}

async function read(): Promise<Db> {
  if (redis) return withDefaults(await redis.get<Db>(KEY));
  try {
    return withDefaults(JSON.parse(await fs.readFile(DB_PATH, "utf8")));
  } catch {
    return empty();
  }
}

async function write(db: Db) {
  if (redis) {
    await redis.set(KEY, db);
    return;
  }
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, DB_PATH);
}

/** Serverless instances don't share memory, so writers take a short Redis lock. */
async function withRedisLock<T>(fn: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const deadline = Date.now() + 10_000;
  while (!(await redis!.set(LOCK, token, { nx: true, px: 10_000 }))) {
    if (Date.now() > deadline) throw new Error("Storage is busy, try again");
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    return await fn();
  } finally {
    if ((await redis!.get(LOCK)) === token) await redis!.del(LOCK);
  }
}

// Within one process, writers queue on this promise. Kept on globalThis
// because Next.js may load this module in more than one bundle.
const g = globalThis as typeof globalThis & { __hyperMonitorDb?: Promise<unknown> };

export function getDb(): Promise<Db> {
  return read();
}

export function update<T>(fn: (db: Db) => T): Promise<T> {
  const run = async () => {
    const db = await read();
    const result = fn(db);
    await write(db);
    return result;
  };
  const next = (g.__hyperMonitorDb ?? Promise.resolve()).then(() => (redis ? withRedisLock(run) : run()));
  g.__hyperMonitorDb = next.catch(() => undefined);
  return next;
}

/**
 * Lets only one scheduler run at a time across serverless instances.
 * Returns a release function, or null if another run holds it.
 * Locally there's a single process, which guards itself.
 */
export async function tryTickLock(ttlMs: number): Promise<(() => Promise<void>) | null> {
  if (!redis) return async () => {};
  const key = "hyper-monitor:tick";
  const token = randomUUID();
  if (!(await redis.set(key, token, { nx: true, px: ttlMs }))) return null;
  return async () => {
    if ((await redis.get(key)) === token) await redis.del(key);
  };
}
