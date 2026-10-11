import { createClient } from "@supabase/supabase-js";

import {
  evaluateSignupCapacity,
  getSignupMaxUsers,
  SIGNUP_FULL_MESSAGE,
} from "@/config/signup-limits";
import { AppError } from "@/lib/errors";
import { withKeyedLock } from "@/lib/keyed-lock";
import {
  getSupabaseAnonKey,
  getSupabaseUrl,
} from "@/lib/supabase/env";

const SIGNUP_LOCK_KEY = "signup-user-cap";

export type SignupCountFn = () => Promise<number>;

/**
 * Compte les comptes Auth Supabase (source de vérité inscriptions).
 */
export async function countAuthUsers(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !service) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Impossible de vérifier la capacité d’inscription (configuration Auth manquante).",
      503,
    );
  }

  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let total = 0;
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) {
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "Impossible de vérifier la capacité d’inscription.",
        503,
      );
    }
    total += data.users.length;
    if (data.users.length < 200) break;
    page += 1;
    if (page > 100) break;
  }
  return total;
}

export function assertSignupCapacity(currentCount: number): void {
  const decision = evaluateSignupCapacity(currentCount, getSignupMaxUsers());
  if (!decision.allowed) {
    throw new AppError("FORBIDDEN", SIGNUP_FULL_MESSAGE, 403);
  }
}

/**
 * Sérialise les inscriptions (process + Redis) pour empêcher un dépassement
 * concurrent du plafond.
 */
export async function withSignupCapacityGate<T>(
  fn: () => Promise<T>,
): Promise<T> {
  return withKeyedLock(SIGNUP_LOCK_KEY, fn, {
    ttlMs: 45_000,
    waitMs: 30_000,
  });
}

export async function assertSignupAllowed(
  countUsers: SignupCountFn = countAuthUsers,
): Promise<{ currentCount: number; maxUsers: number | null }> {
  const maxUsers = getSignupMaxUsers();
  if (maxUsers == null) {
    return { currentCount: -1, maxUsers: null };
  }
  const currentCount = await countUsers();
  assertSignupCapacity(currentCount);
  return { currentCount, maxUsers };
}

export async function getSignupAvailability(
  countUsers: SignupCountFn = countAuthUsers,
): Promise<{
  open: boolean;
  message: string | null;
  maxUsers: number | null;
  currentCount: number | null;
}> {
  const maxUsers = getSignupMaxUsers();
  if (maxUsers == null) {
    return {
      open: true,
      message: null,
      maxUsers: null,
      currentCount: null,
    };
  }
  const currentCount = await countUsers();
  const decision = evaluateSignupCapacity(currentCount, maxUsers);
  return {
    open: decision.allowed,
    message: decision.message,
    maxUsers,
    currentCount,
  };
}

export type RegisterSignupInput = {
  email: string;
  password: string;
  fullName?: string;
  emailRedirectTo: string;
};

/**
 * Crée le compte sous verrou + contrôle de capacité (serveur).
 * Réutilise Supabase Auth `signUp` (email de confirmation inchangé).
 */
export async function registerSignupUnderCap(
  input: RegisterSignupInput,
  options?: { countUsers?: SignupCountFn },
): Promise<{ userId: string | null }> {
  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  if (!url || !anon) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Inscription impossible. Vérifiez la configuration Supabase.",
      503,
    );
  }

  return withSignupCapacityGate(async () => {
    await assertSignupAllowed(options?.countUsers ?? countAuthUsers);

    const supabase = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: input.fullName ? { full_name: input.fullName } : undefined,
        emailRedirectTo: input.emailRedirectTo,
      },
    });

    if (error) {
      throw new AppError("BAD_REQUEST", error.message, 400);
    }

    return { userId: data.user?.id ?? null };
  });
}
