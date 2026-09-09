/**
 * Relance isolée 3 docs (après échecs TPM) — pause 180s entre chaque.
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
  { id: "bail", pdf: "e2e/fixtures/smoke-tmp/table-bail.pdf" },
  { id: "med", pdf: "e2e/fixtures/smoke-tmp/table-med.pdf" },
  { id: "banque", pdf: "e2e/fixtures/smoke-tmp/table-banque.pdf" },
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

function formatDiag(diag) {
  if (!diag) return null;
  return {
    Queue: sec(diag.queueMs),
    Preparation: sec(diag.preparationMs),
    PreLlmWait: sec(diag.preLlmWaitMs),
    Network_TTFB: sec(diag.networkTtfbMs),
    LLM_WAIT_proxy: sec(diag.llmWaitMs),
    LLM_GENERATE_proxy: sec(diag.llmGenerateProxyMs),
    LLM_TOTAL: sec(diag.llmTotalMs),
    Parsing: sec(diag.parsingMs),
    Salvage: sec(diag.salvageMs),
    Score: sec(diag.scoreMs),
    Verify: sec(diag.verifyMs),
    DB_history: sec(diag.historyDbMs),
    Notify: sec(diag.notifyMs),
    Memory: sec(diag.memoryMs),
    TOTAL: sec(diag.totalMs),
    meta: diag.meta,
  };
}

async function runOne(page, header, token, doc) {
  const pdfPath = path.join(root, doc.pdf);
  const csrf = await page.request.get(`${BASE}/api/csrf`);
  const cj = await csrf.json();
  const h = cj?.data?.headerName || header;
  const t = cj?.data?.token || token;
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
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 200_000) {
    last = (await (await page.request.get(`${BASE}/api/analysis-jobs/${encodeURIComponent(jobId)}`)).json())?.data;
    if (last.status === "completed" || last.status === "failed") break;
    await sleep(2000);
  }
  return {
    id: doc.id,
    jobId,
    status: last?.status,
    attempts: last?.attempts,
    lastError: last?.lastError,
    metrics: last?.metrics,
    latency: formatDiag(last?.metrics?.latencyDiag),
    rawLatencyDiag: last?.metrics?.latencyDiag ?? null,
  };
}

async function main() {
  loadEnv();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `latency2+${Date.now()}@docmind.test`;
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
      for (let tryN = 1; tryN <= 3; tryN += 1) {
        row = await runOne(page, cj.data.headerName, cj.data.token, doc);
        console.log(JSON.stringify(row.latency || { status: row.status, error: row.lastError, attempts: row.attempts }, null, 2));
        if (row.status === "completed" && row.rawLatencyDiag) break;
        console.log(`[${doc.id}] retry ${tryN}/3 after 180s…`);
        await sleep(180_000);
      }
      results.push(row);
      await sleep(180_000);
    }
  } finally {
    await browser.close();
    if (user?.id) await admin.auth.admin.deleteUser(user.id);
  }
  mkdirSync(path.join(root, "reports"), { recursive: true });
  const out = path.join(root, "reports", "latency-diag-3docs-retry.json");
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`[saved] ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
