import { AppError } from "@/lib/errors";

import type { ChaosFault } from "./faults";
import { isChaosFaultActive } from "./runtime";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Throws a realistic dependency failure when the fault is active.
 * No-op when chaos is off or the fault is inactive.
 */
export async function chaosGate(fault: ChaosFault): Promise<void> {
  if (!isChaosFaultActive(fault)) return;

  switch (fault) {
    case "ollama_down":
      throw new AppError(
        "OLLAMA_UNAVAILABLE",
        "[chaos] Ollama inaccessible (simulé).",
        503,
      );
    case "gpu_crash": {
      const err = new Error("read ECONNRESET");
      err.name = "Error";
      throw err;
    }
    case "redis_down":
      throw new Error("[chaos] Redis connection refused");
    case "postgres_down":
      throw new Error("[chaos] Postgres connection terminated unexpectedly");
    case "s3_down":
      throw new AppError(
        "INTERNAL_ERROR",
        "[chaos] Object Storage indisponible (simulé).",
        503,
      );
    case "stripe_timeout": {
      const ms = Number(process.env.DOCMIND_CHAOS_STRIPE_DELAY_MS ?? 50);
      await sleep(Number.isFinite(ms) ? Math.max(0, ms) : 50);
      throw new AppError(
        "BAD_REQUEST",
        "[chaos] Stripe timeout (simulé).",
        504,
      );
    }
    case "disk_full": {
      const err = new Error("ENOSPC: no space left on device, write");
      (err as NodeJS.ErrnoException).code = "ENOSPC";
      throw err;
    }
    case "memory_saturated": {
      const err = new Error("JavaScript heap out of memory");
      err.name = "RangeError";
      throw err;
    }
    case "upload_interrupted":
      throw new AppError(
        "BAD_REQUEST",
        "[chaos] Upload interrompu (simulé).",
        499,
      );
    case "connection_cut": {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    case "webhook_lost":
    case "server_restart":
      // Orchestrated in chaos scenarios — not mid-call throws.
      return;
    default:
      return;
  }
}

/** Sync variant for paths that cannot await (rare). */
export function chaosGateSync(fault: ChaosFault): void {
  if (!isChaosFaultActive(fault)) return;
  if (fault === "redis_down") {
    throw new Error("[chaos] Redis connection refused");
  }
  if (fault === "postgres_down") {
    throw new Error("[chaos] Postgres connection terminated unexpectedly");
  }
  if (fault === "disk_full") {
    const err = new Error("ENOSPC: no space left on device, write");
    (err as NodeJS.ErrnoException).code = "ENOSPC";
    throw err;
  }
}
