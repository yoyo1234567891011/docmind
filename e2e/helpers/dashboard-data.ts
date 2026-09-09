import { expect, type Page } from "@playwright/test";

import { csrfHeaders, evalHeaders } from "./api";

export async function historyCount(page: Page): Promise<number> {
  const list = await page.request.get("/api/history", {
    headers: evalHeaders(),
  });
  if (!list.ok()) return -1;
  const json = (await list.json()) as { data?: { items?: unknown[] } };
  return json.data?.items?.length ?? 0;
}

export async function historyDocumentIds(page: Page): Promise<string[]> {
  const list = await page.request.get("/api/history", {
    headers: evalHeaders(),
  });
  if (!list.ok()) return [];
  const json = (await list.json()) as {
    data?: { items?: Array<{ documentId?: string }> };
  };
  return (json.data?.items ?? [])
    .map((i) => i.documentId || "")
    .filter(Boolean);
}

export async function historyItems(
  page: Page,
): Promise<
  Array<{
    id: string;
    documentId: string;
    fileName?: string;
    analyzedAt?: string;
    favorite?: boolean;
  }>
> {
  const list = await page.request.get("/api/history", {
    headers: evalHeaders(),
  });
  if (!list.ok()) return [];
  const json = (await list.json()) as {
    data?: {
      items?: Array<{
        id: string;
        documentId: string;
        fileName?: string;
        analyzedAt?: string;
        favorite?: boolean;
      }>;
    };
  };
  return json.data?.items ?? [];
}

export async function latestHistoryForDocument(
  page: Page,
  documentId: string,
): Promise<{ fileName?: string; analyzedAt?: string } | null> {
  const items = (await historyItems(page)).filter(
    (i) => i.documentId === documentId,
  );
  if (items.length === 0) return null;
  items.sort((a, b) =>
    (b.analyzedAt || "").localeCompare(a.analyzedAt || ""),
  );
  return items[0] ?? null;
}

export async function historyHasDocumentId(
  page: Page,
  documentId: string,
): Promise<boolean> {
  return (await historyDocumentIds(page)).includes(documentId);
}

/** Corpus mémoire via /api/insights?view=overview (uniqueValuePoints). */
export async function memoryCorpusCount(page: Page): Promise<number> {
  const res = await page.request.get("/api/insights?view=overview", {
    headers: evalHeaders(),
  });
  if (!res.ok()) return -1;
  const json = (await res.json()) as {
    data?: { uniqueValuePoints?: string[] };
  };
  for (const point of json.data?.uniqueValuePoints ?? []) {
    const m = point.match(/sur (\d+) document/i);
    if (m) return Number(m[1]);
  }
  return -1;
}

export async function subscriptionInsights(page: Page) {
  const res = await page.request.get("/api/insights?view=subscriptions", {
    headers: evalHeaders(),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const json = (await res.json()) as {
    data?: {
      subscriptions?: Array<{
        name?: string;
        monthlyEur?: number | null;
        documentCount?: number;
        productKey?: string | null;
      }>;
    };
  };
  return json.data?.subscriptions ?? [];
}

export async function documentRelationsCount(
  page: Page,
  documentId: string,
): Promise<number> {
  const res = await page.request.get(
    `/api/documents/${documentId}/relations`,
    { headers: evalHeaders() },
  );
  if (!res.ok()) return -1;
  const json = (await res.json()) as {
    data?: { relations?: unknown[] };
  };
  return json.data?.relations?.length ?? 0;
}

export async function deleteHistoryByDocumentId(
  page: Page,
  documentId: string,
): Promise<void> {
  for (let guard = 0; guard < 20; guard += 1) {
    const list = await page.request.get("/api/history", {
      headers: evalHeaders(),
    });
    expect(list.ok()).toBeTruthy();
    const json = (await list.json()) as {
      data?: { items?: Array<{ id: string; documentId: string }> };
    };
    const item = json.data?.items?.find((i) => i.documentId === documentId);
    if (!item) return;
    const del = await page.request.delete(`/api/history/${item.id}`, {
      headers: {
        ...(await csrfHeaders(page)),
        ...evalHeaders(),
      },
    });
    expect(del.ok(), await del.text()).toBeTruthy();
  }
}

export async function clearAllHistory(page: Page): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    const list = await page.request.get("/api/history", {
      headers: evalHeaders(),
    });
    if (!list.ok()) return;
    const json = (await list.json()) as {
      data?: { items?: Array<{ id: string }> };
    };
    const items = json.data?.items ?? [];
    if (items.length === 0) return;
    const headers = { ...(await csrfHeaders(page)), ...evalHeaders() };
    for (const item of items) {
      await page.request.delete(`/api/history/${item.id}`, { headers });
    }
  }
}

export async function waitForMemoryCorpus(
  page: Page,
  min: number,
  timeoutMs = 180_000,
): Promise<void> {
  await expect
    .poll(async () => memoryCorpusCount(page), {
      timeout: timeoutMs,
      message: `corpus mémoire >= ${min}`,
    })
    .toBeGreaterThanOrEqual(min);
}

/** Attend que les insights abonnements soient calculés (indexation mémoire async). */
export async function waitForSubscriptionInsights(
  page: Page,
  min: number,
  timeoutMs = 180_000,
): Promise<void> {
  await expect
    .poll(async () => (await subscriptionInsights(page)).length, {
      timeout: timeoutMs,
      message: `insights abonnements >= ${min}`,
    })
    .toBeGreaterThanOrEqual(min);
}
