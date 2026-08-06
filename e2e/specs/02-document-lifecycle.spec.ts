import { expect, test } from "@playwright/test";
import path from "path";

import {
  analyzeDocument,
  ensureSamplePdf,
  evalHeaders,
  healthOllamaOk,
  uploadPdf,
} from "../helpers/api";
import { openAppHome } from "../helpers/auth";
import { requireOllama } from "../helpers/env";

test.describe("Upload · Export PDF · UI", () => {
  test("upload PDF puis export fichier", async ({ page }) => {
    await openAppHome(page);
    await ensureSamplePdf();
    const uploaded = await uploadPdf(page);
    expect(uploaded.documentId).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(uploaded.text.length).toBeGreaterThan(20);

    // Même session/user que l’upload (contextes Playwright isolés par test).
    const res = await page.request.get(
      `/api/documents/${encodeURIComponent(uploaded.documentId)}/file`,
      { headers: evalHeaders() },
    );
    expect(res.ok(), await res.text()).toBeTruthy();
    expect(res.headers()["content-type"]).toMatch(/pdf/i);
    const buf = await res.body();
    expect(buf.byteLength).toBeGreaterThan(100);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });

  test("UI analyseur accepte un PDF", async ({ page }) => {
    await openAppHome(page);
    await page.goto("/analyser");
    const pdf = await ensureSamplePdf();
    const input = page.locator('input[type="file"]');
    await expect(input).toBeAttached({ timeout: 15_000 });
    await input.setInputFiles(pdf);
    await expect(page.getByText(path.basename(pdf), { exact: false })).toBeVisible({
      timeout: 60_000,
    });
  });
});

test.describe.serial("Analyse · Cache hit", () => {
  test.beforeEach(async ({ page }) => {
    await openAppHome(page);
    const ollama = await healthOllamaOk(page);
    if (!ollama) {
      if (requireOllama()) {
        throw new Error("Ollama down — E2E_REQUIRE_OLLAMA=1");
      }
      test.skip(true, "Ollama indisponible — démarrer ollama serve");
    }
  });

  test("analyse document + cache hit", async ({ page }) => {
    await openAppHome(page);
    const uploaded = await uploadPdf(page);
    const first = await analyzeDocument(page, {
      documentId: uploaded.documentId,
      text: uploaded.text,
      fileName: uploaded.fileName,
      mode: "full",
    });
    expect(
      first.analysis?.document_type || first.classification?.category,
    ).toBeTruthy();

    const second = await analyzeDocument(page, {
      documentId: `cache-${uploaded.documentId}`.slice(0, 64),
      text: uploaded.text,
      fileName: uploaded.fileName,
      mode: "full",
    });
    expect(second.resultSource).toBe("cache");
    if (first.durationMs && first.durationMs > 2_000 && second.durationMs != null) {
      expect(second.durationMs).toBeLessThan(first.durationMs);
    }
  });
});
