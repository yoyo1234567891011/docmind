/**
 * Smoke prod qualité — tableau final (relevé, MED, bail, taxe, facture).
 * node scripts/prod-smoke-quality-table.mjs
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
const BASE = process.env.SMOKE_BASE_URL?.trim() || "https://docmind-blond.vercel.app";
const OUT_DIR = path.join(root, "e2e", "fixtures", "smoke-tmp");

const DOCS = [
  {
    type: "Relevé bancaire",
    id: "banque",
    file: "quality-banque.pdf",
    lines: [
      "RELEVÉ DE COMPTE BANCAIRE",
      "Période du 01/03/2025 au 31/03/2025",
      "Frais de tenue de compte : 2,00 €",
      "Commission d'intervention : 8,00 €",
      "Intérêts débiteurs : 3,45 €",
      "Frais de rejet de prélèvement : 15,00 €",
      "Inscription FICP possible en cas de défaut.",
      "Date de régularisation : 28/02/2025",
    ],
  },
  {
    type: "Mise en demeure",
    id: "med",
    file: "quality-med.pdf",
    lines: [
      "MISE EN DEMEURE",
      "Somme totale de 274 € sous 8 jours.",
      "Pénalité de retard : 40 €.",
      "Frais de recouvrement : 23 €.",
      "Huissier en cas de défaut.",
      "Délai de 10 jours pour contester.",
    ],
  },
  {
    type: "1ère relance",
    id: "relance",
    file: "quality-relance.pdf",
    lines: [
      "1ère relance de paiement",
      "Montant impayé : 749,02 €",
      "Principal : 749,02 €",
      "Pénalités de retard : 43 €",
      "Frais de recouvrement : 30 €",
      "Total réclamé : 822 €",
      "Règlement exigé sous 8 jours, au plus tard le 25/05/2026.",
      "Transmission à un huissier possible.",
      "Contester par écrit sous 10 jours si désaccord.",
    ],
  },
  {
    type: "Bail",
    id: "bail",
    file: "quality-bail.pdf",
    lines: [
      "BAIL D'HABITATION",
      "Durée du bail : 3 ans.",
      "Loyer mensuel hors charges : 1 050 €.",
      "Provisions pour charges : 80 € par mois.",
      "Dépôt de garantie : 2 100 €.",
      "Tacite reconduction.",
      "Préavis locataire : 3 mois.",
      "Honoraires : 450 €.",
    ],
  },
  {
    type: "Avis fiscal",
    id: "taxe",
    file: "quality-taxe.pdf",
    lines: [
      "Avis de prélèvement — Taxe foncière 2024",
      "Montant à prélever : 1 178,00 €",
      "Date de prélèvement : 27/10/2025",
      "Opposition possible avant le 01/10/2025.",
      "Majoration de 10 % en cas de retard.",
      "le produit national de la taxe s'élève à 234 079 050 €",
    ],
  },
  {
    type: "Facture électricité",
    id: "facture",
    file: "quality-facture.pdf",
    lines: [
      "FACTURE ÉLECTRICITÉ",
      "Abonnement : 21,50 €",
      "Total TTC à payer : 90,37 €",
      "Date limite de paiement : 15/09/2025",
      "Pénalités de retard : 10 € après échéance.",
      "En l'absence de règlement sous 15 jours, mise en demeure puis coupure possible.",
    ],
  },
];

function loadEnv() {
  for (const name of [".env.local", ".env.cloud-beta.local", ".env"]) {
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

function watchTitles(analysis) {
  const findings = (analysis.risk_findings || [])
    .filter((f) => f.status !== "rejected")
    .map((f) => f.description || "");
  if (findings.length) return findings;
  return analysis.important_points || [];
}

function isSalvage(analysis) {
  const s = String(analysis.summary || "");
  return (
    /Analyse de secours|extraction locale seule|multi-agents incomplète/i.test(
      s,
    ) || /Analyse partielle\s*:/i.test(s)
  );
}

async function analyzeOne(page, csrfHeader, csrfToken, doc) {
  const pdfPath = path.join(OUT_DIR, doc.file);
  await writePdf(pdfPath, doc.lines);

  const csrfJson = await (await page.request.get(`${BASE}/api/csrf`)).json();
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
  if (!uploadRes.ok() || !uploadJson.success) {
    throw new Error(uploadJson?.error?.message || `upload ${uploadRes.status()}`);
  }

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

  let jobFinal = null;
  if (jobId) {
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const jobRes = await page.request.get(
        `${BASE}/api/analysis-jobs/${encodeURIComponent(jobId)}`,
      );
      const jobJson = await jobRes.json();
      const st = jobJson?.data?.status;
      process.stdout.write(`  [${doc.id}] ${st}\n`);
      if (st === "completed" || st === "failed") {
        jobFinal = jobJson.data;
        break;
      }
      await sleep(4000);
    }
  }

  const hj = historyId
    ? await (
        await page.request.get(
          `${BASE}/api/history/${encodeURIComponent(historyId)}`,
        )
      ).json()
    : { data: null };
  const analysis = hj?.data?.analysis || {};
  const metrics = jobFinal?.metrics || {};
  const diag = metrics.latencyDiag || {};
  const jsonRetry =
    (diag.meta?.jsonBundleRetries ?? 0) > 0 ||
    (diag.salvageMs ?? 0) > 0 ||
    diag.meta?.salvaged === true;

  return {
    type: doc.type,
    status: jobFinal?.status || "timeout",
    generateMs: metrics.generateMs ?? null,
    totalTokens: metrics.totalTokens ?? null,
    topPoints: watchTitles(analysis).slice(0, 5),
    amounts: (analysis.amounts || []).slice(0, 6),
    secours: isSalvage(analysis),
    jsonRetry,
    error: jobFinal?.lastError || null,
  };
}

async function main() {
  loadEnv();
  mkdirSync(OUT_DIR, { recursive: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !service) throw new Error("Supabase env manquant");

  const health = await fetch(`${BASE}/api/health`, { cache: "no-store" });
  console.log(`[health] ${health.status} ${BASE}`);

  const email = `smoke+quality+${Date.now()}@docmind.test`;
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

    const only = process.argv.slice(2);
    const docs =
      only.length > 0 ? DOCS.filter((d) => only.includes(d.id)) : DOCS;

    for (const doc of docs) {
      console.log(`\n=== ${doc.type} ===`);
      try {
        rows.push(await analyzeOne(page, header, token, doc));
      } catch (e) {
        rows.push({
          type: doc.type,
          status: "error",
          generateMs: null,
          totalTokens: null,
          topPoints: [],
          secours: false,
          jsonRetry: false,
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

  const checks = {
    facture: (r) => {
      const top = r.topPoints[0] || "";
      const amounts = (r.amounts || []).join(" | ");
      return {
        ttcFirst: /^Total\s+TTC/i.test(top),
        aboNotTtc:
          !/abonnement.*total\s+ttc/i.test(amounts) &&
          (!amounts.includes("21,50") || /abonnement/i.test(amounts)),
      };
    },
    relance: (r) => {
      const joined = r.topPoints.join(" | ");
      return {
        totalOrPrincipal:
          /^Total\s+r[ée]clam|^Principal\s*\/\s*montant\s+impay/i.test(
            r.topPoints[0] || "",
          ),
        noResilier: !/r[ée]silier\s*\/\s*modifier/i.test(joined),
        penalites: /p[ée]nalit.*43|43.*p[ée]nalit/i.test(joined),
      };
    },
    med: (r) => ({
      totalFirst: /^Total\s+r[ée]clam/i.test(r.topPoints[0] || ""),
    }),
  };

  console.log("\n--- QUALITY_CHECKS ---");
  for (const r of rows) {
    const id = DOCS.find((d) => d.type === r.type)?.id;
    if (id && checks[id]) {
      console.log(id, checks[id](r));
    }
  }

  const allOk = rows.every(
    (r) =>
      r.status === "completed" &&
      (r.generateMs ?? 0) > 0 &&
      (r.totalTokens ?? 0) > 0 &&
      !r.secours,
  );
  if (!allOk) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
