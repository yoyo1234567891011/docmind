import { chaosGate } from "@/lib/chaos";
import { AppError } from "@/lib/errors";

const RETRIES = 3;
const RETRY_DELAY_MS = 700;

/**
 * Force IPv4 loopback — on Windows, `localhost` often hits ::1 while
 * Ollama listens on 127.0.0.1 only → false "unreachable" errors.
 */
export function normalizeOllamaBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/$/, "")
    .replace(/^http:\/\/localhost(?=[:/]|$)/i, "http://127.0.0.1")
    .replace(/^https:\/\/localhost(?=[:/]|$)/i, "https://127.0.0.1");
}

const DEFAULT_OLLAMA_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Empêche SSRF : seule une URL Ollama locale (ou hosts explicites) est acceptée.
 */
export function assertSafeOllamaBaseUrl(url: string): string {
  const normalized = normalizeOllamaBaseUrl(url);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new AppError(
      "BAD_REQUEST",
      "URL Ollama invalide.",
      400,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError(
      "BAD_REQUEST",
      "URL Ollama : protocole http(s) uniquement.",
      400,
    );
  }

  if (parsed.username || parsed.password) {
    throw new AppError(
      "BAD_REQUEST",
      "URL Ollama : identifiants interdits dans l'URL.",
      400,
    );
  }

  const extra = (process.env.OLLAMA_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  const host = parsed.hostname.toLowerCase();
  if (!DEFAULT_OLLAMA_HOSTS.has(host) && !extra.includes(host)) {
    throw new AppError(
      "BAD_REQUEST",
      "URL Ollama non autorisée (localhost uniquement, ou OLLAMA_ALLOWED_HOSTS).",
      400,
    );
  }

  return normalized;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Timeout HTTP par défaut si aucun signal fourni (évite sockets orphelins). */
function defaultOllamaTimeoutMs(path: string): number {
  if (path.includes("/api/generate")) {
    const fromEnv = Number(process.env.OLLAMA_GENERATE_HTTP_TIMEOUT_MS);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 600_000;
  }
  if (path.includes("/api/embeddings")) {
    const fromEnv = Number(process.env.OLLAMA_EMBED_TIMEOUT_MS);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 45_000;
  }
  if (path.includes("/api/tags")) {
    const fromEnv = Number(process.env.OLLAMA_TAGS_TIMEOUT_MS);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 5_000;
  }
  const fromEnv = Number(process.env.OLLAMA_HTTP_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 30_000;
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: string }).name) : "";
  if (name === "AbortError") return true;
  if (error instanceof AppError && /abort|annul/i.test(error.message)) {
    return true;
  }
  return false;
}

function isRetryableNetworkError(error: unknown): boolean {
  // Jamais retenter une annulation volontaire (timeout / AbortController).
  if (isAbortError(error)) return false;
  if (!(error instanceof Error)) return true;
  const message = `${error.message} ${error.name}`.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("socket") ||
    message.includes("network") ||
    message.includes("other side closed") ||
    message.includes("und_err")
  );
}

export async function fetchOllama(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  await chaosGate("ollama_down");
  await chaosGate("gpu_crash");

  // Défense SSRF : valider à chaque appel (pas seulement à l’écriture admin).
  const safeBase = assertSafeOllamaBaseUrl(baseUrl);
  const url = `${safeBase}${path.startsWith("/") ? path : `/${path}`}`;
  let lastError: unknown;

  // Controller + timer nettoyé (évite AbortSignal.timeout orphelin après succès).
  let ownedTimer: ReturnType<typeof setTimeout> | undefined;
  let signal = init?.signal;
  if (!signal) {
    const controller = new AbortController();
    const ms = defaultOllamaTimeoutMs(path);
    ownedTimer = setTimeout(() => controller.abort(), ms);
    signal = controller.signal;
  }

  try {
    for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
      try {
        return await fetch(url, {
          ...init,
          signal,
          // Never cache local model calls
          cache: "no-store",
        });
      } catch (error) {
        lastError = error;
        if (isAbortError(error)) {
          throw error;
        }
        if (attempt < RETRIES && isRetryableNetworkError(error)) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        break;
      }
    }
  } finally {
    if (ownedTimer !== undefined) clearTimeout(ownedTimer);
  }

  const detail =
    lastError instanceof Error ? lastError.message : "erreur réseau";
  throw new AppError(
    "OLLAMA_UNAVAILABLE",
    `Impossible de contacter Ollama sur ${safeBase}. ` +
      `Vérifiez que l'application Ollama est ouverte, puis relancez \`npm run dev\`. (${detail})`,
    503,
  );
}

export async function ensureOllamaReachable(baseUrl: string): Promise<void> {
  const response = await fetchOllama(baseUrl, "/api/tags", { method: "GET" });
  if (!response.ok) {
    throw new AppError(
      "OLLAMA_UNAVAILABLE",
      `Ollama répond mais avec une erreur (${response.status}). Redémarrez l'application Ollama.`,
      502,
    );
  }
}
