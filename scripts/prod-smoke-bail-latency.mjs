import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const BASE = "https://docmind-blond.vercel.app";
const PDF = path.join(root, "e2e/fixtures/smoke-tmp/table-bail.pdf");

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  loadEnv();
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const email = `bail-after+${Date.now()}@docmind.test`;
  const password = `Sm0ke!${randomBytes(9).toString("base64url")}`;
  const {
    data: { user },
  } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const browser = await chromium.launch({ headless: true });
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
    const csrf = await (await page.request.get(`${BASE}/api/csrf`)).json();
    const h = csrf.data.headerName;
    const t = csrf.data.token;
    const up = await page.request.post(`${BASE}/api/upload`, {
      headers: { [h]: t },
      multipart: {
        file: {
          name: "table-bail.pdf",
          mimeType: "application/pdf",
          buffer: readFileSync(PDF),
        },
      },
      timeout: 120000,
    });
    const uj = await up.json();
    const t0 = Date.now();
    const ar = await page.request.post(`${BASE}/api/analyze`, {
      headers: { "Content-Type": "application/json", [h]: t },
      data: {
        documentId: uj.data?.document?.id,
        text: uj.data?.extraction?.text || "",
        fileName: "table-bail.pdf",
        pages: uj.data?.extraction?.pages,
        mode: "progressive",
        skipReadyReply: true,
      },
      timeout: 180000,
    });
    const aj = await ar.json();
    const jobId = aj.data?.jobId;
    const historyId = aj.data?.historyId;
    let last = null;
    while (Date.now() - t0 < 200000) {
      last = (
        await (
          await page.request.get(
            `${BASE}/api/analysis-jobs/${encodeURIComponent(jobId)}`,
          )
        ).json()
      )?.data;
      if (last?.status === "completed" || last?.status === "failed") break;
      await sleep(1000);
    }
    let memoryAfter = null;
    if (last?.status === "completed") {
      for (let i = 0; i < 40; i += 1) {
        const rec = (
          await (
            await page.request.get(
              `${BASE}/api/history/${encodeURIComponent(historyId)}`,
            )
          ).json()
        )?.data;
        if (
          rec?.memorySyncedAt ||
          rec?.relationsPhase === "ready" ||
          rec?.relationsPhase === "failed"
        ) {
          memoryAfter = {
            memorySyncedAt: rec.memorySyncedAt,
            relationsPhase: rec.relationsPhase,
          };
          break;
        }
        await sleep(500);
      }
    }
    const out = {
      jobId,
      status: last?.status,
      attempts: last?.attempts,
      lastError: last?.lastError,
      clientSec: +((Date.now() - t0) / 1000).toFixed(1),
      metrics: last?.metrics,
      memoryAfter,
    };
    console.log(JSON.stringify(out, null, 2));
    mkdirSync(path.join(root, "reports"), { recursive: true });
    writeFileSync(
      path.join(root, "reports", "latency-bail-after.json"),
      JSON.stringify(out, null, 2),
    );
  } finally {
    await browser.close();
    if (user?.id) await admin.auth.admin.deleteUser(user.id);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
