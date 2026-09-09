import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import { randomBytes } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const BASE = "https://docmind-blond.vercel.app";
const PDF = path.join(root, "e2e", "fixtures", "smoke-tmp", "table-bail.pdf");

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollJob(page, jobId, label) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < 200_000) {
    const data = (await (await page.request.get(`${BASE}/api/analysis-jobs/${encodeURIComponent(jobId)}`)).json())?.data;
    if (!last || last.status !== data.status || last.attempts !== data.attempts) {
      console.log(`[${label}] +${((Date.now()-started)/1000).toFixed(1)}s status=${data.status} attempts=${data.attempts}`);
    }
    last = data;
    if (data.status === "completed" || data.status === "failed") {
      return { durationSec: +((Date.now() - started) / 1000).toFixed(1), final: data };
    }
    await sleep(4000);
  }
  return { durationSec: +((Date.now() - started) / 1000).toFixed(1), final: last, timedOut: true };
}

async function runAnalysis(page, csrfHeader, csrfToken, n) {
  const csrf = await page.request.get(`${BASE}/api/csrf`);
  const cj = await csrf.json();
  const token = cj?.data?.token || csrfToken;
  const header = cj?.data?.headerName || csrfHeader;
  const up = await page.request.post(`${BASE}/api/upload`, {
    headers: { [header]: token },
    multipart: { file: { name: "table-bail.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) } },
    timeout: 120_000,
  });
  const uj = await up.json();
  const ar = await page.request.post(`${BASE}/api/analyze`, {
    headers: { "Content-Type": "application/json", [header]: token },
    data: {
      documentId: uj.data?.document?.id || uj.data?.documentId,
      text: uj.data?.extraction?.text || "",
      fileName: "table-bail.pdf",
      pages: uj.data?.extraction?.pages,
      mode: "progressive",
      skipReadyReply: true,
    },
    timeout: 180_000,
  });
  const aj = await ar.json();
  const jobId = aj.data?.jobId;
  console.log(`[analyse-${n}] jobId=${jobId}`);
  return pollJob(page, jobId, `analyse-${n}`);
}

async function main() {
  loadEnv();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `perf+${Date.now()}@docmind.test`;
  const password = `Sm0ke!${randomBytes(9).toString("base64url")}`;
  const { data: { user } } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/auth/login`);
    await page.locator("label").filter({ hasText: /^Email$/ }).locator("input").fill(email);
    await page.locator("label").filter({ hasText: /^Mot de passe$/ }).locator("input").fill(password);
    await page.getByRole("button", { name: /Se connecter|Connexion/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/auth/login"), { timeout: 60000 });
    const csrf = await page.request.get(`${BASE}/api/csrf`);
    const cj = await csrf.json();
    const r1 = await runAnalysis(page, cj.data.headerName, cj.data.token, 1);
    const r2 = await runAnalysis(page, cj.data.headerName, cj.data.token, 2);
    console.log(JSON.stringify({ r1, r2 }, null, 2));
  } finally {
    await browser.close();
    await admin.auth.admin.deleteUser(user.id);
  }
}

main();
