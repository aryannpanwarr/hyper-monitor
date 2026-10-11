"use client";

import { ago } from "./format";
import type { Frequency, Monitor } from "./types";

export type Demo = {
  enabled: boolean;
  owner: boolean;
  maxMonitors: number;
  frequencies: Frequency[];
  checksLeft: number;
};

export type PublicMonitor = Omit<Monitor, "snapshot" | "schema" | "webhookUrl"> & { hasWebhook: boolean };

const STORAGE_KEY = "hyper-monitor-owner-key";

/**
 * The owner opens the site once with ?key=OWNER_KEY; it's kept in this
 * browser and sent with every request, then removed from the address bar.
 */
function ownerKey(): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("key");
  try {
    if (fromUrl) {
      localStorage.setItem(STORAGE_KEY, fromUrl);
      url.searchParams.delete("key");
      window.history.replaceState(null, "", url.toString());
    }
    return localStorage.getItem(STORAGE_KEY) ?? fromUrl ?? "";
  } catch {
    return fromUrl ?? "";
  }
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: {
      "x-owner-key": ownerKey(),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export const isChecking = (m: Pick<Monitor, "lastStatus" | "pendingSince">) =>
  m.lastStatus === "pending" && (!m.pendingSince || Date.now() - Date.parse(m.pendingSince) < 5 * 60_000);

export function statusText(m: Pick<Monitor, "lastStatus" | "pendingSince" | "lastCheckedAt">) {
  if (m.lastStatus === "pending" && !m.pendingSince) return "queued";
  if (isChecking(m)) return "checking…";
  return `checked ${ago(m.lastCheckedAt)}`;
}
