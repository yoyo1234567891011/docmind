/**
 * Kick drain — fire-and-forget HTTP vers /api/cron/drain-analysis-jobs.
 * Crée une nouvelle invocation serverless Vercel (maxDuration=300s),
 * évitant la limite de 15s imposée par after() sur Hobby.
 */

let lastKickAt = 0;
const MIN_INTERVAL_MS = 10_000;

export function scheduleAnalysisDrainKick(maxJobs = 1): void {
  const now = Date.now();
  if (now - lastKickAt < MIN_INTERVAL_MS) return;
  lastKickAt = now;

  const secret = process.env.CRON_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!secret || !appUrl) return;

  const url = `${appUrl.replace(/\/$/, "")}/api/cron/drain-analysis-jobs`;

  // Fire-and-forget : on n'attend pas la réponse
  fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ maxJobs }),
    signal: AbortSignal.timeout(5_000), // timeout court : juste pour envoyer la requête
  }).catch(() => {
    // Silencieux — le cron watchdog prend le relais
  });
}

/** Test helper */
export function __resetAnalysisDrainKickForTests(): void {
  lastKickAt = 0;
}
