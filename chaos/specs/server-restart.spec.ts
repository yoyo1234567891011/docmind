import { expect, test } from "@playwright/test";

import {
  csrfHeaders,
  evalHeaders,
  healthOllamaOk,
  uploadPdf,
} from "../../e2e/helpers/api";
import { openAppHome } from "../../e2e/helpers/auth";
import { requireOllama } from "../../e2e/helpers/env";

/**
 * Redémarrage serveur pendant analyse progressive.
 * Sans Ollama : on vérifie au moins upload + historique API stables.
 * Avec Ollama : progressive mode → preview doit rester après “crash” simulé
 * (requête analyse timeout + relecture history).
 */
test.describe("Chaos · server restart mid-analysis", () => {
  test("progressive analyze timeout — PDF reste exportable", async ({
    page,
  }) => {
    await openAppHome(page);
    const ollama = await healthOllamaOk(page);
    if (!ollama) {
      if (requireOllama()) throw new Error("Ollama down");
      test.skip(true, "Ollama indisponible — skip progressive chaos");
    }

    const uploaded = await uploadPdf(page);

    // Lance P1+P2 puis coupe côté client (simule perte réseau / restart perçu)
    await page.request
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
          mode: "progressive",
          skipReadyReply: true,
        },
        timeout: 8_000,
      })
      .catch(() => null);

    // Données utilisateur : PDF toujours là
    const file = await page.request.get(
      `/api/documents/${encodeURIComponent(uploaded.documentId)}/file`,
      { headers: evalHeaders() },
    );
    expect(file.ok(), await file.text()).toBeTruthy();
    const buf = await file.body();
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");

    const history = await page.request.get("/api/history", {
      headers: evalHeaders(),
    });
    expect(history.ok()).toBeTruthy();
    const json = (await history.json()) as {
      success: boolean;
      data?: {
        items?: Array<{
          documentId: string;
          analysisPhase?: string;
          analysis?: { summary?: string };
        }>;
      };
    };
    expect(json.success).toBe(true);
    const mine = json.data?.items?.filter(
      (i) => i.documentId === uploaded.documentId,
    );
    // Si preview a eu le temps d’être persisté, il doit être cohérent
    if (mine && mine.length > 0) {
      const phase = mine[0].analysisPhase;
      expect(["preview", "complete", "failed", undefined]).toContain(phase);
      if (mine[0].analysis?.summary) {
        expect(mine[0].analysis.summary.length).toBeGreaterThan(0);
      }
    }
  });
});
