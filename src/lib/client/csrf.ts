import { csrfHeaderName } from "@/lib/csrf-public";

let cachedToken: string | null = null;
let inflight: Promise<string> | null = null;

async function fetchCsrfToken(): Promise<string> {
  const response = await fetch("/api/csrf", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Impossible d’obtenir le jeton CSRF.");
  }
  const payload = (await response.json()) as {
    success?: boolean;
    data?: { token?: string };
  };
  const token = payload.data?.token;
  if (!token) throw new Error("Jeton CSRF invalide.");
  cachedToken = token;
  return token;
}

export async function ensureCsrfToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  if (!inflight) {
    inflight = fetchCsrfToken().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Headers CSRF pour fetch mutantes critiques. */
export async function csrfHeaders(
  init?: HeadersInit,
): Promise<Record<string, string>> {
  const token = await ensureCsrfToken();
  const base: Record<string, string> = {};
  if (init) {
    const headers = new Headers(init);
    headers.forEach((value, key) => {
      base[key] = value;
    });
  }
  base[csrfHeaderName()] = token;
  return base;
}

export function clearCsrfToken(): void {
  cachedToken = null;
}
