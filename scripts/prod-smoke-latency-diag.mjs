/**
 * Diagnostic latence — 5 analyses prod, collecte metrics.latencyDiag.
 * Usage: node scripts/prod-smoke-latency-diag.mjs
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
  { id: "facture", pdf: "e2e/fixtures/smoke-tmp/amounts-taxe.pdf" },
  { id: "bail", pdf: "e2e/fixtures/smoke-tmp/table-bail.pdf" },
  { id: "med", pdf: "e2e/fixtures/smoke-tmp/table-med.pdf" },
  { id: "banque", pdf: "e2e/fixtures/smoke-tmp/table-banque.pdf" },
  { id: "pret", pdf: "e2e/fixtures/smoke-tmp/table-pret.pdf" },
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
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sec(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  return +(ms / 1000).toFixed(3);
}

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

async function runOne(page, csrfHeader, csrfToken, doc) {
  const pdfPath = path.join(root, doc.pdf);
  if (!existsSync(pdfPath)) throw new Error(`PDF manquant: ${pdfPath}`);

  const csrf = await page.request.get(`${BASE}/api/csrf`);
  const cj = await csrf.json();
  const token = cj?.data?.token || csrfToken;
  const header = cj?.data?.headerName || csrfHeader;

  const tClient0 = Date.now();
  const up = await page.request.post(`${BASE}/api/upload`, {
    headers: { [header]: token },
    multipart: {
      file: {
        name: path.basename(pdfPath),
        mimeType: "application/pdf",
        buffer: readFileSync(pdfPath),
      },
    },
    timeout: 120_000,
  });
  const uj = await up.json();
  if (!up.ok()) throw new Error(`upload ${up.status()}: ${JSON.stringify(uj)}`);

  const ar = await page.request.post(`${BASE}/api/analyze`, {
    headers: { "Content-Type": "application/json", [header]: token },
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
  if (!ar.ok()) throw new Error(`analyze ${ar.status()}: ${JSON.stringify(aj)}`);

  const jobId = aj.data?.jobId;
  const p1Ms = aj.data?.durationMs ?? null;
  const pollStarted = Date.now();
  let last = null;
  while (Date.now() - pollStarted < 200_000) {
    const data = (
      await (
        await page.request.get(
          `${BASE}/api/analysis-jobs/${encodeURIComponent(jobId)}`,
        )
      ).json()
    )?.data;
    last = data;
    if (data.status === "completed" || data.status === "failed") break;
    await sleep(2000);
  }
  const clientWallMs = Date.now() - tClient0;

  return {
    id: doc.id,
    jobId,
    status: last?.status,
    attempts: last?.attempts,
    lastError: last?.lastError,
    p1Ms,
    clientWallMs,
    metrics: last?.metrics ?? null,
    latency: formatDiag(last?.metrics?.latencyDiag),
    rawLatencyDiag: last?.metrics?.latencyDiag ?? null,
  };
}

async function main() {
  loadEnv();
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const email = `latency+${Date.now()}@docmind.test`;
  const password = `Sm0ke!${randomBytes(9).toString("base64url")}`;
  const {
    data: { user },
  } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/auth/login`);
    await page
      .locator("label")
      .filter({ hasText: /^Email$/ })
      .locator("input")
      .fill(email);
    await page
      .locator("label")
      .filter({ hasText: /^Mot de passe$/ })
      .locator("input")
      .fill(password);
    await page.getByRole("button", { name: /Se connecter|Connexion/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/auth/login"), {
      timeout: 60000,
    });
    const csrf = await page.request.get(`${BASE}/api/csrf`);
    const cj = await csrf.json();

    for (const doc of DOCS) {
      console.log(`\n=== ${doc.id} ===`);
      try {
        const row = await runOne(page, cj.data.headerName, cj.data.token, doc);
        results.push(row);
        console.log(JSON.stringify(row.latency || { status: row.status, error: row.lastError }, null, 2));
        // pause TPM entre docs (fenêtre Groq 60s + marge)
        await sleep(120_000);
      } catch (e) {
        console.error(`[${doc.id}] FAIL`, e.message);
        results.push({ id: doc.id, error: e.message });
        await sleep(30_000);
      }
    }
  } finally {
    await browser.close();
    if (user?.id) await admin.auth.admin.deleteUser(user.id);
  }

  mkdirSync(path.join(root, "reports"), { recursive: true });
  const out = path.join(root, "reports", "latency-diag-5docs.json");
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`\n[saved] ${out}`);

  const ok = results.filter((r) => r.rawLatencyDiag);
  if (ok.length) {
    const avg = (key) =>
      +(
        ok.reduce((s, r) => s + (r.rawLatencyDiag[key] ?? 0), 0) / ok.length / 1000
      ).toFixed(3);
    console.log("\n=== MOYENNES (s) ===");
    console.log({
      n: ok.length,
      Queue: avg("queueMs"),
      Preparation: avg("preparationMs"),
      Network_TTFB: avg("networkTtfbMs"),
      LLM_GENERATE_proxy: avg("llmGenerateProxyMs"),
      LLM_TOTAL: avg("llmTotalMs"),
      Parsing: avg("parsingMs"),
      Verify: avg("verifyMs"),
      DB_history: avg("historyDbMs"),
      Notify: avg("notifyMs"),
      TOTAL: avg("totalMs"),
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
