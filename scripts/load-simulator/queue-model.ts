/**
 * Modèle de file M/D/1 pour le verrou generate Ollama (1 analyse GPU à la fois).
 * Service déterministe ≈ durée P2 mesurée.
 */

import { percentile } from "./stats";

export interface QueueModelInput {
  concurrentUsers: number;
  docsPerUser: number;
  /** Durée moyenne P2 (ms) — service time */
  serviceTimeP2Ms: number;
  /** Durée P1 (ms) */
  serviceTimeP1Ms: number;
  /** Upload moyen (ms) */
  uploadMs: number;
  /** History list moyen (ms) */
  historyMs: number;
  /** Signup moyen (ms) */
  signupMs: number;
  /** Timeout poll client (ms) */
  p2TimeoutMs?: number;
}

export interface QueueModelResult {
  arrivals: number;
  serviceTimeP2Ms: number;
  /** Intensité trafic ρ = λ / μ */
  rho: number;
  avgQueueLength: number;
  maxQueueLength: number;
  avgQueueWaitMs: number;
  maxQueueWaitMs: number;
  p50QueueWaitMs: number;
  p95QueueWaitMs: number;
  p99QueueWaitMs: number;
  avgP2Ms: number;
  p50P2Ms: number;
  p95P2Ms: number;
  p99P2Ms: number;
  avgP1Ms: number;
  avgTotalUserMs: number;
  p50TotalMs: number;
  p95TotalMs: number;
  p99TotalMs: number;
  wallMs: number;
  throughputPerHour: number;
  failureRate: number;
  timeoutRate: number;
  timeoutCount: number;
  saturated: boolean;
  reason: string;
  notes: string[];
  /** Cache fingerprint : 1er miss, suivants hit (même PDF) */
  cacheHits: number;
  cacheTotal: number;
  cacheHitRate: number;
}

/**
 * Simule une arrivée quasi-simultanée de N utilisateurs (burst),
 * chacun lançant `docsPerUser` analyses sérialisées sur 1 serveur GPU.
 */
export function simulateGpuQueue(input: QueueModelInput): QueueModelResult {
  const jobs = input.concurrentUsers * input.docsPerUser;
  const S = Math.max(1, input.serviceTimeP2Ms);
  const clientPollBudget = input.p2TimeoutMs ?? 8 * 60 * 1000;
  const notes: string[] = [
    "Modèle : 1 worker GPU (generate-lock process-wide), arrivées en burst.",
    `Service P2 calibré = ${(S / 1000).toFixed(1)} s.`,
  ];

  const queueWaits: number[] = [];
  const p2Totals: number[] = [];
  const maxQ = jobs;

  for (let i = 0; i < jobs; i += 1) {
    const wait = i * S;
    queueWaits.push(wait);
    p2Totals.push(wait + S);
  }

  const avgQueueLength = jobs / 2;
  const avgQueueWaitMs =
    queueWaits.reduce((a, b) => a + b, 0) / Math.max(jobs, 1);
  const maxQueueWaitMs = queueWaits[queueWaits.length - 1] ?? 0;

  const throughputPerHour = 3600_000 / S;
  const effectiveRho = jobs <= 1 ? jobs : 1;

  let timeoutCount = 0;
  for (const t of p2Totals) {
    if (t > clientPollBudget) timeoutCount += 1;
  }
  const timeoutRate = jobs === 0 ? 0 : timeoutCount / jobs;
  const failureRate = timeoutRate;
  const saturated = effectiveRho >= 0.85 || input.concurrentUsers >= 50;

  let reason = "File GPU mono-worker sous contrôle.";
  if (input.concurrentUsers >= 10_000) {
    reason =
      "Saturation extrême : 10k users sur 1 GPU = file multi-semaines, timeouts ~100 %.";
  } else if (input.concurrentUsers >= 5_000) {
    reason =
      "Saturation extrême : 5k users × service GPU ≈ jours de file, timeouts massifs.";
  } else if (input.concurrentUsers >= 1_000) {
    reason =
      "Saturation certaine : 1000 users × ~3 min GPU ≈ jours de file sur 1 worker.";
  } else if (input.concurrentUsers >= 500) {
    reason = "Saturation sévère : file multi-heures, timeouts massifs.";
  } else if (input.concurrentUsers >= 100) {
    reason = "Saturation : file > poll client pour une grande part.";
  } else if (input.concurrentUsers >= 50) {
    reason = "Saturation progressive : nombreux timeouts P2 prévisibles.";
  } else if (input.concurrentUsers >= 10) {
    reason = "Charge élevée : attentes minutes, ρ≈1 pendant le burst.";
  }

  const overhead =
    input.signupMs +
    input.uploadMs +
    input.serviceTimeP1Ms +
    input.historyMs;

  const totals = p2Totals.map((p2) => overhead + p2);
  const avgP2Ms =
    p2Totals.reduce((a, b) => a + b, 0) / Math.max(p2Totals.length, 1);
  const avgTotalUserMs =
    totals.reduce((a, b) => a + b, 0) / Math.max(totals.length, 1);
  const wallMs = jobs * S + overhead;

  // Même PDF : 1 miss + (jobs-1) hits potentiels côté fingerprint (hors file GPU réelle)
  const cacheHits = Math.max(0, jobs - 1);
  const cacheTotal = jobs;
  const cacheHitRate = cacheTotal === 0 ? 0 : cacheHits / cacheTotal;

  notes.push(
    `Débit théorique ≈ ${throughputPerHour.toFixed(1)} analyses P2 / heure.`,
  );
  if (timeoutCount > 0) {
    notes.push(
      `${timeoutCount}/${jobs} jobs dépassent le budget poll client (~${Math.round(clientPollBudget / 60_000)} min) → timeout UX.`,
    );
  }
  notes.push(
    `Cache fingerprint (modèle même PDF) : hit rate ${(cacheHitRate * 100).toFixed(0)} % — n’élimine pas la file GPU si le cache applicatif n’est pas hit avant generate.`,
  );

  return {
    arrivals: jobs,
    serviceTimeP2Ms: S,
    rho: effectiveRho,
    avgQueueLength,
    maxQueueLength: maxQ,
    avgQueueWaitMs,
    maxQueueWaitMs,
    p50QueueWaitMs: percentile(queueWaits, 50),
    p95QueueWaitMs: percentile(queueWaits, 95),
    p99QueueWaitMs: percentile(queueWaits, 99),
    avgP2Ms,
    p50P2Ms: percentile(p2Totals, 50),
    p95P2Ms: percentile(p2Totals, 95),
    p99P2Ms: percentile(p2Totals, 99),
    avgP1Ms: input.serviceTimeP1Ms,
    avgTotalUserMs,
    p50TotalMs: percentile(totals, 50),
    p95TotalMs: percentile(totals, 95),
    p99TotalMs: percentile(totals, 99),
    wallMs,
    throughputPerHour,
    failureRate,
    timeoutRate,
    timeoutCount,
    saturated,
    reason,
    notes,
    cacheHits,
    cacheTotal,
    cacheHitRate,
  };
}
