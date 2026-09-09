/**
 * Remet le compteur analyze à 0 pour un email (quota mensuel).
 * Usage: npx tsx scripts/reset-analyze-quota-by-email.ts yoyo270709@gmail.com
 */
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { readFileSync, existsSync } from "fs";
import path from "path";

function loadEnv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

const root = process.cwd();
Object.assign(
  process.env,
  loadEnv(path.join(root, ".env.local")),
  loadEnv(path.join(root, ".env.cloud-beta.local")),
);

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email.includes("@")) {
  console.error("Usage: npx tsx scripts/reset-analyze-quota-by-email.ts <email>");
  process.exit(1);
}

function currentMonth(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function findUserId(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !service) {
    throw new Error("Supabase URL / SERVICE_ROLE_KEY manquants");
  }
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = data.users.find(
      (u) => u.email?.trim().toLowerCase() === email,
    );
    if (hit?.id) return hit.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) throw new Error("DATABASE_URL manquant");

  const userId = await findUserId();
  if (!userId) {
    console.error(`Aucun user pour ${email}`);
    process.exit(1);
  }

  const month = currentMonth();
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const before = await client.query(
    `select month, data from public.app_usage where user_id = $1 order by month desc limit 3`,
    [userId],
  );
  console.log("userId", userId);
  console.log("BEFORE", JSON.stringify(before.rows, null, 2));

  const empty = {
    month,
    analyze: 0,
    upload: 0,
    letter: 0,
    search: 0,
    updatedAt: new Date().toISOString(),
  };

  // Remet analyze + upload à 0 (Free: 5 analyses / 10 uploads).
  const upd = await client.query(
    `insert into public.app_usage (user_id, month, data, updated_at)
     values ($1, $2, $3::jsonb, timezone('utc', now()))
     on conflict (user_id, month) do update set
       data = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(public.app_usage.data, '{}'::jsonb),
             '{analyze}',
             '0'::jsonb,
             true
           ),
           '{upload}',
           '0'::jsonb,
           true
         ),
         '{updatedAt}',
         to_jsonb(timezone('utc', now())::text),
         true
       ),
       updated_at = timezone('utc', now())
     returning month, data`,
    [userId, month, JSON.stringify(empty)],
  );

  console.log("AFTER", JSON.stringify(upd.rows, null, 2));
  await client.end();
  console.log(
    `OK — ${email}: analyze=0 et upload=0 pour ${month} (5 analyses / 10 uploads Free).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
