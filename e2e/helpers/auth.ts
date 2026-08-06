import { expect, type Page } from "@playwright/test";

import { hasSupabaseEnv, playwrightCredentials } from "./env";

/** Ouvre l’app (local-dev sans Supabase, ou session déjà authentifiée). */
export async function openAppHome(page: Page): Promise<void> {
  await page.goto("/analyser");
  // Sans Supabase : middleware laisse passer. Avec Supabase sans session → login.
  if (page.url().includes("/auth/login")) {
    const creds = playwrightCredentials();
    if (!creds) {
      throw new Error(
        "Supabase configuré mais PLAYWRIGHT_EMAIL / PLAYWRIGHT_PASSWORD absents.",
      );
    }
    await loginViaUi(page, creds.email, creds.password);
    await page.goto("/analyser");
  }
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

export async function loginViaUi(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/auth/login");
  await page.locator("label").filter({ hasText: /^Email$/ }).locator("input").fill(email);
  await page
    .locator("label")
    .filter({ hasText: /^Mot de passe$/ })
    .locator("input")
    .fill(password);
  await page.getByRole("button", { name: /Se connecter|Connexion/i }).click();
  await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 60_000 });
}

export async function signupViaUi(
  page: Page,
  input: { fullName: string; email: string; password: string },
): Promise<"verify" | "error" | "logged-in"> {
  await page.goto("/auth/signup");
  await page.locator("label").filter({ hasText: /^Nom$/ }).locator("input").fill(input.fullName);
  await page.locator("label").filter({ hasText: /^Email$/ }).locator("input").fill(input.email);
  await page
    .locator("label")
    .filter({ hasText: /^Mot de passe$/ })
    .locator("input")
    .fill(input.password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: /S'inscrire|Création/i }).click();

  const verify = page.getByRole("heading", { name: /Vérifiez votre email/i });
  const danger = page.locator("p.text-\\[var\\(--danger\\)\\], p[class*='danger']").first();

  await Promise.race([
    verify.waitFor({ state: "visible", timeout: 45_000 }).catch(() => null),
    page.waitForURL(/\/analyser|\/dashboard/, { timeout: 45_000 }).catch(() => null),
    danger.waitFor({ state: "visible", timeout: 45_000 }).catch(() => null),
  ]);

  if (await verify.isVisible().catch(() => false)) return "verify";
  if (!page.url().includes("/auth/signup")) return "logged-in";
  if (await danger.isVisible().catch(() => false)) return "error";
  if (!hasSupabaseEnv() || process.env.PLAYWRIGHT_USE_SUPABASE !== "1") {
    return "error";
  }
  return "verify";
}
