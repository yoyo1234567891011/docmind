import { expect, test } from "@playwright/test";

import {
  analyzeDocument,
  csrfHeaders,
  evalHeaders,
  healthOllamaOk,
  uploadPdf,
} from "../helpers/api";
import { openAppHome } from "../helpers/auth";
import { requireOllama } from "../helpers/env";

test.describe("Alertes", () => {
  test("alertes API list + mark read", async ({ page }) => {
    await openAppHome(page);
    const res = await page.request.get("/api/alerts", {
      headers: evalHeaders(),
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const json = (await res.json()) as {
      success: boolean;
      data?: { alerts?: Array<{ id?: string }> };
    };
    expect(json.success).toBe(true);
    const items = json.data?.alerts ?? [];
    expect(Array.isArray(items)).toBe(true);

    const first = items[0];
    if (first?.id) {
      const patch = await page.request.patch("/api/alerts", {
        headers: {
          "Content-Type": "application/json",
          ...(await csrfHeaders(page)),
          ...evalHeaders(),
        },
        data: { action: "read", ids: [first.id] },
      });
      expect(patch.ok(), await patch.text()).toBeTruthy();
    }
  });
});

test.describe.serial("Mémoire · Courrier (nécessite analyse)", () => {
  let historyId = "";
  let documentId = "";

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await openAppHome(page);
    const ollama = await healthOllamaOk(page);
    if (!ollama) {
      await page.close();
      if (requireOllama()) throw new Error("Ollama down");
      test.skip(true, "Ollama indisponible");
    }

    const uploaded = await uploadPdf(page);
    documentId = uploaded.documentId;
    const analyzed = await analyzeDocument(page, {
      documentId: uploaded.documentId,
      text: uploaded.text,
      fileName: uploaded.fileName,
      mode: "full",
    });
    historyId = analyzed.historyId || "";
    if (!historyId) {
      const res = await page.request.get("/api/history", {
        headers: evalHeaders(),
      });
      const json = (await res.json()) as {
        data?: { items?: Array<{ id: string; documentId: string }> };
      };
      historyId =
        json.data?.items?.find((i) => i.documentId === documentId)?.id || "";
    }
    await page.close();
    expect(historyId).toBeTruthy();
  });

  test("mémoire documentaire — timeline / relations", async ({ page }) => {
    await openAppHome(page);
    const timeline = await page.request.get(
      `/api/memory/timeline?documentId=${encodeURIComponent(documentId)}`,
      { headers: evalHeaders() },
    );
    expect(timeline.ok(), await timeline.text()).toBeTruthy();
    const tJson = (await timeline.json()) as { success: boolean };
    expect(tJson.success).toBe(true);

    const relations = await page.request.get(
      `/api/documents/${encodeURIComponent(documentId)}/relations`,
      { headers: evalHeaders() },
    );
    expect(relations.ok(), await relations.text()).toBeTruthy();
    const rJson = (await relations.json()) as { success: boolean };
    expect(rJson.success).toBe(true);
  });

  test("courrier (letter agent)", async ({ page }) => {
    await openAppHome(page);
    const res = await page.request.post("/api/letters", {
      headers: {
        "Content-Type": "application/json",
        ...(await csrfHeaders(page)),
        ...evalHeaders(),
      },
      data: {
        historyId,
        letterType: "auto",
        persist: true,
      },
      timeout: 180_000,
    });

    const json = (await res.json()) as {
      success: boolean;
      data?: { letter?: { body?: string; subject?: string } };
      error?: { code?: string; message?: string };
    };

    if (res.status() === 403) {
      expect(json.error?.code || json.error?.message).toMatch(
        /FORBIDDEN|Premium|premium/i,
      );
      return;
    }

    expect(res.ok(), json.error?.message).toBeTruthy();
    expect(json.success).toBe(true);
    expect(
      json.data?.letter?.body || json.data?.letter?.subject,
    ).toBeTruthy();
  });
});
