/**
 * Diagnostique bail + taxe : où apparaissent capital social / 234M.
 * node scripts/prod-smoke-diag-amounts.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { createWriteStream, existsSync, readFileSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const BASE = "https://docmind-blond.vercel.app";
const OUT_DIR = path.join(root, "e2e", "fixtures", "smoke-tmp");

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
      )
        v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function writePdf(filePath, lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const stream = createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(11);
    for (const line of lines) {
      doc.text(line, { width: 500 });
      doc.moveDown(0.35);
    }
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

async function runOne(page, header, token, id, file, lines, badRe) {
  const pdfPath = path.join(OUT_DIR, file);
  await writePdf(pdfPath, lines);
  const csrfRes = await page.request.get(`${BASE}/api/csrf`);
  const csrfJson = await csrfRes.json();
  const t = csrfJson?.data?.token || token;
  const h = csrfJson?.data?.headerName || header;

  const uploadRes = await page.request.post(`${BASE}/api/upload`, {
    headers: { [h]: t },
    multipart: {
      file: {
        name: file,
        mimeType: "application/pdf",
        buffer: readFileSync(pdfPath),
      },
    },
    timeout: 120_000,
  });
  const uploadJson = await uploadRes.json();
  const documentId =
    uploadJson.data?.document?.id || uploadJson.data?.documentId;
  const text = uploadJson.data?.extraction?.text || "";
  const pages = uploadJson.data?.extraction?.pages;
  const fileName = uploadJson.data?.document?.fileName || file;

  const analyzeRes = await page.request.post(`${BASE}/api/analyze`, {
    headers: { "Content-Type": "application/json", [h]: t },
    data: {
      documentId,
      text,
      fileName,
      pages,
      mode: "progressive",
      skipReadyReply: true,
    },
    timeout: 180_000,
  });
  const analyzeJson = await analyzeRes.json();
  const jobId = analyzeJson.data?.jobId;
  const historyId = analyzeJson.data?.historyId;
  if (jobId) {
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      const jobRes = await page.request.get(
        `${BASE}/api/analysis-jobs/${encodeURIComponent(jobId)}`,
      );
      const st = (await jobRes.json())?.data?.status;
      if (st === "completed" || st === "failed") break;
      await sleep(4000);
    }
  }
  const hj = await (
    await page.request.get(
      `${BASE}/api/history/${encodeURIComponent(historyId)}`,
    )
  ).json();
  const a = hj?.data?.analysis || {};
  const buckets = {
    summary: a.summary || "",
    important_points: a.important_points || [],
    risks: a.risks || [],
    actions: a.actions || [],
    amounts: a.amounts || [],
    risk_findings: (a.risk_findings || []).map((f) => f.description),
    risk_excerpts: (a.risk_findings || []).map((f) => f.excerpt),
    risk_explanation: a.risk_explanation || "",
  };
  const hits = {};
  for (const [k, v] of Object.entries(buckets)) {
    const s = Array.isArray(v) ? v.join("\n") : String(v);
    if (badRe.test(s)) hits[k] = Array.isArray(v) ? v.filter((x) => badRe.test(String(x))) : s.slice(0, 240);
  }
  console.log(`\n=== ${id} bad hits ===`);
  console.log(JSON.stringify(hits, null, 2));
}

async function main() {
  loadEnv();
  mkdirSync(OUT_DIR, { recursive: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const email = `smoke+diag+${Date.now()}@docmind.test`;
  const password = `Sm0ke!${randomBytes(9).toString("base64url")}`;
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const userId = created.data.user.id;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(90_000);
    await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
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
      timeout: 60_000,
    });
    const csrfJson = await (await page.request.get(`${BASE}/api/csrf`)).json();
    const token = csrfJson?.data?.token;
    const header = csrfJson?.data?.headerName || "x-csrf-token";

    await runOne(
      page,
      header,
      token,
      "bail",
      "diag-bail.pdf",
      [
        "BAIL D'HABITATION",
        "Loyer mensuel hors charges : 1 050 €.",
        "Dépôt de garantie : 2 100 €.",
        "Capital social de l'agence : 50 000 €.",
        "Garantie financière d'agence : 120 000 €.",
      ],
      /50\s*000|120\s*000|capital\s+social|garantie\s+financi/i,
    );

    await runOne(
      page,
      header,
      token,
      "taxe",
      "diag-taxe.pdf",
      [
        "Avis de prélèvement — Taxe foncière 2024",
        "Montant à prélever : 1 178,00 €",
        "Date de prélèvement : 27/10/2025",
        "le produit national de la taxe s'élève à 234 079 050 €",
      ],
      /234\s*079\s*050|234079050/,
    );
  } finally {
    await browser.close().catch(() => undefined);
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
