"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ago, FREQUENCY_LABELS, shortUrl, until } from "@/lib/format";
import type { Frequency, Monitor } from "@/lib/types";

type Row = Omit<Monitor, "snapshot" | "schema"> & { changes: number; lastChangeAt: string | null };

export default function Home() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const [url, setUrl] = useState("");
  const [watch, setWatch] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("1h");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/monitors", { cache: "no-store" });
    const data = await res.json();
    setRows(data.monitors);
    setHasKey(data.hasKey);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/monitors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, watch, frequency, webhookUrl }),
    });
    setBusy(false);
    if (!res.ok) return setError((await res.json()).error ?? "Something went wrong");
    setUrl("");
    setWatch("");
    setWebhookUrl("");
    void load();
  }

  async function act(id: string, action: "run" | "pause" | "resume" | "delete") {
    if (action === "delete" && !confirm("Delete this monitor and its history?")) return;
    if (action === "run") await fetch(`/api/monitors/${id}/run`, { method: "POST" });
    else if (action === "delete") await fetch(`/api/monitors/${id}`, { method: "DELETE" });
    else
      await fetch(`/api/monitors/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: action === "pause" }),
      });
    void load();
  }

  return (
    <>
      <h1>Hyper Monitor</h1>
      <p className="sub">Check any page on a schedule and see exactly what changed.</p>

      {!hasKey && (
        <div className="note err">
          Add <code>HYPERBROWSER_API_KEY</code> to <code>.env.local</code> and restart to start checking.
        </div>
      )}

      <form className="card" onSubmit={create}>
        <label>
          Page
          <input
            type="url"
            required
            placeholder="https://example.com/pricing"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label>
          <div>
            What to watch <span>· optional</span>
          </div>
          <input
            placeholder="e.g. the price of every plan. Leave empty to watch the whole page"
            value={watch}
            onChange={(e) => setWatch(e.target.value)}
          />
        </label>
        <label>
          Check every
          <div className="seg" role="group">
            {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => (
              <button
                type="button"
                key={f}
                className={f === frequency ? "on" : ""}
                aria-pressed={f === frequency}
                onClick={() => setFrequency(f)}
              >
                {FREQUENCY_LABELS[f]}
              </button>
            ))}
          </div>
        </label>
        <label>
          <div>
            Webhook <span>· optional, Slack and Discord URLs work as-is</span>
          </div>
          <input
            type="url"
            placeholder="https://hooks.slack.com/…"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
        </label>
        {error && <div className="note err">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? "Adding…" : "Start monitoring"}
        </button>
      </form>

      <h2>Monitors</h2>
      <div className="card list">
        {rows === null ? (
          <div className="empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">Nothing yet. Add a page above; the first check saves a baseline.</div>
        ) : (
          rows.map((m) => (
            <div className="item" key={m.id}>
              <span
                className={`dot ${m.paused ? "paused" : m.lastStatus}`}
                title={m.paused ? "Paused" : m.lastStatus}
              />
              <Link className="main" href={`/m/${m.id}`}>
                <div className="url">{shortUrl(m.url)}</div>
                {m.watch && <div className="watch">{m.watch}</div>}
                {m.lastStatus === "error" && m.lastError && <div className="err-text">{m.lastError}</div>}
                <div className="meta">
                  {FREQUENCY_LABELS[m.frequency]} ·{" "}
                  {m.lastStatus === "pending"
                    ? "checking…"
                    : `checked ${ago(m.lastCheckedAt)}`}
                  {!m.paused && m.lastStatus !== "pending" && ` · next in ${until(m.nextRunAt)}`}
                  {" · "}
                  {m.changes === 1 ? "1 change" : `${m.changes} changes`}
                </div>
              </Link>
              <div className="row-actions">
                {!m.paused && (
                  <button onClick={() => act(m.id, "run")} disabled={m.lastStatus === "pending"}>
                    Check now
                  </button>
                )}
                <button onClick={() => act(m.id, m.paused ? "resume" : "pause")}>
                  {m.paused ? "Resume" : "Pause"}
                </button>
                <button className="danger" onClick={() => act(m.id, "delete")} aria-label="Delete">
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
