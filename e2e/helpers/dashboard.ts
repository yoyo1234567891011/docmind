import type { ConsoleMessage, Page, Request, Response } from "@playwright/test";

export type PageProbe = {
  consoleErrors: string[];
  pageErrors: string[];
  failedResponses: Array<{ url: string; status: number }>;
  dispose: () => void;
};

/**
 * Capture console.error / exceptions / HTTP ≥400 (hors 401 auth attendues optionnelles).
 */
export function attachPageProbe(
  page: Page,
  options?: { ignoreStatus?: number[] },
): PageProbe {
  const ignore = new Set(options?.ignoreStatus ?? []);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: Array<{ url: string; status: number }> = [];

  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  };
  const onPageError = (err: Error) => {
    pageErrors.push(err.message);
  };
  const onResponse = (res: Response) => {
    const status = res.status();
    if (status >= 400 && !ignore.has(status)) {
      const url = res.url();
      // Ignore noise assets
      if (/\.(png|jpg|svg|ico|woff2?)(\?|$)/i.test(url)) return;
      failedResponses.push({ url, status });
    }
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);

  return {
    consoleErrors,
    pageErrors,
    failedResponses,
    dispose: () => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("response", onResponse);
    },
  };
}

export async function gotoDashboard(page: Page): Promise<void> {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  // Si le guide n’a pas encore été marqué vu (course), le terminer puis recharger.
  if (page.url().includes("/guide")) {
    const { ensureGuideSeen } = await import("./auth");
    await ensureGuideSeen(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  }
  await page.getByRole("heading", { name: /Tableau de bord/i }).waitFor({
    state: "visible",
    timeout: 60_000,
  });
}

export function dashboardStatValue(page: Page, label: string) {
  return page
    .locator("section")
    .filter({ hasText: "Statistiques" })
    .locator("div, article, li")
    .filter({ hasText: new RegExp(label, "i") })
    .first();
}

export async function readVisibleText(page: Page): Promise<string> {
  return page.locator("body").innerText();
}

export async function assertNoNaNOrUndefined(page: Page): Promise<void> {
  const text = await readVisibleText(page);
  if (/\bNaN\b/.test(text)) {
    throw new Error("Texte Dashboard contient NaN");
  }
  if (/\bundefined\b/i.test(text)) {
    throw new Error("Texte Dashboard contient undefined");
  }
}

/** Bloque une route API et renvoie un statut/corps contrôlé. */
export async function mockApiOnce(
  page: Page,
  urlSubstring: string,
  result: {
    status: number;
    body?: unknown;
    contentType?: string;
  },
): Promise<void> {
  await page.route(`**${urlSubstring}**`, async (route: {
    fulfill: (r: {
      status: number;
      contentType?: string;
      body: string;
    }) => Promise<void>;
    request: () => Request;
  }) => {
    const body =
      typeof result.body === "string"
        ? result.body
        : JSON.stringify(
            result.body ?? {
              success: false,
              error: { message: `Mock ${result.status}`, code: "MOCK" },
            },
          );
    await route.fulfill({
      status: result.status,
      contentType: result.contentType ?? "application/json",
      body,
    });
  });
}

export async function clearRouteMocks(page: Page): Promise<void> {
  await page.unrouteAll({ behavior: "ignoreErrors" });
}
