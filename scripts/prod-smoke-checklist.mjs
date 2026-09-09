/**
 * Smoke post-deploy checklist qualité (correctifs #1–#5).
 * node scripts/prod-smoke-checklist.mjs
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

const DOCS = [
  {
    id: "bail",
    file: "smoke-bail.pdf",
    lines: [
      "BAIL D'HABITATION",
      "Entre le bailleur et le locataire.",
      "Durée du bail : 3 ans à compter de la prise d'effet.",
      "Loyer mensuel hors charges : 1 050 €.",
      "Provisions pour charges : 80 € par mois.",
      "Dépôt de garantie : 2 100 €.",
      "Le présent bail est reconduit par tacite reconduction.",
      "Préavis du locataire : 3 mois.",
      "Clause résolutoire en cas de défaut de paiement du loyer.",
      "Honoraires de mise en location : 450 €.",
      "Révision du loyer selon l'IRL.",
      "Capital social de l'agence : 50 000 €.",
      "Garantie financière d'agence : 120 000 €.",
    ],
    checks: [
      {
        name: "loyer/depot en tête",
        fn: (a) => {
          const titles = watchTitles(a);
          return (
            titles.some((t) => /loyer/i.test(t)) &&
            titles.some((t) => /d[ée]p[ôo]t/i.test(t))
          );
        },
      },
      {
        name: "pas capital social / garantie agence",
        fn: (a) =>
          !allText(a).match(
            /50\s*000|120\s*000|capital\s+social|garantie\s+financi/i,
          ),
      },
      {
        name: "résumé complet (pas coupe)",
        fn: (a) => summaryOk(a.summary),
      },
    ],
  },
  {
    id: "med",
    file: "smoke-med.pdf",
    lines: [
      "MISE EN DEMEURE",
      "Nous vous mettons en demeure de payer la somme totale de 274 € sous 8 jours.",
      "Pénalité de retard de 40 € et frais de recouvrement de 23 €.",
      "À défaut, huissier de justice.",
      "Délai de 10 jours pour contester.",
    ],
    checks: [
      {
        name: "total/frais/pénalités",
        fn: (a) =>
          /274|40|23|recouvrement|p[ée]nalit|total/i.test(allText(a)),
      },
      {
        name: "délai ou huissier",
        fn: (a) => /huissier|8\s*jours|contest/i.test(allText(a)),
      },
    ],
  },
  {
    id: "taxe",
    file: "smoke-taxe.pdf",
    lines: [
      "DIRECTION GÉNÉRALE DES FINANCES PUBLIQUES",
      "Avis de prélèvement — Taxe foncière 2024",
      "Montant à prélever : 1 178,00 €",
      "Date de prélèvement : 27/10/2025",
      "Opposition possible avant le 01/10/2025.",
      "Majoration de 10 % en cas de retard.",
      "Information : suite à la suppression de la taxe d'habitation,",
      "le produit national de la taxe s'élève à 234 079 050 €",
      "pour l'ensemble des foyers et des collectivités.",
    ],
    checks: [
      {
        name: "montant dû / taxe / prélever",
        fn: (a) => /1\s*178|taxe\s+fonci|pr[ée]l[eè]v/i.test(allText(a)),
      },
      {
        name: "pas total national 234M",
        fn: (a) => !/234\s*079\s*050|234079050/.test(allText(a)),
      },
      {
        name: "date prélèvement ou opposition",
        fn: (a) =>
          /27\/10\/2025|01\/10\/2025|pr[ée]l[eè]vement|opposition/i.test(
            allText(a),
          ),
      },
    ],
  },
  {
    id: "banque",
    file: "smoke-banque.pdf",
    lines: [
      "RELEVÉ DE COMPTE BANCAIRE",
      "Période du 01/03/2025 au 31/03/2025",
      "Frais de tenue de compte : 2,00 €",
      "Commission d'intervention : 8,00 € (2 opérations)",
      "Intérêts débiteurs : 3,45 €",
      "Frais de rejet de prélèvement : 15,00 €",
      "Découvert autorisé : 500 €",
    ],
    checks: [
      {
        name: "frais/commission/intérêts",
        fn: (a) =>
          /tenue|commission|intervention|int[ée]r[êe]ts|rejet|8\s*[,.]?\s*00|15/i.test(
            allText(a),
          ),
      },
      {
        name: "pas résiliation abo hors sujet",
        fn: (a) => {
          const titles = watchTitles(a).join(" | ");
          return !/r[ée]silier\s*\/\s*modifier|date\s+limite\s+pour\s+r[ée]silier/i.test(
            titles,
          );
        },
      },
      {
        name: "résumé/actions sans coupe mid-mot",
        fn: (a) => summaryOk(a.summary) && actionsOk(a.actions),
      },
    ],
  },
  {
    id: "pret",
    file: "smoke-pret.pdf",
    lines: [
      "OFFRE DE PRÊT IMMOBILIER",
      "Capital emprunté : 220 000 €",
      "TAEG : 3,45 %",
      "Mensualité : 1 120 €",
      "Durée : 20 ans",
      "Frais de dossier : 500 €",
      "Assurance emprunteur obligatoire.",
      "Pénalité de remboursement anticipé : 1 % du capital restant dû",
      "s'il reste plus d'un an, 0,5 % s'il reste moins d'un an.",
      "Délai de rétractation : 14 jours.",
    ],
    checks: [
      {
        name: "capital/TAEG/mensualité ou pénalité",
        fn: (a) =>
          /220\s*000|TAEG|1\s*120|remboursement\s+anticip|r[ée]tractation|500/i.test(
            allText(a),
          ),
      },
      {
        name: "pas tacite inventée",
        fn: (a) =>
          !/tacite\s+reconduction|renouvellement\s+automatique/i.test(
            allText(a),
          ),
      },
      {
        name: "actions sans « si le délai entre »",
        fn: (a) =>
          !(a.actions || []).some((x) =>
            /si le d[ée]lai entre/i.test(String(x)),
          ),
      },
    ],
  },
  {
    id: "abonnement",
    file: "smoke-abo.pdf",
    lines: [
      "CONTRAT ABONNEMENT FIBRE",
      "Engagement de 24 mois à compter de la date d'activation.",
      "En cas de résiliation anticipée, des frais de 149 € seront dus.",
      "Le présent contrat est reconduit par tacite reconduction.",
      "Frais de service mensuels : 3,99 € / mois hors forfait.",
      "Pénalité de non-retour du matériel (box) : 120 €.",
      "Préavis de résiliation : 30 jours avant l'échéance.",
    ],
    checks: [
      {
        name: "engagement / frais résiliation",
        fn: (a) =>
          /engagement|149|24\s*mois|r[ée]siliation|tacite|3[,.]99|120/i.test(
            allText(a),
          ),
      },
      {
        name: "obligation de payer pas en tête",
        fn: (a) => {
          const top = watchTitles(a)[0] || "";
          return !/^Obligation de payer/i.test(top);
        },
      },
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
    analysis.title,
    ...(analysis.important_points || []),
    ...(analysis.risks || []),
    ...(analysis.actions || []),
    ...(analysis.amounts || []),
    ...((analysis.risk_findings || []).map((f) =>
      [f.description, f.excerpt, f.why].filter(Boolean).join(" "),
    )),
  ]
    .filter(Boolean)
    .join("\n");
}

function summaryOk(summary) {
  const s = String(summary || "").trim();
  if (!s) return false;
  if (/Le relev$/i.test(s)) return false;
  if (/\b(le|la|les|de|du|en|si|entre)\s*$/i.test(s)) return false;
  // Mot tronqué type « relev » en fin
  const last = s.split(/\s+/).pop() || "";
  if (/^(relev|p[ée]nalit|commiss)$/i.test(last)) return false;
  return s.length >= 28;
}

function actionsOk(actions) {
  const list = actions || [];
  if (!list.length) return true;
  return list.every((a) => {
    const t = String(a);
    return (
      !/si le d[ée]lai entre/i.test(t) &&
      !/\b(le|la|de|du|en|si|entre)\s*$/i.test(t.trim())
    );
  });
}

async function analyzeOne(page, csrfHeader, csrfToken, doc) {
  const pdfPath = path.join(OUT_DIR, doc.file);
  const result = {
    id: doc.id,
    ok: false,
    jobStatus: null,
    documentType: null,
    summary: null,
    watchTop: [],
    checkResults: [],
    error: null,
    timings: {},
  };

  const t0 = Date.now();
  try {
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
    if (!uploadRes.ok() || !uploadJson.success) {
      throw new Error(
        uploadJson?.error?.message || `upload ${uploadRes.status()}`,
      );
    }
    const documentId =
      uploadJson.data?.document?.id || uploadJson.data?.documentId;
    const text =
      uploadJson.data?.extraction?.text || uploadJson.data?.text || "";
    const fileName =
      uploadJson.data?.document?.fileName ||
      uploadJson.data?.fileName ||
      doc.file;
    const pages = uploadJson.data?.extraction?.pages;
    result.timings.uploadSec = +((Date.now() - t0) / 1000).toFixed(1);

    const p1 = Date.now();
    const analyzeRes = await page.request.post(`${BASE}/api/analyze`, {
      headers: {
        "Content-Type": "application/json",
        [header]: token,
      },
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
    result.timings.p1Sec = +((Date.now() - p1) / 1000).toFixed(1);
    if (!analyzeRes.ok() || !analyzeJson.success) {
      throw new Error(
        analyzeJson?.error?.message || `analyze ${analyzeRes.status()}`,
      );
    }

    const jobId = analyzeJson.data?.jobId;
    const historyId = analyzeJson.data?.historyId;
    let analysis = analyzeJson.data?.analysis || null;

    if (jobId) {
      const p2 = Date.now();
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        const jobRes = await page.request.get(
          `${BASE}/api/analysis-jobs/${encodeURIComponent(jobId)}`,
        );
        const jobJson = await jobRes.json();
        const st = jobJson?.data?.status;
        process.stdout.write(`  [${doc.id}] job=${st}\n`);
        if (st === "completed" || st === "failed") {
          result.jobStatus = st;
          if (st === "failed") {
            throw new Error(
              jobJson?.data?.lastError || jobJson?.data?.error || "job failed",
            );
          }
          break;
        }
        await sleep(4000);
      }
      result.timings.p2Sec = +((Date.now() - p2) / 1000).toFixed(1);
      if (result.jobStatus !== "completed") {
        throw new Error("timeout P2 (240s)");
      }
    } else {
      result.jobStatus = "no-job";
    }

    if (historyId) {
      const h = await page.request.get(
        `${BASE}/api/history/${encodeURIComponent(historyId)}`,
      );
      const hj = await h.json();
      analysis = hj?.data?.analysis || analysis;
    }

    if (!analysis) throw new Error("analysis manquante");

    result.documentType = analysis.document_type || null;
    result.summary = String(analysis.summary || "").slice(0, 200);
    result.watchTop = watchTitles(analysis).slice(0, 5);
    result.checkResults = doc.checks.map((c) => ({
      name: c.name,
      pass: Boolean(c.fn(analysis)),
    }));
    result.ok = result.checkResults.every((c) => c.pass);
    result.timings.totalSec = +((Date.now() - t0) / 1000).toFixed(1);
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    result.timings.totalSec = +((Date.now() - t0) / 1000).toFixed(1);
  }
  return result;
}

async function main() {
  loadEnv();
  mkdirSync(OUT_DIR, { recursive: true });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !service) throw new Error("Supabase env manquant");

  const health = await fetch(`${BASE}/api/health?details=1`, {
    cache: "no-store",
  });
  const healthJson = await health.json().catch(() => ({}));
  console.log("[health]", health.status, JSON.stringify(healthJson));

  for (const doc of DOCS) {
    await writePdf(path.join(OUT_DIR, doc.file), doc.lines);
  }
  console.log(`[pdf] ${DOCS.length} fixtures générées`);

  const email = `smoke+checklist+${Date.now()}@docmind.test`;
  const password = `Sm0ke!${randomBytes(9).toString("base64url")}`;
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user?.id) {
    throw new Error(created.error?.message || "createUser failed");
  }
  const userId = created.data.user.id;
  console.log("[auth] user créé", email);

  const browser = await chromium.launch({ headless: true });
  const report = { health: healthJson, results: [], ok: false };

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
    console.log("[auth] login OK");

    const csrfRes = await page.request.get(`${BASE}/api/csrf`);
    const csrfJson = await csrfRes.json();
    const csrfToken = csrfJson?.data?.token;
    const csrfHeader = csrfJson?.data?.headerName || "x-csrf-token";
    if (!csrfToken) throw new Error("CSRF manquant");

    for (const doc of DOCS) {
      console.log(`\n=== ${doc.id.toUpperCase()} ===`);
      const r = await analyzeOne(page, csrfHeader, csrfToken, doc);
      report.results.push(r);
      console.log(
        JSON.stringify(
          {
            id: r.id,
            ok: r.ok,
            jobStatus: r.jobStatus,
            documentType: r.documentType,
            summary: r.summary,
            watchTop: r.watchTop,
            checks: r.checkResults,
            error: r.error,
            timings: r.timings,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await browser.close().catch(() => undefined);
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    console.log("[auth] user supprimé");
  }

  report.ok =
    health.ok &&
    report.results.length === DOCS.length &&
    report.results.every((r) => r.ok);

  console.log("\n========== CHECKLIST SMOKE ==========");
  console.log(
    `Health: ${health.ok ? "PASS" : "FAIL"} | Global: ${report.ok ? "PASS" : "FAIL"}`,
  );
  for (const r of report.results) {
    const fails = (r.checkResults || [])
      .filter((c) => !c.pass)
      .map((c) => c.name);
    console.log(
      `${r.ok ? "PASS" : "FAIL"} ${r.id}${r.error ? ` — ${r.error}` : ""}${fails.length ? ` — KO: ${fails.join("; ")}` : ""}`,
    );
  }

  if (!report.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[fatal]", e instanceof Error ? e.message : e);
  process.exit(1);
});
