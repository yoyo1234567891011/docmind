/**
 * Mesure latence jusqu'à completed (facture + bail), pause TPM 120s.
 * node scripts/prod-smoke-latency-after.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const BASE = "https://docmind-blond.vercel.app";
const DOCS = [
  { id: "facture", pdf: "e2e/fixtures/sample.pdf" },
  { id: "bail", pdf: "e2e/fixtures/smoke-tmp/table-bail.pdf" },
];

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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sec = (ms) => (ms == null || !Number.isFinite(ms) ? null : +(ms / 1000).toFixed(3));

async function runOne(page, header, token, doc) {
  const pdfPath = path.join(root, doc.pdf);
  if (!existsSync(pdfPath)) throw new Error(`missing ${pdfPath}`);
  const csrf = await page.request.get(`${BASE}/api/csrf`);
  const cj = await csrf.json();
  const h = cj?.data?.headerName || header;
  const t = cj?.data?.token || token;

  const t0 = Date.now();
  const up = await page.request.post(`${BASE}/api/upload`, {
    headers: { [h]: t },
    multipart: {
      file: { name: path.basename(pdfPath), mimeType: "application/pdf", buffer: readFileSync(pdfPath) },
    },
    timeout: 120_000,
  });
  const uj = await up.json();
  const ar = await page.request.post(`${BASE}/api/analyze`, {
    headers: { "Content-Type": "application/json", [h]: t },
    data: {
      documentId: uj.data?.document?.id || uj.data?.documentId,
      text: uj.data?.extraction?.text || "",
      fileName: path.basename(pdfPath),
      pages: uj.data?.extraction?.pages,
      mode: "progressive",
      skipReadyReply: true,
    },
    timeout: 180_000,
  });
  const aj = await ar.json();
  const jobId = aj.data?.jobId;
  const historyId = aj.data?.historyId;
  let last = null;
  let completedClientMs = null;
  while (Date.now() - t0 < 200_000) {
    last = (await (await page.request.get(`${BASE}/api/analysis-jobs/${encodeURIComponent(jobId)}`)).json())?.data;
    if (last?.status === "completed" || last?.status === "failed") {
      completedClientMs = Date.now() - t0;
      break;
    }
    await sleep(1000);
  }

  // Vérifier memory continue après completed (poll history)
  let memorySyncedAfter = null;
  if (last?.status === "completed" && historyId) {
    for (let i = 0; i < 40; i += 1) {
      const hr = await page.request.get(`${BASE}/api/history/${encodeURIComponent(historyId)}`);
      const hj = await hr.json();
      const rec = hj?.data;
      if (rec?.memorySyncedAt || rec?.relationsPhase === "ready" || rec?.relationsPhase === "failed") {
        memorySyncedAfter = {
          memorySyncedAt: rec.memorySyncedAt ?? null,
          relationsPhase: rec.relationsPhase ?? null,
          afterCompleteMs: Date.now() - t0 - (completedClientMs || 0),
        };
        break;
      }
      await sleep(500);
    }
  }

  const d = last?.metrics?.latencyDiag;
  return {
    id: doc.id,
    jobId,
    status: last?.status,
    attempts: last?.attempts,
    lastError: last?.lastError,
    clientUntilCompletedSec: sec(completedClientMs),
    metrics: {
      queueWaitMs: last?.metrics?.queueWaitMs,
      generateMs: last?.metrics?.generateMs,
      historyMs: last?.metrics?.historyMs,
      memoryMs: last?.metrics?.memoryMs,
      totalMs: last?.metrics?.totalMs,
      totalTokens: last?.metrics?.totalTokens,
    },
    latencyDiag: d
      ? {
          Queue: sec(d.queueMs),
          LLM_TOTAL: sec(d.llmTotalMs),
          History: sec(d.historyDbMs),
          Notify_at_complete: sec(d.notifyMs),
          Memory_at_complete: sec(d.memoryMs),
          TOTAL_until_complete: sec(d.totalMs),
          model: d.meta?.model,
        }
      : null,
    memoryAfterComplete: memorySyncedAfter,
    analysisPhase: null,
  };
}

async function main() {
  loadEnv();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `lat-after+${Date.now()}@docmind.test`;
  const password = `Sm0ke!${randomBytes(9).toString("base64url")}`;
  const { data: { user } } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/auth/login`);
    await page.locator("label").filter({ hasText: /^Email$/ }).locator("input").fill(email);
    await page.locator("label").filter({ hasText: /^Mot de passe$/ }).locator("input").fill(password);
    await page.getByRole("button", { name: /Se connecter|Connexion/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/auth/login"), { timeout: 60000 });
    const csrf = await page.request.get(`${BASE}/api/csrf`);
    const cj = await csrf.json();

    for (const doc of DOCS) {
      console.log(`\n=== ${doc.id} ===`);
      let row = null;
      for (let tryN = 1; tryN <= 2; tryN += 1) {
        row = await runOne(page, cj.data.headerName, cj.data.token, doc);
        console.log(JSON.stringify(row, null, 2));
        if (row.status === "completed") break;
        console.log(`retry ${tryN} after 120s…`);
        await sleep(120_000);
      }
      results.push(row);
      await sleep(120_000);
    }
  } finally {
    await browser.close();
    if (user?.id) await admin.auth.admin.deleteUser(user.id);
  }
  mkdirSync(path.join(root, "reports"), { recursive: true });
  const out = path.join(root, "reports", "latency-after-async.json");
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`[saved] ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
