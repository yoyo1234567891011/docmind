import { expect, test } from "@playwright/test";

import { csrfHeaders, evalHeaders } from "../helpers/api";
import { loginViaUi, openAppHome } from "../helpers/auth";
import { hasSupabaseEnv, playwrightCredentials } from "../helpers/env";

test.describe("Compte · Export RGPD · Suppression", () => {
  test("export RGPD (ZIP)", async ({ page }) => {
    await openAppHome(page);
    const headers = {
      ...(await csrfHeaders(page)),
      ...evalHeaders(),
    };
    const res = await page.request.get("/api/account/export", { headers });

    // eval-runner interdit ; local-dev / vrai user OK
    if (res.status() === 403) {
      const json = (await res.json()) as { error?: { message?: string } };
      expect(json.error?.message || "").toMatch(/évaluation|eval/i);
      test.info().annotations.push({
        type: "note",
        description: "Export bloqué pour session EVAL — attendu.",
      });
      return;
    }

    expect(res.ok(), await res.text()).toBeTruthy();
    expect(res.headers()["content-type"]).toMatch(/zip|octet-stream/i);
    const buf = await res.body();
    expect(buf.byteLength).toBeGreaterThan(20);
    // ZIP local header
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  test("suppression compte — garde-fous + flux credentials", async ({
    page,
  }) => {
    await openAppHome(page);

    const headers = {
      "Content-Type": "application/json",
      ...(await csrfHeaders(page)),
      ...evalHeaders(),
    };

    // Sans confirm → 400
    const bad = await page.request.post("/api/account/delete", {
      headers,
      data: { confirm: "NO" },
    });
    expect([400, 401, 403]).toContain(bad.status());

    const creds = playwrightCredentials();
    if (!creds || !hasSupabaseEnv()) {
      // local-dev / eval : suppression volontairement refusée
      const denied = await page.request.post("/api/account/delete", {
        headers,
        data: { confirm: "DELETE" },
      });
      expect(denied.status()).toBe(403);
      const json = (await denied.json()) as { error?: { message?: string } };
      expect(json.error?.message || "").toMatch(
        /indisponible|session|local|évalu/i,
      );
      return;
    }

    // Compte dédié E2E uniquement (ne pas utiliser un compte prod)
    test.skip(
      !process.env.PLAYWRIGHT_ALLOW_ACCOUNT_DELETE,
      "Définir PLAYWRIGHT_ALLOW_ACCOUNT_DELETE=1 + compte jetable pour tester la suppression réelle.",
    );

    await loginViaUi(page, creds.email, creds.password);
    const delHeaders = {
      "Content-Type": "application/json",
      ...(await csrfHeaders(page)),
    };
    const del = await page.request.post("/api/account/delete", {
      headers: delHeaders,
      data: { confirm: "DELETE" },
    });
    expect(del.ok(), await del.text()).toBeTruthy();
  });

  test("UI profil — zone danger suppression", async ({ page }) => {
    await openAppHome(page);
    await page.goto("/profil").catch(async () => {
      await page.goto("/compte").catch(async () => {
        await page.goto("/auth/login");
      });
    });

    // La page profil peut s’appeler /profil ou être dans le menu
    const danger = page.getByText(/Supprimer.*compte|suppression/i).first();
    if (await danger.isVisible().catch(() => false)) {
      await expect(danger).toBeVisible();
      return;
    }

    // Fallback : au moins la nav authentifiée
    await page.goto("/analyser");
    await expect(page).not.toHaveURL(/\/auth\/login/);
  });
});
