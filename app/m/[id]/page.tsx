"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ago, FREQUENCY_LABELS, shortUrl, until } from "@/lib/format";
import type { Change, Monitor } from "@/lib/types";

type Detail = { monitor: Omit<Monitor, "schema">; changes: Change[] };

export default function MonitorPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/monitors/${id}`, { cache: "no-store" });
    if (res.status === 404) return setMissing(true);
    setData(await res.json());
  }, [id]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function runNow() {
    await fetch(`/api/monitors/${id}/run`, { method: "POST" });
    void load();
  }

  if (missing)
    return (
      <>
        <Link className="back" href="/">← All monitors</Link>
        <div className="empty">This monitor doesn&apos;t exist anymore.</div>
      </>
    );
  if (!data) return <div className="empty">Loading…</div>;

  const { monitor: m, changes } = data;
  const status = m.paused ? "paused" : m.lastStatus;

  return (
    <>
      <Link className="back" href="/">← All monitors</Link>
      <div className="head">
        <div>
          <h1>
            <a href={m.url} target="_blank" rel="noreferrer">{shortUrl(m.url)}</a>
          </h1>
          {m.watch && <p className="sub">Watching: {m.watch}</p>}
          <p className="meta" style={{ margin: "6px 0 0", display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`dot ${status}`} />
            {FREQUENCY_LABELS[m.frequency]} ·{" "}
            {m.lastStatus === "pending" ? "checking…" : `checked ${ago(m.lastCheckedAt)}`}
            {!m.paused && m.lastStatus !== "pending" && ` · next in ${until(m.nextRunAt)}`}
            {m.paused && " · paused"}
          </p>
        </div>
        {!m.paused && (
          <button onClick={runNow} disabled={m.lastStatus === "pending"}>
            Check now
          </button>
        )}
      </div>

      {m.lastStatus === "error" && m.lastError && (
        <div className="note err">Last check failed: {m.lastError}. Retrying soon.</div>
      )}

      <h2>Changes</h2>
      {changes.length === 0 ? (
        <div className="card empty">
          {m.snapshot === null
            ? "Waiting for the first check, which saves a baseline."
            : "No changes yet. Baseline saved; differences will show up here."}
        </div>
      ) : (
        changes.map((c) => (
          <div className="card change" key={c.id}>
            <header>
              <span title={new Date(c.at).toLocaleString()}>{ago(c.at)}</span>
              <span>
                <span className="add-n">+{c.added}</span> <span className="del-n">−{c.removed}</span>
                {c.webhook !== "none" && <span className="meta"> · webhook {c.webhook}</span>}
              </span>
            </header>
            <pre className="diff">
              {c.parts.map((p, i) => (
                <div key={i} className={p.kind}>
                  {p.text
                    .split("\n")
                    .map((l) => (p.kind === "add" ? "+ " : p.kind === "remove" ? "- " : "  ") + l)
                    .join("\n")}
                </div>
              ))}
            </pre>
          </div>
        ))
      )}

      {m.snapshot && (
        <details>
          <summary>Current snapshot</summary>
          <pre className="card snap">{m.snapshot}</pre>
        </details>
      )}
    </>
  );
}
