import "server-only";
import { env } from "./env";

/** Kick the background worker. Safe to call often; it is a no-op when idle. */
export async function triggerWorker() {
  try {
    await fetch(`${env.siteUrl}/api/worker`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.cronSecret}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (err) {
    // pg_cron picks the work up within a minute anyway.
    console.error("worker trigger failed", err);
  }
}
