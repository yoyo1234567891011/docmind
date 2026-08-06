import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";

import {
  csrfHeaders,
  ensureSamplePdf,
  evalHeaders,
  uploadPdf,
} from "../../e2e/helpers/api";
import { openAppHome } from "../../e2e/helpers/auth";

/**
 * Chaos transport — connexion coupée / upload interrompu.
 * Vérifie qu’un abort client ne corrompt pas l’espace utilisateur.
 */
test.describe("Chaos · transport", () => {
  test("upload interrompu (AbortController) — pas de crash serveur", async ({
    page,
  }) => {
    await openAppHome(page);
    await ensureSamplePdf();
    const pdf = path.join(__dirname, "..", "..", "e2e", "fixtures", "sample.pdf");
    const headers = {
      ...(await csrfHeaders(page)),
      ...evalHeaders(),
    };

    // Playwright request : timeout court = coupure client (abort effectif).
    const uploadPromise = page.request
      .post("/api/upload", {
        headers,
        multipart: {
          file: {
            name: "chaos-abort.pdf",
            mimeType: "application/pdf",
            buffer: fs.readFileSync(pdf),
          },
        },
        timeout: 1,
      })
      .catch((err: unknown) => err);

    const result = await uploadPromise;
    // Timeout / abort attendu — le serveur doit rester sain ensuite
    expect(result).toBeTruthy();

    const health = await page.request.get("/api/health");
    expect(health.ok()).toBeTruthy();

    // Un upload complet fonctionne toujours après la coupure
    const uploaded = await uploadPdf(page);
    expect(uploaded.documentId).toBeTruthy();
    const file = await page.request.get(
      `/api/documents/${encodeURIComponent(uploaded.documentId)}/file`,
      { headers: evalHeaders() },
    );
    expect(file.ok(), await file.text()).toBeTruthy();
  });

  test("connexion coupée mid-analyze — historique existant lisible", async ({
    page,
  }) => {
    await openAppHome(page);
    const uploaded = await uploadPdf(page);

    const analyzeAttempt = page.request
      .post("/api/analyze", {
        headers: {
          "Content-Type": "application/json",
          ...(await csrfHeaders(page)),
          ...evalHeaders(),
        },
        data: {
          documentId: uploaded.documentId,
          text: uploaded.text,
          fileName: uploaded.fileName,
          mode: "full",
          skipReadyReply: true,
        },
        timeout: 1,
      })
      .catch((err: unknown) => err);

    await analyzeAttempt;

    const history = await page.request.get("/api/history", {
      headers: evalHeaders(),
    });
    expect(history.ok(), await history.text()).toBeTruthy();
    const json = (await history.json()) as { success: boolean };
    expect(json.success).toBe(true);

    const file = await page.request.get(
      `/api/documents/${encodeURIComponent(uploaded.documentId)}/file`,
      { headers: evalHeaders() },
    );
    expect(file.ok(), await file.text()).toBeTruthy();
  });
});
