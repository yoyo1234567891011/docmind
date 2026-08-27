/**
 * Stockage fichiers utilisateur : FS local (dev) ou Postgres (multi-instance).
 *
 * Mode persistent + DOCMIND_FS_FALLBACK=1 (opt-in local uniquement) :
 *   - lecture PG, miss → FS → promote lazy vers PG
 *   - list fusionne PG ∪ FS
 * Mode persistent + DOCMIND_FS_DUAL_WRITE=1 :
 *   - écritures PG + FS (rollback)
 * DOCMIND_FS_FALLBACK=0 / déployé : PG uniquement (FS ignoré, aucune promotion).
 */

import { mkdir, readFile, readdir, unlink, writeFile } from "fs/promises";
import path from "path";

import {
  canUseLocalFilesystem,
  isFsDualWriteEnabled,
  isFsFallbackEnabled,
  usePersistentStorage,
} from "@/config/persistence";
import { userDataDir } from "@/config/paths";
import { query } from "@/lib/db/pool";

function toRelativeKey(userId: string, absolutePath: string): string {
  const base = path.resolve(userDataDir(userId));
  const resolved = path.resolve(absolutePath);
  const rel = path.relative(base, resolved).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Chemin utilisateur hors workspace: ${absolutePath}`);
  }
  return rel;
}

async function readFs(absolutePath: string): Promise<string | null> {
  if (!canUseLocalFilesystem()) return null;
  try {
    return await readFile(absolutePath, "utf8");
  } catch {
    return null;
  }
}

async function writeFs(absolutePath: string, content: string): Promise<void> {
  if (!canUseLocalFilesystem()) return;
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

async function pgRead(userId: string, key: string): Promise<string | null> {
  const result = await query<{ content: string }>(
    `select content from public.app_user_files
     where user_id = $1 and path = $2`,
    [userId, key],
  );
  return result.rows[0]?.content ?? null;
}

async function pgWrite(
  userId: string,
  key: string,
  content: string,
): Promise<void> {
  await query(
    `insert into public.app_user_files (user_id, path, content, updated_at)
     values ($1, $2, $3, timezone('utc', now()))
     on conflict (user_id, path) do update set
       content = excluded.content,
       updated_at = timezone('utc', now())`,
    [userId, key, content],
  );
}

export async function userFileRead(
  userId: string,
  absolutePath: string,
): Promise<string | null> {
  if (!usePersistentStorage()) {
    return readFs(absolutePath);
  }

  const key = toRelativeKey(userId, absolutePath);
  const fromPg = await pgRead(userId, key);
  if (fromPg != null) return fromPg;

  if (!isFsFallbackEnabled()) return null;

  const fromFs = await readFs(absolutePath);
  if (fromFs == null) return null;

  // Promote lazy — best-effort
  try {
    await pgWrite(userId, key, fromFs);
  } catch {
    /* keep serving FS content */
  }
  return fromFs;
}

export async function userFileWrite(
  userId: string,
  absolutePath: string,
  content: string,
): Promise<void> {
  if (!usePersistentStorage()) {
    await writeFs(absolutePath, content);
    return;
  }

  const key = toRelativeKey(userId, absolutePath);
  await pgWrite(userId, key, content);

  if (isFsDualWriteEnabled()) {
    await writeFs(absolutePath, content).catch(() => undefined);
  }
}

export async function userFileUnlink(
  userId: string,
  absolutePath: string,
): Promise<void> {
  if (!usePersistentStorage()) {
    if (!canUseLocalFilesystem()) return;
    try {
      await unlink(absolutePath);
    } catch {
      /* absent */
    }
    return;
  }

  const key = toRelativeKey(userId, absolutePath);
  await query(
    `delete from public.app_user_files where user_id = $1 and path = $2`,
    [userId, key],
  );

  if (isFsFallbackEnabled() || isFsDualWriteEnabled()) {
    try {
      await unlink(absolutePath);
    } catch {
      /* absent */
    }
  }
}

/** Noms de fichiers (pas de chemins) dans un répertoire. */
export async function userFileList(
  userId: string,
  absoluteDir: string,
): Promise<string[]> {
  if (!usePersistentStorage()) {
    if (!canUseLocalFilesystem()) return [];
    try {
      return await readdir(absoluteDir);
    } catch {
      return [];
    }
  }

  const prefix = `${toRelativeKey(userId, absoluteDir)}/`;
  const result = await query<{ path: string }>(
    `select path from public.app_user_files
     where user_id = $1 and path like $2`,
    [userId, `${prefix}%`],
  );
  const names = new Set<string>();
  for (const row of result.rows) {
    const rest = row.path.slice(prefix.length);
    if (!rest || rest.includes("/")) continue;
    names.add(rest);
  }

  if (isFsFallbackEnabled()) {
    if (!canUseLocalFilesystem()) return [...names];
    try {
      for (const name of await readdir(absoluteDir)) {
        names.add(name);
      }
    } catch {
      /* no local dir */
    }
  }

  return [...names];
}

export async function userFileDeletePrefix(
  userId: string,
  relativePrefix: string,
): Promise<void> {
  if (!usePersistentStorage()) return;
  const prefix = relativePrefix.replace(/\\/g, "/");
  await query(
    `delete from public.app_user_files
     where user_id = $1 and (path = $2 or path like $3)`,
    [userId, prefix, `${prefix}%`],
  );
}

export async function userFileEnsureDir(absoluteDir: string): Promise<void> {
  if (!canUseLocalFilesystem()) return;
  await mkdir(absoluteDir, { recursive: true });
}
