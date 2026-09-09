/**
 * Smoke test production (API via session navigateur) — timings P1/P2.
 * node scripts/prod-smoke-analyze.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import { randomBytes } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const BASE = "https://docmind-blond.vercel.app";
const PDF = path.join(root, "e2e", "fixtures", "sample.pdf");

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

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !service) throw new Error("Supabase env manquant");
  if (!existsSync(PDF)) throw new Error(`PDF manquant: ${PDF}`);

  const health = await fetch(`${BASE}/api/health`, { cache: "no-store" });
  const healthJson = await health.json();
  console.log("[health]", health.status, healthJson.ok ? "ok" : healthJson);

  const email = `smoke+${Date.now()}@docmind.test`;
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
  console.log("[auth] user créé");

  const t0 = Date.now();
  const report = {
    ok: false,
    analyzeKeys: null,
    jobId: null,
    historyId: null,
    jobFinal: null,
    documentType: null,
    summaryPreview: null,
    error: null,
    timings: {},
  };

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(90_000);

    const loginStart = Date.now();
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
    report.timings.loginSec = +((Date.now() - loginStart) / 1000).toFixed(1);
    console.log(`[auth] login ${report.timings.loginSec}s`);

    // CSRF via cookies session
    const csrfRes = await page.request.get(`${BASE}/api/csrf`);
    const csrfJson = await csrfRes.json();
    const csrfToken = csrfJson?.data?.token;
    const csrfHeader = csrfJson?.data?.headerName || "x-csrf-token";
    if (!csrfToken) throw new Error("CSRF token manquant");

    const analyzeStart = Date.now();
    const uploadRes = await page.request.post(`${BASE}/api/upload`, {
      headers: { [csrfHeader]: csrfToken },
      multipart: {
        file: {
          name: "sample.pdf",
          mimeType: "application/pdf",
          buffer: readFileSync(PDF),
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
      "sample.pdf";
    const pages = uploadJson.data?.extraction?.pages;
    report.timings.uploadSec = +(
      (Date.now() - analyzeStart) /
      1000
    ).toFixed(1);
    console.log(`[upload] ${report.timings.uploadSec}s id=${documentId}`);

    const p1Start = Date.now();
    const analyzeRes = await page.request.post(`${BASE}/api/analyze`, {
      headers: {
        "Content-Type": "application/json",
        [csrfHeader]: csrfToken,
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
    report.timings.p1Sec = +((Date.now() - p1Start) / 1000).toFixed(1);
    if (!analyzeRes.ok() || !analyzeJson.success) {
      report.error =
        analyzeJson?.error?.message || `analyze ${analyzeRes.status()}`;
      console.log("[analyze] FAIL", report.error);
    } else {
      const data = analyzeJson.data || {};
      report.analyzeKeys = Object.keys(data).sort();
      report.jobId = data.jobId || null;
      report.historyId = data.historyId || null;
      report.documentType =
        data.classification?.category ||
        data.analysis?.document_type ||
        null;
      report.summaryPreview = data.analysis?.summary
        ? String(data.analysis.summary).slice(0, 180)
        : null;
      console.log(
        `[p1] ${report.timings.p1Sec}s phase=${data.phase} jobId=${report.jobId ? "yes" : "NO"} historyId=${report.historyId ? "yes" : "NO"}`,
      );
      console.log(`[p1] keys: ${report.analyzeKeys.join(", ")}`);
    }

    if (report.jobId) {
      const p2Start = Date.now();
      let final = null;
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        const jobRes = await page.request.get(
          `${BASE}/api/analysis-jobs/${encodeURIComponent(report.jobId)}`,
        );
        const jobJson = await jobRes.json();
        const st = jobJson?.data?.status;
        console.log(`[job] ${jobRes.status()} status=${st}`);
        if (st === "completed" || st === "failed") {
          final = jobJson.data;
          break;
        }
        await sleep(3000);
      }
      report.timings.p2Sec = +((Date.now() - p2Start) / 1000).toFixed(1);
      report.jobFinal = final?.status || "timeout";
      report.metrics = final?.metrics ?? null;
      report.generateMs = final?.metrics?.generateMs ?? null;
      report.totalTokens = final?.metrics?.totalTokens ?? null;
      report.lastError = final?.lastError ?? null;

      const salvage =
        report.summaryPreview?.includes("Analyse de secours") ||
        report.summaryPreview?.includes("extraction locale");

      if (final?.status === "completed") {
        if (
          (report.generateMs ?? 0) <= 0 ||
          (report.totalTokens ?? 0) <= 0 ||
          salvage
        ) {
          report.ok = false;
          report.error =
            salvage
              ? "completed mais résumé salvage (faux succès)"
              : `completed sans LLM (generateMs=${report.generateMs} tokens=${report.totalTokens})`;
        } else {
          report.ok = true;
        }
        if (report.historyId) {
          const h = await page.request.get(
            `${BASE}/api/history/${encodeURIComponent(report.historyId)}`,
          );
          const hj = await h.json();
          const rec = hj?.data;
          if (rec?.analysis?.summary) {
            report.summaryPreview = String(rec.analysis.summary).slice(0, 180);
          }
          if (rec?.analysis?.document_type) {
            report.documentType = rec.analysis.document_type;
          }
        }
      } else if (final?.status === "failed") {
        report.error = final.lastError || final.error || "job failed";
        report.lastError = final.lastError || report.error;
      } else {
        report.error = "timeout P2 (240s)";
      }
    } else if (!report.error) {
      report.error =
        "Pas de jobId — historique/enqueue a probablement échoué (aperçu seul)";
    }

    report.timings.totalSec = +((Date.now() - analyzeStart) / 1000).toFixed(1);
    report.timings.wallSec = +((Date.now() - t0) / 1000).toFixed(1);

    console.log("\n=== RÉSULTAT SMOKE PROD ===");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close().catch(() => undefined);
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    console.log("[auth] user supprimé");
  }

  if (!report.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[fatal]", e instanceof Error ? e.message : e);
  process.exit(1);
});
