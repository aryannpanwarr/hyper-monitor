// Next.js runs this once when the server starts: begin the schedule loop.
// On Vercel there's no long-running server, so /api/cron drives checks instead.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.VERCEL) {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
