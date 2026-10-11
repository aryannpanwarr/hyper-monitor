import { timingSafeEqual } from "crypto";
import type { Db, Frequency } from "./types";

/**
 * Public demo mode turns on when OWNER_KEY is set (e.g. on Vercel). Visitors
 * can try the app on the owner's Hyperbrowser key within these limits; the
 * owner (requests carrying the key) is not limited.
 */
export const DEMO = {
  maxMonitors: 5,
  ttlMs: 24 * 60 * 60_000,
  dailyChecks: 50,
  frequencies: ["6h", "1d"] as Frequency[],
  checkNowCooldownMs: 10 * 60_000,
};

export const demoEnabled = () => Boolean(process.env.OWNER_KEY);

export function isOwner(req: Request): boolean {
  const ownerKey = process.env.OWNER_KEY;
  if (!ownerKey) return true;
  const given = req.headers.get("x-owner-key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(ownerKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

const today = () => new Date().toISOString().slice(0, 10);

export function publicChecksLeft(db: Db): number {
  const used = db.usage.day === today() ? db.usage.publicChecks : 0;
  return Math.max(0, DEMO.dailyChecks - used);
}

/** Spend one visitor check from today's budget. Returns false if none left. */
export function spendPublicCheck(db: Db): boolean {
  if (db.usage.day !== today()) db.usage = { day: today(), publicChecks: 0 };
  if (db.usage.publicChecks >= DEMO.dailyChecks) return false;
  db.usage.publicChecks += 1;
  return true;
}

export function nextUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}
