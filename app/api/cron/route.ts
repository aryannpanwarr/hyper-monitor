import { tick } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Runs due checks. On Vercel this is called every 15 minutes by the GitHub
 * Actions workflow (and daily by Vercel Cron as a backup), with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  await tick({ budgetMs: 4 * 60_000 });
  return Response.json({ ok: true, ms: Date.now() - started });
}
