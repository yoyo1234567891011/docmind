import { expect, test } from "@playwright/test";

import {
  analyzeDocument,
  csrfHeaders,
  ensureSamplePdf,
  evalHeaders,
  healthOllamaOk,
  uploadPdf,
} from "../helpers/api";
import { openAppHome } from "../helpers/auth";
import { requireOllama } from "../helpers/env";

test.describe("File d’analyse (jobs)", () => {
  test("progressive → jobId → polling statut (timeout client ≠ delete)", async ({
    page,
  }) => {
    await openAppHome(page);
    const ollama = await healthOllamaOk(page);
    if (!ollama) {
      if (requireOllama()) {
        throw new Error("Ollama down — E2E_REQUIRE_OLLAMA=1");
      }
      test.skip(true, "Ollama indisponible — démarrer ollama serve");
    }

    await ensureSamplePdf();
    const uploaded = await uploadPdf(page);
    const progressive = await analyzeDocument(page, {
      documentId: uploaded.documentId,
      text: uploaded.text,
      fileName: uploaded.fileName,
      mode: "progressive",
    });

    expect(progressive.historyId).toBeTruthy();
    expect(progressive.jobId, "jobId doit être renvoyé en progressive").toBeTruthy();

    const jobId = progressive.jobId!;
    const headers = { ...evalHeaders() };
    const first = await page.request.get(
      `/api/analysis-jobs/${encodeURIComponent(jobId)}`,
      { headers },
    );
    expect(first.ok(), await first.text()).toBeTruthy();
    const firstJson = (await first.json()) as {
      success: boolean;
      data?: {
        status?: string;
        queuePosition?: number | null;
        jobId?: string;
      };
    };
    expect(firstJson.success).toBe(true);
    expect(firstJson.data?.jobId).toBe(jobId);
    expect(["pending", "processing", "completed", "failed"]).toContain(
      firstJson.data?.status,
    );

    // Simule « timeout client » : on arrête de poller, sans DELETE.
    // Le job doit toujours exister.
    await page.waitForTimeout(1500);
    const still = await page.request.get(
      `/api/analysis-jobs/${encodeURIComponent(jobId)}`,
      { headers },
    );
    expect(still.ok()).toBeTruthy();
    const stillJson = (await still.json()) as {
      success: boolean;
      data?: { status?: string };
    };
    expect(stillJson.success).toBe(true);
    expect(stillJson.data?.status).toBeTruthy();

    // Pas d’endpoint DELETE job — vérifier qu’un DELETE inventé ne casse pas.
    const del = await page.request.delete(
      `/api/analysis-jobs/${encodeURIComponent(jobId)}`,
      { headers: { ...(await csrfHeaders(page)), ...evalHeaders() } },
    );
    expect([404, 405]).toContain(del.status());

    const afterFakeDelete = await page.request.get(
      `/api/analysis-jobs/${encodeURIComponent(jobId)}`,
      { headers },
    );
    expect(afterFakeDelete.ok()).toBeTruthy();

    // Reprise via historyId (refresh / historique)
    expect(progressive.historyId).toBeTruthy();
    const byHist = await page.request.get(
      `/api/analysis-jobs/by-history/${encodeURIComponent(progressive.historyId!)}`,
      { headers },
    );
    expect(byHist.ok(), await byHist.text()).toBeTruthy();
    const byHistJson = (await byHist.json()) as {
      success: boolean;
      data?: { jobId?: string; status?: string };
    };
    expect(byHistJson.success).toBe(true);
    expect(byHistJson.data?.jobId).toBe(jobId);
  });

  test("UI analyser — états file (En attente / en cours)", async ({ page }) => {
    await openAppHome(page);
    const ollama = await healthOllamaOk(page);
    if (!ollama) {
      if (requireOllama()) {
        throw new Error("Ollama down — E2E_REQUIRE_OLLAMA=1");
      }
      test.skip(true, "Ollama indisponible");
    }

    await page.goto("/analyser");
    const pdf = await ensureSamplePdf();
    const input = page.locator('input[type="file"]');
    await expect(input).toBeAttached({ timeout: 15_000 });
    await input.setInputFiles(pdf);

    // Après upload+P1 : aperçu + message file ou génération IA
    const queueOrRunning = page.getByText(
      /Analyse en cours|Analyse en file|Génération IA en cours|1 à 3 minutes/i,
    );
    await expect(queueOrRunning.first()).toBeVisible({ timeout: 180_000 });

    // Pas d’ETA chiffrée inventée (minutes possibles OK ; pas « X min restantes »)
    await expect(page.getByText(/\bETA\b|\d+\s*min(utes)?\s*(restantes|estim)/i)).toHaveCount(0);
  });
});
