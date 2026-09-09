import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";

import {
  analyzeDocument,
  csrfHeaders,
  evalHeaders,
  uploadPdf,
} from "../helpers/api";
import { openAppHome } from "../helpers/auth";
import {
  clearAllHistory,
  deleteHistoryByDocumentId,
  documentRelationsCount,
  historyCount,
  historyDocumentIds,
  historyHasDocumentId,
  historyItems,
  latestHistoryForDocument,
  memoryCorpusCount,
  waitForMemoryCorpus,
} from "../helpers/dashboard-data";
import {
  assertNoNaNOrUndefined,
  attachPageProbe,
  clearRouteMocks,
  gotoDashboard,
  mockApiOnce,
} from "../helpers/dashboard";
import { requireGptOss120bReady } from "../helpers/ollama-preflight";

const FIX = path.join(__dirname, "..", "fixtures");

async function patchHistoryFavorite(
  page: import("@playwright/test").Page,
  documentId: string,
  favorite: boolean,
): Promise<void> {
  const list = await page.request.get("/api/history", {
    headers: evalHeaders(),
  });
  expect(list.ok()).toBeTruthy();
  const json = (await list.json()) as {
    data?: { items?: Array<{ id: string; documentId: string }> };
  };
  const item = json.data?.items?.find((i) => i.documentId === documentId);
  expect(item, `history pour ${documentId}`).toBeTruthy();
  const patch = await page.request.patch(`/api/history/${item!.id}`, {
    headers: {
      "Content-Type": "application/json",
      ...(await csrfHeaders(page)),
      ...evalHeaders(),
    },
    data: { favorite },
  });
  expect(patch.ok(), await patch.text()).toBeTruthy();
}

function fixture(name: string): string {
  const p = path.join(FIX, name);
  if (!fs.existsSync(p)) {
    throw new Error(`Fixture manquante: ${name} â€” npm run e2e:prepare`);
  }
  return p;
}

function orangeMonthlyEur(
  subs: Awaited<ReturnType<typeof subscriptionInsights>>,
): number[] {
  return subs
    .filter((s) => /orange/i.test(s.name || ""))
    .map((s) => s.monthlyEur ?? 0);
}

test.describe("Dashboard E2E â€” vide / UI / API / refresh", () => {
  test("dashboard initial â€” compteurs + console propre", async ({ page }) => {
    await openAppHome(page);
    const probe = attachPageProbe(page, { ignoreStatus: [401] });
    await gotoDashboard(page);
    await expect(
      page.getByRole("heading", { name: /Tableau de bord/i }),
    ).toBeVisible();
    await assertNoNaNOrUndefined(page);
    await expect(page.getByText(/analyse/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await assertNoNaNOrUndefined(page);
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\bcus_[A-Za-z0-9]+/);
    expect(body).not.toMatch(/\bsub_[A-Za-z0-9]+/);
    probe.dispose();
    expect(probe.pageErrors, probe.pageErrors.join("\n")).toEqual([]);
    const critical = probe.consoleErrors.filter(
      (e) => !/favicon|Download the React DevTools/i.test(e),
    );
    expect(critical, critical.join("\n")).toEqual([]);
  });

  test("billing API â€” aucun ID Stripe brut", async ({ page }) => {
    await openAppHome(page);
    const res = await page.request.get("/api/billing", {
      headers: evalHeaders(),
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const json = (await res.json()) as {
      success: boolean;
      data?: {
        subscription?: {
          stripeCustomerId?: string | null;
          stripeSubscriptionId?: string | null;
        };
      };
    };
    expect(json.success).toBe(true);
    expect(json.data?.subscription?.stripeCustomerId ?? null).toBeNull();
    expect(json.data?.subscription?.stripeSubscriptionId ?? null).toBeNull();
  });

  test("erreur API insights â€” panneau erreur, pas silence", async ({
    page,
  }) => {
    await openAppHome(page);
    await mockApiOnce(page, "/api/insights", {
      status: 500,
      body: {
        success: false,
        error: { message: "Mock insights 500", code: "MOCK" },
      },
    });
    await gotoDashboard(page);
    await expect(
      page
        .getByText(/Mock insights 500|Erreur de chargement|indisponibles/i)
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    await clearRouteMocks(page);
  });

  test("erreur API alerts â€” historique toujours affichÃ© si OK", async ({
    page,
  }) => {
    await openAppHome(page);
    await mockApiOnce(page, "/api/alerts", {
      status: 500,
      body: {
        success: false,
        error: { message: "Mock alerts 500", code: "MOCK" },
      },
    });
    await gotoDashboard(page);
    await expect(
      page
        .getByText(/DonnÃ©es partielles|Mock alerts 500|Erreur de chargement/i)
        .first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page
        .getByRole("heading", { name: /Statistiques|Tableau de bord/i })
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    await clearRouteMocks(page);
  });

  test("erreurs API 401/403/404/JSON invalide â€” pas de faux zÃ©ro", async ({
    page,
  }) => {
    await openAppHome(page);
    await mockApiOnce(page, "/api/history", {
      status: 401,
      body: {
        success: false,
        error: { message: "Mock history 401", code: "UNAUTHORIZED" },
      },
    });
    await gotoDashboard(page);
    await expect(
      page
        .getByText(
          /Mock history 401|non autoris|Erreur|DonnÃ©es partielles|indisponible/i,
        )
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    await clearRouteMocks(page);

    await mockApiOnce(page, "/api/insights", {
      status: 403,
      body: {
        success: false,
        error: { message: "Mock insights 403", code: "FORBIDDEN" },
      },
    });
    await gotoDashboard(page);
    await expect(
      page
        .getByText(/Mock insights 403|Erreur|DonnÃ©es partielles|indisponible/i)
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    await clearRouteMocks(page);

    await mockApiOnce(page, "/api/alerts", {
      status: 404,
      body: {
        success: false,
        error: { message: "Mock alerts 404", code: "NOT_FOUND" },
      },
    });
    await gotoDashboard(page);
    await expect(
      page
        .getByText(/Mock alerts 404|Erreur|DonnÃ©es partielles|indisponible/i)
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    await clearRouteMocks(page);

    await page.route("**/api/insights**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "not-json{{{",
      });
    });
    await gotoDashboard(page);
    await expect(
      page
        .getByText(/Erreur|DonnÃ©es partielles|indisponible|JSON|chargement/i)
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    await clearRouteMocks(page);
  });

  test("navigation Dashboard â†” pages liÃ©es + F5", async ({ page }) => {
    await openAppHome(page);
    await gotoDashboard(page);
    await page.goto("/abonnements");
    await page.goto("/finances");
    await page.goto("/economies");
    await page.goto("/contreparties");
    await page.goto("/historique");
    await gotoDashboard(page);
    await expect(page.getByText(/analyse/i).first()).toBeVisible();
    await assertNoNaNOrUndefined(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Tableau de bord/i }),
    ).toBeVisible();
  });

  test("nouvel onglet â€” mÃªme Ã©tat", async ({ context, page }) => {
    await openAppHome(page);
    await gotoDashboard(page);
    const textA = await page.locator("body").innerText();
    const page2 = await context.newPage();
    await openAppHome(page2);
    await gotoDashboard(page2);
    expect(await page2.locator("body").innerText()).toMatch(/Tableau de bord/i);
    expect(textA).toMatch(/Tableau de bord/i);
    await page2.close();
  });

  test("navigation retour arrière / avant + visibilité", async ({ page }) => {
    await openAppHome(page);
    await gotoDashboard(page);
    await page.goto("/historique");
    await expect(page).toHaveURL(/\/historique/);
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goForward();
    await expect(page).toHaveURL(/\/historique/);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await gotoDashboard(page);
    await expect(
      page.getByRole("heading", { name: /Tableau de bord/i }),
    ).toBeVisible();
  });

  test("responsive 390 / 768 / 1280", async ({ page }) => {
    await openAppHome(page);
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await gotoDashboard(page);
      await expect(
        page.getByRole("heading", { name: /Tableau de bord/i }),
      ).toBeVisible();
      await assertNoNaNOrUndefined(page);
    }
  });
});

test.describe("Dashboard E2E â€” prÃ©flight LLM (local Ollama / staging cloud)", () => {
  test("prÃ©flight modÃ¨le gpt-oss + health app", async ({ page }) => {
    await openAppHome(page);
    await requireGptOss120bReady(page);
  });
});

test.describe("Dashboard E2E â€” upload A/B/C + delete", () => {
  test("upload A/B/C + dashboard puis delete A + refresh", async ({
    page,
  }) => {
    await openAppHome(page);
    await requireGptOss120bReady(page);
    await clearAllHistory(page);
    expect(await historyCount(page)).toBe(0);

    const probe = attachPageProbe(page);
    const docs = [
      fixture("orange-internet.pdf"),
      fixture("orange-mobile.pdf"),
      fixture("edf-contrat.pdf"),
    ];
    const uploaded: Array<{ documentId: string; fileName: string }> = [];

    for (const pdf of docs) {
      const up = await uploadPdf(page, pdf);
      const analyzed = await analyzeDocument(page, {
        documentId: up.documentId,
        text: up.text,
        fileName: up.fileName,
        mode: "full",
      });
      expect(
        analyzed.historyId,
        `historyId manquant aprÃ¨s analyse de ${up.fileName}`,
      ).toBeTruthy();
      uploaded.push({ documentId: up.documentId, fileName: up.fileName });
    }

    await expect
      .poll(async () => historyCount(page), {
        timeout: 120_000,
        message: "historique doit contenir exactement 3 analyses",
      })
      .toBe(3);

    await waitForMemoryCorpus(page, 3);

    const docA = uploaded[0]!.documentId;
    const docB = uploaded[1]!.documentId;
    const docC = uploaded[2]!.documentId;

    await gotoDashboard(page);
    await page.getByRole("button", { name: /Actualiser/i }).click();
    await expect(
      page.getByRole("heading", { name: /Statistiques|Mémoire documentaire|Tableau de bord/i }).first(),
    ).toBeVisible({ timeout: 120_000 });
    await expect
      .poll(async () => historyCount(page), {
        timeout: 60_000,
        message: "dashboard aligné sur historique après upload",
      })
      .toBe(3);

    await deleteHistoryByDocumentId(page, docA);
    await expect.poll(async () => historyCount(page)).toBe(2);
    await expect.poll(async () => historyHasDocumentId(page, docA)).toBe(false);
    await expect.poll(async () => historyHasDocumentId(page, docB)).toBe(true);
    await expect.poll(async () => historyHasDocumentId(page, docC)).toBe(true);
    await expect
      .poll(async () => documentRelationsCount(page, docA), { timeout: 60_000 })
      .toBe(0);

    await gotoDashboard(page);
    await page.getByRole("button", { name: /Actualiser/i }).click();
    await expect.poll(async () => historyCount(page)).toBe(2);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(async () => historyCount(page)).toBe(2);
    await expect.poll(async () => historyHasDocumentId(page, docA)).toBe(false);
    await expect.poll(async () => historyHasDocumentId(page, docB)).toBe(true);
    await expect.poll(async () => historyHasDocumentId(page, docC)).toBe(true);

    await deleteHistoryByDocumentId(page, docB);
    await deleteHistoryByDocumentId(page, docC);
    await expect.poll(async () => historyCount(page)).toBe(0);

    await gotoDashboard(page);
    await page.getByRole("button", { name: /Actualiser/i }).click();
    await expect.poll(async () => historyCount(page)).toBe(0);

    probe.dispose();
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe("Dashboard E2E — réindexation", () => {
  test("réindex V1→V2→V3 même documentId sans doublon mémoire", async ({
    page,
  }) => {
    await openAppHome(page);
    await requireGptOss120bReady(page);
    await clearAllHistory(page);

    const up = await uploadPdf(page, fixture("orange-internet.pdf"));
    const v1 = up.text;
    const v2 = `${v1}\n\nAvenant V2 : Abonnement mensuel : 35,00 EUR par mois.`;
    const v3 = `${v2}\n\nAvenant V3 : Abonnement mensuel : 42,00 EUR par mois.`;

    await analyzeDocument(page, {
      documentId: up.documentId,
      text: v1,
      fileName: up.fileName,
      mode: "full",
    });
    await waitForMemoryCorpus(page, 1);
    const relCount = await documentRelationsCount(page, up.documentId);
    expect(relCount).toBeGreaterThanOrEqual(0);

    await analyzeDocument(page, {
      documentId: up.documentId,
      text: v2,
      fileName: "orange-internet-v2.pdf",
      mode: "full",
    });
    await analyzeDocument(page, {
      documentId: up.documentId,
      text: v3,
      fileName: "orange-internet-v3.pdf",
      mode: "full",
    });

    await expect
      .poll(async () => historyCount(page), { timeout: 120_000 })
      .toBe(3);

    expect(new Set(await historyDocumentIds(page)).size).toBe(1);
    await waitForMemoryCorpus(page, 1);

    const latest = await latestHistoryForDocument(page, up.documentId);
    expect(latest?.fileName || "").toMatch(/v3/i);

    const relCountFinal = await documentRelationsCount(page, up.documentId);
    expect(relCountFinal).toBeGreaterThanOrEqual(0);

    await deleteHistoryByDocumentId(page, up.documentId);
    await expect.poll(async () => historyHasDocumentId(page, up.documentId)).toBe(
      false,
    );
  });
});


test.describe("Dashboard E2E â€” patch / favori", () => {
  test("patch favori via Documents marque stale", async ({ page }) => {
    await openAppHome(page);
    await requireGptOss120bReady(page);
    await clearAllHistory(page);

    const up = await uploadPdf(page, fixture("sample.pdf"));
    await analyzeDocument(page, {
      documentId: up.documentId,
      text: up.text,
      fileName: up.fileName,
      mode: "full",
    });

    await expect
      .poll(async () => historyCount(page), { timeout: 120_000 })
      .toBeGreaterThanOrEqual(1);

    await page.goto("/documents");
    await expect(page.getByText(/Documents|Tous/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Tous", exact: true }).click();
    await expect(page.getByText(/Tous les documents[1-9]/)).toBeVisible({
      timeout: 60_000,
    });
    const fav = page.locator('button[title="Favori"]').first();
    await expect(fav).toBeVisible({ timeout: 30_000 });
    await fav.click();

    await expect
      .poll(async () => {
        const items = await historyItems(page);
        return (
          items.find((i) => i.documentId === up.documentId)?.favorite === true
        );
      }, { timeout: 30_000 })
      .toBe(true);

    await expect
      .poll(
        async () =>
          page.evaluate(() =>
            sessionStorage.getItem("docmind:dashboard:stale"),
          ),
        { timeout: 10_000 },
      )
      .toMatch(/patch/);

    await expect
      .poll(async () => {
        const list = await page.request.get("/api/history", {
          headers: evalHeaders(),
        });
        const json = (await list.json()) as {
          data?: { items?: Array<{ documentId?: string; favorite?: boolean }> };
        };
        return (
          json.data?.items?.find((i) => i.documentId === up.documentId)
            ?.favorite === true
        );
      })
      .toBe(true);

    await gotoDashboard(page);
    await page.getByRole("button", { name: /Actualiser/i }).click();
    await expect(
      page.getByRole("heading", { name: /Tableau de bord/i }),
    ).toBeVisible();

    await expect
      .poll(async () => {
        const list = await page.request.get("/api/history", {
          headers: evalHeaders(),
        });
        const json = (await list.json()) as {
          data?: { items?: Array<{ documentId?: string; favorite?: boolean }> };
        };
        return (
          json.data?.items?.find((i) => i.documentId === up.documentId)
            ?.favorite === true
        );
      })
      .toBe(true);

    await deleteHistoryByDocumentId(page, up.documentId);
  });
});

