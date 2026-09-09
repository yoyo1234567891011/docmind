/**
 * Vérifie analysis.amounts[] uniquement (correctif #1bis).
 * node scripts/prod-smoke-amounts-only.mjs
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

const CASES = [
  {
    id: "bail",
    file: "amounts-bail.pdf",
    lines: [
      "BAIL D'HABITATION",
      "Loyer mensuel hors charges : 1 050 €.",
      "Dépôt de garantie : 2 100 €.",
      "Capital social de l'agence : 50 000 €.",
      "Garantie financière d'agence : 120 000 €.",
    ],
    bad: /50\s*000|120\s*000|capital\s+social|garantie\s+financi/i,
    good: /1\s*050|2\s*100/,
  },
  {
    id: "taxe",
    file: "amounts-taxe.pdf",
    lines: [
      "Avis de prélèvement — Taxe foncière 2024",
      "Montant à prélever : 1 178,00 €",
      "Date de prélèvement : 27/10/2025",
      "le produit national de la taxe s'élève à 234 079 050 €",
    ],
    bad: /234\s*079\s*050|234079050/,
    good: /1\s*178/,
  },
  {
    id: "med",
    file: "amounts-med.pdf",
    lines: [
      "MISE EN DEMEURE",
      "Somme totale réclamée : 274 €.",
      "Pénalité de retard : 40 €.",
      "Frais de recouvrement : 23 €.",
    ],
    bad: null,
    good: /274|40|23/,
  },
];

async function runOne(page, header, token, spec) {
  const pdfPath = path.join(OUT_DIR, spec.file);
  await writePdf(pdfPath, spec.lines);
  const csrfRes = await page.request.get(`${BASE}/api/csrf`);
  const csrfJson = await csrfRes.json();
  const t = csrfJson?.data?.token || token;
  const h = csrfJson?.data?.headerName || header;

  const uploadRes = await page.request.post(`${BASE}/api/upload`, {
    headers: { [h]: t },
    multipart: {
      file: {
        name: spec.file,
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
  const fileName = uploadJson.data?.document?.fileName || spec.file;

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
  const amounts = hj?.data?.analysis?.amounts || [];
  const joined = amounts.join(" | ");
  const noBad = spec.bad ? !spec.bad.test(joined) : true;
  const hasGood = spec.good.test(joined);
  const pass = noBad && hasGood;
  console.log(
    JSON.stringify(
      { id: spec.id, pass, amounts, noBad, hasGood },
      null,
      2,
    ),
  );
  return pass;
}

async function main() {
  loadEnv();
  mkdirSync(OUT_DIR, { recursive: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const email = `smoke+amounts+${Date.now()}@docmind.test`;
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
  let allPass = true;
  try {
    const page = await browser.newPage();
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

    for (const spec of CASES) {
      const ok = await runOne(page, header, token, spec);
      if (!ok) allPass = false;
    }
  } finally {
    await browser.close().catch(() => undefined);
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
  console.log(allPass ? "\nAMOUNTS ONLY: PASS" : "\nAMOUNTS ONLY: FAIL");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
