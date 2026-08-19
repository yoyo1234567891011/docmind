/**
 * Charge .env puis .env.local dans process.env (sans dépendre de dotenv).
 * N’écrase pas les variables déjà définies, sauf override=true.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type LoadEnvResult = {
  files: string[];
  keysLoaded: number;
};

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnvFiles(
  root = process.cwd(),
  options?: { override?: boolean; files?: string[] },
): LoadEnvResult {
  const override = options?.override === true;
  const names = options?.files ?? [".env", ".env.local"];
  const files: string[] = [];
  let keysLoaded = 0;

  for (const name of names) {
    const filePath = path.join(root, name);
    if (!existsSync(filePath)) continue;
    files.push(name);
    const parsed = parseEnvFile(readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (!override && process.env[key] !== undefined) continue;
      process.env[key] = value;
      keysLoaded += 1;
    }
  }

  return { files, keysLoaded };
}

/** Liste présence (SET/ABSENT) sans exposer les valeurs. */
export function envPresence(keys: string[]): Record<string, "SET" | "ABSENT"> {
  const out: Record<string, "SET" | "ABSENT"> = {};
  for (const key of keys) {
    out[key] = process.env[key]?.trim() ? "SET" : "ABSENT";
  }
  return out;
}
