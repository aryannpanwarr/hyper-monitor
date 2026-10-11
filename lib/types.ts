export const FREQUENCIES = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
} as const;

export type Frequency = keyof typeof FREQUENCIES;

export type Monitor = {
  id: string;
  url: string;
  /** Plain-English focus, e.g. "prices of every plan". Empty = whole page. */
  watch: string;
  frequency: Frequency;
  webhookUrl: string;
  paused: boolean;
  createdAt: string;
  /** JSON Schema locked after the first extract so later runs keep the same shape. */
  schema: object | null;
  lastCheckedAt: string | null;
  nextRunAt: string;
  lastStatus: "ok" | "error" | "pending";
  /** When the current check started; a stale "pending" (killed function) can be retried. */
  pendingSince: string | null;
  /** Created by the owner (no demo limits) or by a visitor. */
  owner: boolean;
  /** Visitor monitors are removed after this time. */
  expiresAt: string | null;
  lastError: string | null;
  /** Normalised text of the latest successful check. */
  snapshot: string | null;
};

export type Change = {
  id: string;
  monitorId: string;
  at: string;
  added: number;
  removed: number;
  /** Line diff: each part is added, removed or unchanged context. */
  parts: { kind: "add" | "remove" | "same"; text: string }[];
  webhook: "sent" | "failed" | "none";
};

export type Db = {
  monitors: Monitor[];
  changes: Change[];
  /** Visitor checks per UTC day, for the demo budget. */
  usage: { day: string; publicChecks: number };
};
