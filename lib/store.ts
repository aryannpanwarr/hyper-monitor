import { promises as fs } from "fs";
import path from "path";
import type { Change, Monitor } from "./types";

type Db = { monitors: Monitor[]; changes: Change[] };

const DB_PATH = path.join(process.env.HYPER_MONITOR_DATA_DIR || path.join(process.cwd(), "data"), "db.json");

// One writer at a time: every mutation is chained onto this promise. Kept on
// globalThis because Next.js may load this module in more than one bundle.
const g = globalThis as typeof globalThis & { __hyperMonitorDb?: Promise<unknown> };

async function read(): Promise<Db> {
  try {
    return JSON.parse(await fs.readFile(DB_PATH, "utf8"));
  } catch {
    return { monitors: [], changes: [] };
  }
}

async function write(db: Db) {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, DB_PATH);
}

export function getDb(): Promise<Db> {
  return read();
}

export function update<T>(fn: (db: Db) => T): Promise<T> {
  const next = (g.__hyperMonitorDb ?? Promise.resolve()).then(async () => {
    const db = await read();
    const result = fn(db);
    await write(db);
    return result;
  });
  g.__hyperMonitorDb = next.catch(() => undefined);
  return next;
}
