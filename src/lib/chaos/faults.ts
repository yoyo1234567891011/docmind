/**
 * Chaos fault IDs — activated only when DOCMIND_CHAOS=1 (never in prod by default).
 */
export const CHAOS_FAULTS = [
  "ollama_down",
  "redis_down",
  "postgres_down",
  "s3_down",
  "stripe_timeout",
  "disk_full",
  "memory_saturated",
  "gpu_crash",
  "upload_interrupted",
  "connection_cut",
  "webhook_lost",
  "server_restart",
] as const;

export type ChaosFault = (typeof CHAOS_FAULTS)[number];

export function isChaosFault(value: string): value is ChaosFault {
  return (CHAOS_FAULTS as readonly string[]).includes(value);
}
