import type { ApiResponse, UserAccountStats } from "@/types";

export interface MeUser {
  id: string;
  email: string | null;
  isLocalDev?: boolean;
  isAdmin?: boolean;
}

export interface MeResponse {
  user: MeUser | null;
  stats: UserAccountStats | null;
  runtime: {
    env: string;
    version: string;
    maintenance: boolean;
    feedbackEnabled?: boolean;
  };
}

/** Dédup chrome : header + beta-banner + dashboard partagent le même fetch. */
const ME_TTL_MS = 8_000;
let inflight: Promise<MeResponse> | null = null;
let cached: { at: number; data: MeResponse } | null = null;

export async function fetchMe(options?: {
  force?: boolean;
}): Promise<MeResponse> {
  const force = options?.force === true;
  if (!force && cached && Date.now() - cached.at < ME_TTL_MS) {
    return cached.data;
  }
  if (!force && inflight) return inflight;

  inflight = (async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    const payload = (await response.json()) as ApiResponse<MeResponse>;
    if (!payload.success) throw new Error(payload.error.message);
    cached = { at: Date.now(), data: payload.data };
    return payload.data;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Invalide le cache (après logout / sync billing). */
export function invalidateMeCache(): void {
  cached = null;
  inflight = null;
}
