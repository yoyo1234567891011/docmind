import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import path from "path";

for (const name of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), name);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: tsx scripts/inspect-job-metrics.ts <jobId>");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await admin
    .from("app_analysis_jobs")
    .select(
      "id,status,attempts,metrics,created_at,started_at,completed_at,last_error,file_name",
    )
    .eq("id", id)
    .maybeSingle();

  console.log(JSON.stringify({ error, data }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
