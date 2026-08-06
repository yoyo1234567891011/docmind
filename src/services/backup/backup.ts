import { createHash } from "crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import path from "path";

import { usePersistentStorage } from "@/config/persistence";
import { BACKUPS_DIR } from "@/config/paths";

const DATA_DIR = path.join(process.cwd(), "data");
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export interface BackupManifest {
  id: string;
  createdAt: string;
  files: Array<{ relativePath: string; size: number; sha256: string }>;
  totals: { files: number; bytes: number };
  sources: string[];
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      const st = await stat(full);
      if (st.isDirectory()) await walk(full);
      else if (st.isFile()) out.push(full);
    }
  }
  await walk(root);
  return out;
}

async function hashFile(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

function backupRoot(id: string): string {
  return path.join(BACKUPS_DIR, id);
}

/**
 * Crée une sauvegarde horodatée de data/ + uploads/.
 */
export async function createDailyBackup(options?: {
  id?: string;
}): Promise<BackupManifest> {
  if (usePersistentStorage()) {
    throw new Error(
      "Backup FS local interdit en mode persistent — utiliser un dump Postgres + snapshot S3 versionné.",
    );
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = options?.id ?? `backup-${stamp}`;
  const root = backupRoot(id);
  await mkdir(root, { recursive: true });

  const sources = [
    { name: "data", abs: DATA_DIR },
    { name: "uploads", abs: UPLOADS_DIR },
  ];

  const files: BackupManifest["files"] = [];
  let bytes = 0;

  for (const source of sources) {
    const list = await walkFiles(source.abs);
    for (const abs of list) {
      const rel = path.join(source.name, path.relative(source.abs, abs));
      const dest = path.join(root, rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(abs, dest);
      const sha256 = await hashFile(dest);
      const size = (await stat(dest)).size;
      files.push({ relativePath: rel.replace(/\\/g, "/"), size, sha256 });
      bytes += size;
    }
  }

  const manifest: BackupManifest = {
    id,
    createdAt: new Date().toISOString(),
    files,
    totals: { files: files.length, bytes },
    sources: sources.map((s) => s.name),
  };

  await writeFile(
    path.join(root, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(BACKUPS_DIR, "latest.json"),
    JSON.stringify({ id, createdAt: manifest.createdAt }, null, 2),
    "utf8",
  );

  return manifest;
}

/**
 * Vérifie l’intégrité (présence + SHA-256) d’une sauvegarde.
 */
export async function verifyBackup(id: string): Promise<{
  ok: boolean;
  checked: number;
  errors: string[];
}> {
  const root = backupRoot(id);
  const manifest = JSON.parse(
    await readFile(path.join(root, "manifest.json"), "utf8"),
  ) as BackupManifest;

  const errors: string[] = [];
  for (const file of manifest.files) {
    const abs = path.join(root, file.relativePath);
    try {
      const sha = await hashFile(abs);
      if (sha !== file.sha256) {
        errors.push(`hash mismatch: ${file.relativePath}`);
      }
    } catch {
      errors.push(`missing: ${file.relativePath}`);
    }
  }

  return { ok: errors.length === 0, checked: manifest.files.length, errors };
}

/**
 * Restaure une sauvegarde vers data/ et uploads/ (écrase).
 */
export async function restoreBackup(
  id: string,
  options?: { dryRun?: boolean },
): Promise<{ restored: number; dryRun: boolean }> {
  const verification = await verifyBackup(id);
  if (!verification.ok) {
    throw new Error(
      `Sauvegarde invalide (${verification.errors.length} erreurs). Restauration annulée.`,
    );
  }

  const root = backupRoot(id);
  const manifest = JSON.parse(
    await readFile(path.join(root, "manifest.json"), "utf8"),
  ) as BackupManifest;

  if (options?.dryRun) {
    return { restored: manifest.files.length, dryRun: true };
  }

  /**
   * Stage-then-swap : copie d’abord vers *.restore-new, puis bascule.
   * Évite data/uploads vides si la copie échoue à mi-chemin.
   */
  const cwd = process.cwd();
  const dataNew = path.join(cwd, "data.restore-new");
  const uploadsNew = path.join(cwd, "uploads.restore-new");
  const dataOld = path.join(cwd, "data.restore-old");
  const uploadsOld = path.join(cwd, "uploads.restore-old");

  await rm(dataNew, { recursive: true, force: true }).catch(() => undefined);
  await rm(uploadsNew, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(dataNew, { recursive: true });
  await mkdir(uploadsNew, { recursive: true });

  let restored = 0;
  try {
    for (const file of manifest.files) {
      const rel = file.relativePath.replace(/\\/g, "/");
      // Refuse path traversal / chemins absolus (manifeste non fiable)
      if (
        !rel ||
        rel.startsWith("/") ||
        rel.includes("\0") ||
        rel.split("/").some((p) => p === ".." || p === "")
      ) {
        throw new Error(`Chemin de restauration invalide: ${file.relativePath}`);
      }

      const src = path.resolve(root, rel);
      const rootResolved = path.resolve(root);
      if (
        src !== rootResolved &&
        !src.startsWith(rootResolved + path.sep)
      ) {
        throw new Error(`Chemin source hors backup: ${file.relativePath}`);
      }

      let stagedDest: string;
      if (rel.startsWith("data/")) {
        stagedDest = path.resolve(dataNew, rel.slice("data/".length));
        if (
          stagedDest !== path.resolve(dataNew) &&
          !stagedDest.startsWith(path.resolve(dataNew) + path.sep)
        ) {
          throw new Error(`Destination data hors staging: ${file.relativePath}`);
        }
      } else if (rel.startsWith("uploads/")) {
        stagedDest = path.resolve(uploadsNew, rel.slice("uploads/".length));
        if (
          stagedDest !== path.resolve(uploadsNew) &&
          !stagedDest.startsWith(path.resolve(uploadsNew) + path.sep)
        ) {
          throw new Error(
            `Destination uploads hors staging: ${file.relativePath}`,
          );
        }
      } else {
        // Hors racines connues — ignore pour ne pas écrire hors staging
        continue;
      }
      await mkdir(path.dirname(stagedDest), { recursive: true });
      await copyFile(src, stagedDest);
      restored += 1;
    }
  } catch (error) {
    await rm(dataNew, { recursive: true, force: true }).catch(() => undefined);
    await rm(uploadsNew, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  await rm(dataOld, { recursive: true, force: true }).catch(() => undefined);
  await rm(uploadsOld, { recursive: true, force: true }).catch(() => undefined);

  // Bascule (rename) — rollback si échec
  try {
    if (await existsDir(DATA_DIR)) {
      await rename(DATA_DIR, dataOld);
    }
    await rename(dataNew, DATA_DIR);
  } catch (error) {
    // Rollback si possible
    if (await existsDir(dataOld) && !(await existsDir(DATA_DIR))) {
      await rename(dataOld, DATA_DIR).catch(() => undefined);
    }
    await rm(dataNew, { recursive: true, force: true }).catch(() => undefined);
    await rm(uploadsNew, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  try {
    if (await existsDir(UPLOADS_DIR)) {
      await rename(UPLOADS_DIR, uploadsOld);
    }
    await rename(uploadsNew, UPLOADS_DIR);
  } catch (error) {
    if (await existsDir(uploadsOld) && !(await existsDir(UPLOADS_DIR))) {
      await rename(uploadsOld, UPLOADS_DIR).catch(() => undefined);
    }
    await rm(uploadsNew, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  await rm(dataOld, { recursive: true, force: true }).catch(() => undefined);
  await rm(uploadsOld, { recursive: true, force: true }).catch(() => undefined);

  return { restored, dryRun: false };
}

async function existsDir(dir: string): Promise<boolean> {
  try {
    const st = await stat(dir);
    return st.isDirectory();
  } catch {
    return false;
  }
}

export async function listBackups(): Promise<
  Array<{ id: string; createdAt: string }>
> {
  await mkdir(BACKUPS_DIR, { recursive: true });
  const entries = await readdir(BACKUPS_DIR);
  const out: Array<{ id: string; createdAt: string }> = [];
  for (const name of entries) {
    if (name === "latest.json") continue;
    try {
      const manifest = JSON.parse(
        await readFile(path.join(BACKUPS_DIR, name, "manifest.json"), "utf8"),
      ) as BackupManifest;
      out.push({ id: manifest.id, createdAt: manifest.createdAt });
    } catch {
      // ignore
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Garde les N sauvegardes les plus récentes. */
export async function pruneBackups(keep = 14): Promise<number> {
  const list = await listBackups();
  const toRemove = list.slice(keep);
  for (const item of toRemove) {
    await rm(backupRoot(item.id), { recursive: true, force: true });
  }
  return toRemove.length;
}
