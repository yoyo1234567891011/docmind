/**
 * Smoke prod — tableau amounts + watch (5 docs).
 * node scripts/prod-smoke-table.mjs
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

const LABELS = {
  bail: "Bail",
  taxe: "Taxe foncière",
  med: "MED",
  banque: "Banque",
  pret: "Prêt",
};

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

const DOCS = [
  {
    id: "bail",
    file: "table-bail.pdf",
    lines: [
      "BAIL D'HABITATION",
      "Durée du bail : 3 ans.",
      "Loyer mensuel hors charges : 1 050 €.",
      "Provisions pour charges : 80 € par mois.",
      "Dépôt de garantie : 2 100 €.",
      "Tacite reconduction.",
      "Préavis locataire : 3 mois.",
      "Honoraires : 450 €.",
      "Capital social de l'agence : 50 000 €.",
      "Garantie financière d'agence : 120 000 €.",
    ],
    checks: [
      (a, w) => w.some((t) => /loyer/i.test(t)) && w.some((t) => /d[ée]p[ôo]t/i.test(t)),
      (a) => !/50\s*000|120\s*000|capital\s+social|garantie\s+financi/i.test(allText(a)),
    ],
  },
  {
    id: "taxe",
    file: "table-taxe.pdf",
    lines: [
      "Avis de prélèvement — Taxe foncière 2024",
      "Montant à prélever : 1 178,00 €",
      "Date de prélèvement : 27/10/2025",
      "Opposition possible avant le 01/10/2025.",
      "le produit national de la taxe s'élève à 234 079 050 €",
    ],
    checks: [
      (a) => /1\s*178|taxe\s+fonci|pr[ée]l[eè]v/i.test(allText(a)),
      (a) => !/234\s*079\s*050|234079050/.test(allText(a)),
    ],
  },
  {
    id: "med",
    file: "table-med.pdf",
    lines: [
      "MISE EN DEMEURE",
      "Somme totale de 274 € sous 8 jours.",
      "Pénalité de retard : 40 €.",
      "Frais de recouvrement : 23 €.",
      "Huissier en cas de défaut.",
    ],
    checks: [
      (a) => /274|40|23|recouvrement|p[ée]nalit|total/i.test(allText(a)),
      (a) => /huissier|8\s*jours|contest/i.test(allText(a)),
    ],
  },
  {
    id: "banque",
    file: "table-banque.pdf",
    lines: [
      "RELEVÉ DE COMPTE",
      "Frais de tenue de compte : 2,00 €",
      "Commission d'intervention : 8,00 €",
      "Intérêts débiteurs : 3,45 €",
      "Frais de rejet : 15,00 €",
    ],
    checks: [
      (a) => /tenue|commission|intervention|int[ée]r[êe]ts|rejet|8|15/i.test(allText(a)),
      (a) => {
        const w = watchTitles(a).join(" | ");
        return !/r[ée]silier\s*\/\s*modifier/i.test(w);
      },
    ],
  },
  {
    id: "pret",
    file: "table-pret.pdf",
    lines: [
      "OFFRE DE PRÊT IMMOBILIER",
      "Capital emprunté : 220 000 €",
      "TAEG : 3,45 %",
      "Mensualité : 1 120 €",
      "Frais de dossier : 500 €",
      "Pénalité remboursement anticipé : 1 %",
      "Délai de rétractation : 14 jours.",
    ],
    checks: [
      (a) => /220\s*000|TAEG|1\s*120|500|remboursement|r[ée]tractation/i.test(allText(a)),
      (a) => !/tacite\s+reconduction/i.test(allText(a)),
    ],
  },
];

function watchTitles(analysis) {
  const findings = (analysis.risk_findings || [])
    .filter((f) => f.status !== "rejected")
    .map((f) => f.description || "");
  if (findings.length) return findings;
  return analysis.important_points || [];
}

function allText(analysis) {
  return [
    analysis.summary,
    ...(analysis.amounts || []),
    ...watchTitles(analysis),
    ...((analysis.risk_findings || []).map((f) =>
      [f.description, f.excerpt].filter(Boolean).join(" "),
    )),
  ]
    .filter(Boolean)
    .join("\n");
}

async function analyzeOne(page, csrfHeader, csrfToken, doc) {
  const pdfPath = path.join(OUT_DIR, doc.file);
  await writePdf(pdfPath, doc.lines);
  const csrfRes = await page.request.get(`${BASE}/api/csrf`);
  const csrfJson = await csrfRes.json();
  const token = csrfJson?.data?.token || csrfToken;
  const header = csrfJson?.data?.headerName || csrfHeader;

  const uploadRes = await page.request.post(`${BASE}/api/upload`, {
    headers: { [header]: token },
    multipart: {
      file: {
        name: doc.file,
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
  const fileName = uploadJson.data?.document?.fileName || doc.file;

  const analyzeRes = await page.request.post(`${BASE}/api/analyze`, {
    headers: { "Content-Type": "application/json", [header]: token },
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
      process.stdout.write(`  [${doc.id}] ${st}\n`);
      if (st === "completed" || st === "failed") break;
      await sleep(4000);
    }
  }

  const hj = await (
    await page.request.get(
      `${BASE}/api/history/${encodeURIComponent(historyId)}`,
    )
  ).json();
  const analysis = hj?.data?.analysis || {};
  const watch = watchTitles(analysis).slice(0, 5);
  const amounts = analysis.amounts || [];
  const ok = doc.checks.every((fn) => fn(analysis, watch));

  return {
    id: doc.id,
    label: LABELS[doc.id],
    ok,
    amounts,
    watch,
    error: null,
  };
}

async function main() {
  loadEnv();
  mkdirSync(OUT_DIR, { recursive: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const email = `smoke+table+${Date.now()}@docmind.test`;
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
  const rows = [];

  const browser = await chromium.launch({ headless: true });
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

    for (const doc of DOCS) {
      console.log(`\n=== ${doc.id} ===`);
      try {
        rows.push(await analyzeOne(page, header, token, doc));
      } catch (e) {
        rows.push({
          id: doc.id,
          label: LABELS[doc.id],
          ok: false,
          amounts: [],
          watch: [],
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }

  console.log("\n--- TABLE_JSON ---");
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
