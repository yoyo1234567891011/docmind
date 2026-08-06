import { createHmac } from "crypto";

import { expect, test } from "@playwright/test";

import { csrfHeaders, evalHeaders } from "../helpers/api";
import { openAppHome } from "../helpers/auth";

function signStripePayload(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signed}`;
}

test.describe("Abonnement Premium · Remboursement", () => {
  test("page facturation + overview API", async ({ page }) => {
    await openAppHome(page);
    await page.goto("/facturation");
    await expect(
      page.getByText(/Premium|Gratuit|Facturation|abonnement/i).first(),
    ).toBeVisible({ timeout: 30_000 });

    const res = await page.request.get("/api/billing", {
      headers: evalHeaders(),
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const json = (await res.json()) as {
      success: boolean;
      data?: {
        isPremium?: boolean;
        entitlementsDevBypass?: boolean;
        plan?: { id?: string };
        subscription?: { plan?: string };
      };
    };
    expect(json.success).toBe(true);
    expect(json.data).toBeTruthy();
  });

  test("checkout Premium (Stripe ou message config)", async ({ page }) => {
    await openAppHome(page);
    const res = await page.request.post("/api/billing/checkout", {
      headers: {
        ...(await csrfHeaders(page)),
        ...evalHeaders(),
      },
    });
    const json = (await res.json()) as {
      success: boolean;
      data?: { url?: string };
      error?: { message?: string; code?: string };
    };

    if (res.ok() && json.success) {
      expect(json.data?.url).toMatch(/^https?:\/\//);
      return;
    }

    // Déjà premium, Stripe absent, ou erreur métier attendue
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(json.error?.message || json.error?.code).toBeTruthy();
  });

  test("remboursement — webhook Stripe protégé + event signé optionnel", async ({
    page,
  }) => {
    await openAppHome(page);

    const unsigned = await page.request.post("/api/stripe/webhook", {
      headers: { "Content-Type": "application/json" },
      data: { type: "charge.refunded" },
    });
    expect(unsigned.status()).toBeGreaterThanOrEqual(400);

    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) {
      test.info().annotations.push({
        type: "note",
        description:
          "STRIPE_WEBHOOK_SECRET absent — test signature négatif seulement.",
      });
      return;
    }

    const event = {
      id: `evt_e2e_refund_${Date.now()}`,
      object: "event",
      api_version: "2024-11-20.acacia",
      created: Math.floor(Date.now() / 1000),
      type: "charge.refunded",
      data: {
        object: {
          id: `ch_e2e_${Date.now()}`,
          object: "charge",
          amount: 1900,
          amount_refunded: 1900,
          currency: "eur",
          customer: null,
          refunded: true,
          metadata: {},
        },
      },
    };
    const payload = JSON.stringify(event);
    const signature = signStripePayload(payload, secret);

    const signed = await page.request.post("/api/stripe/webhook", {
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": signature,
      },
      // Corps brut — requis pour la vérif HMAC Stripe
      data: Buffer.from(payload, "utf8"),
    });

    // 200 handled / 400 construct fail selon version API Stripe
    expect([200, 400]).toContain(signed.status());
    if (signed.status() === 200) {
      const body = (await signed.json()) as {
        success?: boolean;
        data?: { received?: boolean };
      };
      expect(body.success ?? body.data?.received).toBeTruthy();
    }
  });

  test("sync billing", async ({ page }) => {
    await openAppHome(page);
    const res = await page.request.post("/api/billing/sync", {
      headers: {
        "Content-Type": "application/json",
        ...(await csrfHeaders(page)),
        ...evalHeaders(),
      },
      data: { sessionId: null },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);
  });
});
