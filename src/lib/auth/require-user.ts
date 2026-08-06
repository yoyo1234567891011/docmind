import { NextResponse } from "next/server";

import { docmindConfig } from "@/config/docmind";
import { matchEvalApiKey } from "@/lib/auth/eval-key";
import { AppError } from "@/lib/errors";
import {
  isSupabaseConfigured,
  LOCAL_DEV_USER_ID,
} from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { ensureUserWorkspace } from "@/services/auth/workspace";

export interface AuthUser {
  id: string;
  email: string | null;
  /** True when authenticated via EVAL_API_KEY */
  isEval?: boolean;
  /** True when Supabase is not configured (local-only mode) */
  isLocalDev?: boolean;
}

async function withWorkspace(user: AuthUser): Promise<AuthUser> {
  await ensureUserWorkspace(user.id).catch(() => undefined);
  return user;
}

/**
 * Resolve the current user from Supabase session cookies,
 * or from x-eval-api-key for automated evaluation runs.
 * Falls back to a local-dev user when Supabase env is missing.
 * Bootstrap le workspace filesystem isolé de l’utilisateur.
 */
export async function requireUser(request?: Request): Promise<AuthUser> {
  if (matchEvalApiKey(request?.headers.get("x-eval-api-key"))) {
    return withWorkspace({
      id: docmindConfig.auth.evalUserId,
      email: "eval@local",
      isEval: true,
    });
  }

  if (!isSupabaseConfigured()) {
    // Production : jamais de contournement auth
    if (process.env.NODE_ENV === "production") {
      throw new AppError(
        "UNAUTHORIZED",
        "Authentification requise. Configurez Supabase (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).",
        401,
      );
    }
    return withWorkspace({
      id: LOCAL_DEV_USER_ID,
      email: "local@dev",
      isLocalDev: true,
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AppError(
      "UNAUTHORIZED",
      "Authentification requise.",
      401,
    );
  }

  return withWorkspace({
    id: user.id,
    email: user.email ?? null,
  });
}

export async function getOptionalUser(): Promise<AuthUser | null> {
  try {
    if (!isSupabaseConfigured()) {
      if (process.env.NODE_ENV === "production") return null;
      return {
        id: LOCAL_DEV_USER_ID,
        email: "local@dev",
        isLocalDev: true,
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    return { id: user.id, email: user.email ?? null };
  } catch {
    return null;
  }
}

export function unauthorizedResponse() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Authentification requise.",
      },
    },
    { status: 401 },
  );
}
