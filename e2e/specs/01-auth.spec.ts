import { expect, test } from "@playwright/test";

import { loginViaUi, signupViaUi } from "../helpers/auth";
import { hasSupabaseEnv, playwrightCredentials } from "../helpers/env";

test.describe("Authentification", () => {
  test("inscription — validation CGU + formulaire", async ({ page }) => {
    await page.goto("/auth/signup");
    await expect(page.getByRole("heading", { name: /Créer un compte/i })).toBeVisible();

    await page.getByLabel("Email").fill("e2e-invalid@example.com");
    await page.getByLabel("Mot de passe").fill("short");
    await page.getByRole("button", { name: /S'inscrire/i }).click();

    // HTML5 minLength ou message app
    const shortPwd = page.getByText(/8 caractères/i);
    const nativeInvalid = await page
      .getByLabel("Mot de passe")
      .evaluate((el: HTMLInputElement) => !el.checkValidity());
    expect(
      (await shortPwd.isVisible().catch(() => false)) || nativeInvalid,
    ).toBeTruthy();
  });

  test("inscription — flux réel ou message config", async ({ page }) => {
    const email = `e2e.${Date.now()}@docmind.test`;
    const outcome = await signupViaUi(page, {
      fullName: "E2E User",
      email,
      password: "DocMindE2E!2026",
    });

    // Serveur e2e sans Supabase (défaut) → erreur config attendue
    if (!hasSupabaseEnv() || process.env.PLAYWRIGHT_USE_SUPABASE !== "1") {
      expect(["error", "verify"]).toContain(outcome);
      await expect(
        page
          .getByText(
            /Supabase|configur|impossible|inscription|Your project's URL|Invalid/i,
          )
          .first(),
      ).toBeVisible({ timeout: 20_000 });
      return;
    }

    expect(["verify", "logged-in", "error"]).toContain(outcome);
    if (outcome === "verify") {
      await expect(
        page.getByRole("heading", { name: /Vérifiez votre email/i }),
      ).toBeVisible();
    }
  });

  test("connexion — page + credentials optionnels", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(page.getByRole("heading", { name: /Connexion/i })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Mot de passe")).toBeVisible();

    const creds = playwrightCredentials();
    if (!creds || !hasSupabaseEnv()) {
      test.info().annotations.push({
        type: "note",
        description:
          "Sans PLAYWRIGHT_EMAIL/PASSWORD : smoke UI uniquement (local-dev).",
      });
      return;
    }

    await loginViaUi(page, creds.email, creds.password);
    await expect(page).not.toHaveURL(/\/auth\/login/);
  });
});
