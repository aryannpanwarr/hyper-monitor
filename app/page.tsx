"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, isChecking, statusText, type Demo, type PublicMonitor } from "@/lib/client";
import { FREQUENCY_LABELS, shortUrl, until } from "@/lib/format";
import type { Frequency } from "@/lib/types";

type Row = PublicMonitor & { changes: number; lastChangeAt: string | null };
type ListResponse = { monitors: Row[]; hasKey: boolean; demo: Demo };

const ALL_FREQUENCIES = Object.keys(FREQUENCY_LABELS) as Frequency[];

export default function Home() {
  const [list, setList] = useState<ListResponse | null>(null);
  const [url, setUrl] = useState("");
  const [watch, setWatch] = useState("");
  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { ok, data } = await api<ListResponse>("/api/monitors");
    if (ok) setList(data);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const demo = list?.demo;
  const limited = Boolean(demo?.enabled && !demo.owner);
  const frequencies = limited ? demo!.frequencies : ALL_FREQUENCIES;
  const chosen = frequency && frequencies.includes(frequency) ? frequency : limited ? "1d" : "1h";

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { ok, data } = await api("/api/monitors", {
      method: "POST",
      body: { url, watch, frequency: chosen, webhookUrl: limited ? "" : webhookUrl },
    });
    setBusy(false);
    if (!ok) return setError(data.error ?? "Something went wrong");
    setUrl("");
    setWatch("");
    setWebhookUrl("");
    void load();
  }

  async function act(id: string, action: "run" | "pause" | "resume" | "delete") {
    if (action === "delete" && !confirm("Delete this monitor and its history?")) return;
    setNotice("");
    const { ok, data } =
      action === "run"
        ? await api(`/api/monitors/${id}/run`, { method: "POST" })
        : action === "delete"
          ? await api(`/api/monitors/${id}`, { method: "DELETE" })
          : await api(`/api/monitors/${id}`, { method: "PATCH", body: { paused: action === "pause" } });
    if (!ok) setNotice(data.error ?? "Something went wrong");
    void load();
  }

  const rows = list?.monitors ?? null;

  return (
    <>
      <h1>Hyper Monitor</h1>
      <p className="sub">Check any page on a schedule and see exactly what changed.</p>

      {list && !list.hasKey && (
        <div className="note err">
          Add <code>HYPERBROWSER_API_KEY</code> to <code>.env.local</code> and restart to start checking.
        </div>
      )}
      {limited && (
        <div className="note">
          Live demo: add up to {demo!.maxMonitors} pages, checked every 6 hours or daily. Pages you add are removed
          after 24 hours. {demo!.checksLeft} demo checks left today.
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
            {frequencies.map((f) => (
              <button
                type="button"
                key={f}
                className={f === chosen ? "on" : ""}
                aria-pressed={f === chosen}
                onClick={() => setFrequency(f)}
              >
                {FREQUENCY_LABELS[f]}
              </button>
            ))}
          </div>
        </label>
        {!limited && (
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
        )}
        {error && <div className="note err">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? "Adding…" : "Start monitoring"}
        </button>
      </form>

      <h2>Monitors</h2>
      {notice && <div className="note err" style={{ marginTop: 0, marginBottom: 12 }}>{notice}</div>}
      <div className="card list">
        {rows === null ? (
          <div className="empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">Nothing yet. Add a page above; the first check saves a baseline.</div>
        ) : (
          rows.map((m) => {
            const canManage = !limited || !m.owner;
            const checking = isChecking(m);
            return (
              <div className="item" key={m.id}>
                <span className={`dot ${m.paused ? "paused" : m.lastStatus}`} title={m.paused ? "Paused" : m.lastStatus} />
                <Link className="main" href={`/m/${m.id}`}>
                  <div className="url">{shortUrl(m.url)}</div>
                  {m.watch && <div className="watch">{m.watch}</div>}
                  {m.lastStatus === "error" && m.lastError && <div className="err-text">{m.lastError}</div>}
                  <div className="meta">
                    {FREQUENCY_LABELS[m.frequency]} · {statusText(m)}
                    {!m.paused && !checking && ` · next in ${until(m.nextRunAt)}`}
                    {" · "}
                    {m.changes === 1 ? "1 change" : `${m.changes} changes`}
                    {m.expiresAt && ` · removed in ${until(m.expiresAt)}`}
                  </div>
                </Link>
                <div className="row-actions">
                  {!m.paused && (
                    <button onClick={() => act(m.id, "run")} disabled={checking}>
                      Check now
                    </button>
                  )}
                  {canManage && (
                    <>
                      <button onClick={() => act(m.id, m.paused ? "resume" : "pause")}>
                        {m.paused ? "Resume" : "Pause"}
                      </button>
                      <button className="danger" onClick={() => act(m.id, "delete")}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
