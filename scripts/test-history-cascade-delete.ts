/**
 * Cascade delete history — mémoire, alertes, outbox, jobs, logs.
 * Mode FS isolé (pas de PG requis).
 */
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";

process.env.DOCMIND_STORAGE = "fs";
process.env.DOCMIND_FS_FALLBACK = "0";
process.env.DOCMIND_FS_DUAL_WRITE = "0";
process.env.DOCMIND_SKIP_MEMORY_DUAL_WRITE = "1";
// Évite un hang Node sur connexions Redis héritées du shell.
delete process.env.REDIS_URL;
delete process.env.KV_URL;
delete process.env.KV_REST_API_URL;

async function main() {
  const userId = `cascade-user-${randomUUID().slice(0, 8)}`;
  const documentId = `doc-${randomUUID().slice(0, 8)}`;

  const { userDataDir } = await import("../src/config/paths");
  const {
    ensureUserWorkspace,
    resetUserWorkspaceCache,
  } = await import("../src/services/auth/workspace");
  const { saveHistoryRecord, deleteHistoryRecord, listHistoryRecords } =
    await import("../src/services/history/store");
  const { upsertMemoryFromHistoryRecord, listDeadlinesForDoc, listRelationsForDoc } =
    await import("../src/services/memory");
  const { getMemoryDocument } = await import(
    "../src/services/memory/document-store"
  );
  const { saveRelationsForDoc } = await import(
    "../src/services/memory/relation-store"
  );
  const { pinAlert, readAlertsState } = await import(
    "../src/services/alerts/state"
  );
  const {
    enqueueNotification,
    listPendingOutbox,
  } = await import("../src/services/notifications/outbox");
  const {
    __resetAnalysisJobsFsForTests,
    enqueueAnalysisJob,
    findAnalysisJobByHistoryId,
  } = await import("../src/services/analysis-jobs");
  const {
    appendAnalysisLog,
    readAnalysisLogs,
  } = await import("../src/services/logs/analysis-logs");
  const { listDocumentAlerts } = await import("../src/services/alerts");
  const { RISK_CRITERIA } = await import("../src/services/risk/criteria");
  const { EMPTY_READY_REPLY } = await import("../src/types/reply");

  resetUserWorkspaceCache();
  await rm(userDataDir(userId), { recursive: true, force: true }).catch(
    () => undefined,
  );
  await ensureUserWorkspace(userId);
  await __resetAnalysisJobsFsForTests();

  const analyzedAt = new Date().toISOString();
  const saved = await saveHistoryRecord(userId, {
    result: {
      documentId,
      classification: {
        category: "facture",
        label: "Facture",
        confidence: 0.95,
      },
      analysis: {
        document_type: "Facture",
        title: "Facture cascade",
        summary: "Facture de test pour suppression cascade.",
        date: "15/01/2026",
        dates: ["15/01/2026"],
        people: ["Jean Dupont"],
        organizations: ["Demo SAS"],
        amounts: ["120,00 EUR"],
        deadlines: ["Paiement sous 30 jours — échéance 15/02/2026"],
        important_points: ["Paiement 30 jours"],
        risks: [],
        actions: ["Payer avant le 15/02/2026"],
        risk_score: 25,
        risk_level: "faible",
        risk_explanation: "",
        risk_criteria: RISK_CRITERIA.map((c) => ({
          id: c.id,
          label: c.label,
          detected: false,
          score: 0,
          max_score: c.maxScore,
          reasons: [],
        })),
        risk_findings: [],
      },
      readyReply: EMPTY_READY_REPLY,
      model: "test",
      analyzedAt,
      promptsUsed: [],
      phase: "complete",
    },
    fileName: "facture-cascade.pdf",
    extractedText:
      "Facture Demo SAS. Client Jean Dupont. Montant 120 EUR. Paiement sous 30 jours.",
  });

  const hid = saved.id;
  const did = saved.documentId;

  await upsertMemoryFromHistoryRecord({
    ...saved,
    analysisPhase: "complete",
  });

  // Relation artificielle pour « Relations détectées »
  const peerDocId = `peer-${randomUUID().slice(0, 8)}`;
  await saveRelationsForDoc(userId, did, [
    {
      id: randomUUID(),
      userId,
      fromDocId: did,
      toDocId: peerDocId,
      type: "invoice_for",
      score: 0.9,
      method: "rules",
      evidence: [{ field: "amount_eur", left: "120", right: "120" }],
      status: "proposed",
      createdAt: analyzedAt,
      updatedAt: analyzedAt,
    },
  ]);

  await pinAlert(userId, {
    id: `analysis-ready-${hid}`,
    kind: "analysis_ready",
    severity: "info",
    priority: "moyenne",
    title: "Analyse complète prête",
    message: "Test cascade",
    historyId: hid,
    documentTitle: "Facture cascade",
    fileName: saved.fileName,
    evidence: [],
    date: analyzedAt.slice(0, 10),
    recommendedAction: "Consulter",
    createdAt: analyzedAt,
    read: false,
    dismissed: false,
  });

  await enqueueNotification(userId, {
    userId,
    channel: "email",
    notificationId: `analysis-ready-${hid}`,
    kind: "analysis_ready",
    payload: {
      to: "test@example.com",
      subject: "Analyse prête",
      body: "body",
      historyId: hid,
    },
  });

  await enqueueAnalysisJob({
    userId,
    documentId: did,
    historyId: hid,
    fileName: saved.fileName,
    skipReadyReply: true,
  });

  await appendAnalysisLog(userId, {
    documentId: did,
    historyId: hid,
    fileName: saved.fileName,
    category: "facture",
    categoryLabel: "Facture",
    model: "test",
    promptsUsed: [],
    durationMs: 10,
    tokens: { prompt: 0, completion: 0, total: 0 },
    steps: [],
    result: null,
    ok: true,
  });

  // Préconditions
  assert.ok(await getMemoryDocument(userId, did));
  assert.ok((await listDeadlinesForDoc(userId, did)).length >= 1);
  assert.ok((await listRelationsForDoc(userId, did)).length >= 1);
  assert.ok(
    (await readAlertsState(userId)).pinnedAlerts?.some(
      (a) => a.historyId === hid,
    ),
  );
  assert.ok(
    (await listPendingOutbox(userId)).some(
      (i) => i.payload.historyId === hid,
    ),
  );
  assert.ok(await findAnalysisJobByHistoryId({ userId, historyId: hid }));
  assert.ok(
    (await readAnalysisLogs(userId)).entries.some(
      (e) => e.documentId === did || e.historyId === hid,
    ),
  );
  console.log("OK preconditions (mémoire, alertes, outbox, job, logs)");

  await deleteHistoryRecord(userId, hid);

  // History gone
  const remaining = await listHistoryRecords(userId);
  assert.equal(remaining.filter((r) => r.id === hid).length, 0);

  // Mémoire documentaire
  assert.equal(await getMemoryDocument(userId, did), null);
  assert.equal((await listDeadlinesForDoc(userId, did)).length, 0);
  assert.equal((await listRelationsForDoc(userId, did)).length, 0);

  // Notifs / alertes épinglées
  const state = await readAlertsState(userId);
  assert.equal(
    (state.pinnedAlerts ?? []).filter((a) => a.historyId === hid).length,
    0,
  );
  assert.equal(
    (await listPendingOutbox(userId)).filter(
      (i) => i.payload.historyId === hid,
    ).length,
    0,
  );

  // Jobs + logs
  assert.equal(
    await findAnalysisJobByHistoryId({ userId, historyId: hid }),
    null,
  );
  assert.equal(
    (await readAnalysisLogs(userId)).entries.filter(
      (e) => e.documentId === did || e.historyId === hid,
    ).length,
    0,
  );

  // Dashboard alerts ne doit plus remonter cette analyse
  const alerts = await listDocumentAlerts(userId);
  assert.equal(alerts.alerts.filter((a) => a.historyId === hid).length, 0);

  console.log("OK cascade delete — tout le lié est purgé");

  await rm(userDataDir(userId), { recursive: true, force: true }).catch(
    () => undefined,
  );
  resetUserWorkspaceCache();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
