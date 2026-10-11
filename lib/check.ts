import { Hyperbrowser } from "@hyperbrowser/sdk";
import { diffLines } from "diff";
import type { Change, Monitor } from "./types";

const JOB_TIMEOUT_MS = 3 * 60_000;
const POLL_MS = 2_000;

let client: Hyperbrowser | null = null;
function hb() {
  const apiKey = process.env.HYPERBROWSER_API_KEY;
  if (!apiKey) throw new Error("HYPERBROWSER_API_KEY is not set (see .env.example)");
  return (client ??= new Hyperbrowser({ apiKey }));
}

/** start + poll with a deadline, so a stuck job can't block the queue forever. */
async function waitFor<T extends { status: string; error?: string }>(
  getStatus: () => Promise<{ status: string }>,
  getResult: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { status } = await getStatus();
    if (status === "completed" || status === "failed") {
      const result = await getResult();
      if (result.status === "failed") throw new Error(result.error || "Hyperbrowser job failed");
      return result;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timed out after ${JOB_TIMEOUT_MS / 60_000} minutes`);
}

async function scrapePage(url: string): Promise<string> {
  const { jobId } = await hb().scrape.start({
    url,
    scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
  });
  const result = await waitFor(
    () => hb().scrape.getStatus(jobId),
    () => hb().scrape.get(jobId),
  );
  const markdown = result.data?.markdown ?? "";
  // Scrape reports "completed" even when the page didn't load: the browser's
  // error page (HTTP 4xx/5xx) or a network error comes back as the content.
  // Treat those as failed checks, not as a change.
  const finalUrl = String(result.data?.metadata?.url ?? "");
  if (finalUrl.startsWith("chrome-error://")) {
    throw new Error(`Page didn't load: ${firstLine(markdown) || "browser error page"}`);
  }
  if (/^```\s*\n?(dial tcp|net::ERR_)/.test(markdown)) {
    throw new Error(`Network error: ${firstLine(markdown.replace(/^```\s*\n?/, ""))}`);
  }
  if (!markdown.trim()) throw new Error("Page returned no content");
  return normaliseText(markdown);
}

const firstLine = (s: string) => s.replace(/^#+\s*/, "").split("\n")[0].trim().slice(0, 120);

async function extractWatched(url: string, watch: string, schema: object | null) {
  const { jobId } = await hb().extract.start({
    urls: [url],
    prompt: watch,
    ...(schema ? { schema } : {}),
  });
  const result = await waitFor(
    () => hb().extract.getStatus(jobId),
    () => hb().extract.get(jobId),
  );
  return result.data ?? {};
}

/**
 * Run one check. Returns the normalised snapshot and, after the first
 * extract, the schema to lock in. AI extraction without a schema can format
 * the same data differently between runs ("£51.77" vs 51.77), which would
 * look like a change; reusing the first run's shape keeps it stable.
 */
export async function runCheck(m: Monitor): Promise<{ snapshot: string; schema: object | null }> {
  if (!m.watch.trim()) {
    return { snapshot: await scrapePage(m.url), schema: null };
  }
  if (m.schema) {
    const extract = async () => canonicalJson(await extractWatched(m.url, m.watch, m.schema));
    const first = await extract();
    if (m.snapshot === null || first === m.snapshot) return { snapshot: first, schema: m.schema };
    // Looks changed. AI extraction can still read an open-ended field
    // differently between runs, so confirm with a second run: only a result
    // that repeats counts as a change; anything else keeps the old snapshot.
    const second = await extract();
    return { snapshot: second === first ? first : m.snapshot, schema: m.schema };
  }
  // First check: learn the shape, then extract again with it so the baseline
  // is already in the locked format every later run will use.
  const schema = inferSchema(await extractWatched(m.url, m.watch, null));
  return { snapshot: canonicalJson(await extractWatched(m.url, m.watch, schema)), schema };
}

function normaliseText(s: string) {
  return s
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sort(value), null, 2);
}

/**
 * Every leaf becomes a string "exactly as shown", so formatting can't drift,
 * with the first run's value as an example so the field keeps its meaning.
 */
function inferSchema(value: unknown): object {
  if (Array.isArray(value)) {
    const sample = value.find((v) => v != null);
    return { type: "array", items: sample === undefined ? { type: "string" } : inferSchema(sample) };
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    return {
      type: "object",
      properties: Object.fromEntries(
        keys.map((k) => [k, inferSchema((value as Record<string, unknown>)[k])]),
      ),
      required: keys,
    };
  }
  const example = value == null ? "" : ` (for example: ${JSON.stringify(String(value).slice(0, 60))})`;
  return { type: "string", description: `Exactly as shown on the page${example}` };
}

const CONTEXT_LINES = 2;

export function diffSnapshots(before: string, after: string): Omit<Change, "id" | "monitorId" | "at" | "webhook"> {
  const parts: Change["parts"] = [];
  let added = 0;
  let removed = 0;
  for (const part of diffLines(before, after)) {
    const lines = part.value.replace(/\n$/, "").split("\n");
    if (part.added) {
      added += lines.length;
      parts.push({ kind: "add", text: lines.join("\n") });
    } else if (part.removed) {
      removed += lines.length;
      parts.push({ kind: "remove", text: lines.join("\n") });
    } else {
      // Keep a little context around changes, collapse the rest.
      const text =
        lines.length > CONTEXT_LINES * 2 + 1
          ? [...lines.slice(0, CONTEXT_LINES), "…", ...lines.slice(-CONTEXT_LINES)].join("\n")
          : lines.join("\n");
      parts.push({ kind: "same", text });
    }
  }
  if (parts[0]?.kind === "same") parts[0].text = parts[0].text.split("\n").slice(-CONTEXT_LINES).join("\n");
  const last = parts[parts.length - 1];
  if (last?.kind === "same") last.text = last.text.split("\n").slice(0, CONTEXT_LINES).join("\n");
  return { added, removed, parts };
}

/** Posts JSON that Slack ("text") and Discord ("content") both render as-is. */
export async function sendWebhook(m: Monitor, change: Change): Promise<"sent" | "failed"> {
  const lines = change.parts
    .filter((p) => p.kind !== "same")
    .flatMap((p) => p.text.split("\n").map((l) => `${p.kind === "add" ? "+" : "-"} ${l}`));
  const summary = `Change on ${m.url}${m.watch ? ` (${m.watch})` : ""}: +${change.added} / -${change.removed} lines`;
  const body = `${summary}\n${lines.join("\n")}`.slice(0, 1900);
  try {
    const res = await fetch(m.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: body,
        content: body,
        monitor: { id: m.id, url: m.url, watch: m.watch },
        change: { id: change.id, at: change.at, added: change.added, removed: change.removed },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
