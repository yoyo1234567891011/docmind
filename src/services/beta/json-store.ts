import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { SYSTEM_DIR } from "@/config/paths";

async function ensureSystemDir(): Promise<void> {
  await mkdir(SYSTEM_DIR, { recursive: true });
}

export async function readJsonArrayFile<T>(filePath: string): Promise<T[]> {
  await ensureSystemDir();
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { entries?: T[] } | T[];
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.entries)) return parsed.entries;
    return [];
  } catch {
    return [];
  }
}

export async function writeJsonArrayFile<T>(
  filePath: string,
  entries: T[],
): Promise<void> {
  await ensureSystemDir();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify({ entries, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

export async function appendJsonArrayEntry<T extends { id: string; at: string }>(
  filePath: string,
  entry: T,
  maxEntries = 2_000,
): Promise<T> {
  const entries = await readJsonArrayFile<T>(filePath);
  const next = [entry, ...entries].slice(0, maxEntries);
  await writeJsonArrayFile(filePath, next);
  return entry;
}
