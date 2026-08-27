import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { docmindConfig } from "@/config/docmind";
import { canUseLocalFilesystem, usePersistentStorage } from "@/config/persistence";
import { userDataDir } from "@/config/paths";
import { safeNextPath } from "@/lib/safe-redirect";
import {
  pgGetUserBlob,
  pgSaveUserBlob,
} from "@/services/persistence/user-blobs-pg";

const GUIDE_BLOB_KEY = "onboarding";
export const GUIDE_PATH = "/guide";
export const GUIDE_START_PATH = "/analyser";

type OnboardingBlob = {
  guideSeenAt?: string | null;
};

function onboardingFilePath(userId: string): string {
  return path.join(userDataDir(userId), "onboarding.json");
}

async function readOnboarding(userId: string): Promise<OnboardingBlob> {
  try {
    if (usePersistentStorage()) {
      const data = await pgGetUserBlob<OnboardingBlob>(userId, GUIDE_BLOB_KEY);
      return data ?? {};
    }
    const raw = await readFile(onboardingFilePath(userId), "utf8");
    return JSON.parse(raw) as OnboardingBlob;
  } catch {
    return {};
  }
}

async function writeOnboarding(
  userId: string,
  data: OnboardingBlob,
): Promise<void> {
  if (usePersistentStorage()) {
    await pgSaveUserBlob(userId, GUIDE_BLOB_KEY, data);
    return;
  }
  if (!canUseLocalFilesystem()) return;
  const filePath = onboardingFilePath(userId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function hasSeenGuide(userId: string): Promise<boolean> {
  const data = await readOnboarding(userId);
  return Boolean(data.guideSeenAt);
}

export async function markGuideSeen(userId: string): Promise<void> {
  const current = await readOnboarding(userId);
  if (current.guideSeenAt) return;
  await writeOnboarding(userId, {
    ...current,
    guideSeenAt: new Date().toISOString(),
  });
}

/** Chemins auth sensibles : ne pas détourner vers le Guide. */
function shouldSkipGuideGate(nextPath: string): boolean {
  return (
    nextPath.startsWith("/auth/reset-password") ||
    nextPath.startsWith("/auth/callback")
  );
}

/**
 * Destination post-login : Guide si jamais vu, sinon le `next` demandé.
 * En cas d’erreur de lecture profil → ne bloque pas (parcours normal).
 */
export async function resolvePostLoginPath(
  userId: string,
  requestedNext?: string | null,
): Promise<string> {
  const next = safeNextPath(
    requestedNext,
    docmindConfig.auth.afterLoginPath,
  );
  if (shouldSkipGuideGate(next)) return next;

  try {
    const seen = await hasSeenGuide(userId);
    if (!seen) return GUIDE_PATH;
  } catch {
    // fail-open : ne bloque pas la connexion
  }
  return next === GUIDE_PATH ? GUIDE_START_PATH : next;
}
