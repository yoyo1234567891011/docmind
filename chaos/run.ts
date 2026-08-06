/**
 * Suite Chaos Testing DocMind.
 * Garantie ciblée : aucune perte de données utilisateur sous pannes simulées.
 *
 * Usage: npm run chaos
 */
import { clearChaosFaults } from "../src/lib/chaos";

import { withChaosEnv, type ChaosScenarioResult } from "./harness";
import { scenarios } from "./scenarios/all";

async function main(): Promise<void> {
  console.log("\n══ DocMind Chaos Testing ══\n");
  console.log(`Scénarios: ${scenarios.length}`);
  console.log("Objectif: 0 erreur · aucune perte de données utilisateur\n");

  const results: ChaosScenarioResult[] = [];

  await withChaosEnv(async () => {
    for (const scenario of scenarios) {
      const started = Date.now();
      process.stdout.write(`→ ${scenario.id} … `);
      try {
        clearChaosFaults();
        const detail = await scenario.run();
        clearChaosFaults();
        const durationMs = Date.now() - started;
        results.push({
          id: scenario.id,
          title: scenario.title,
          ok: true,
          detail,
          durationMs,
        });
        console.log(`OK (${durationMs}ms) — ${detail}`);
      } catch (error) {
        clearChaosFaults();
        const durationMs = Date.now() - started;
        const detail =
          error instanceof Error ? error.message : String(error);
        results.push({
          id: scenario.id,
          title: scenario.title,
          ok: false,
          detail,
          durationMs,
        });
        console.log(`FAIL (${durationMs}ms)`);
        console.error(`  ${detail}`);
      }
    }
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log("\n── Résumé ──");
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.id.padEnd(22)} ${r.title}`);
  }
  console.log(
    `\n${passed} passed · ${failed} failed · ${results.length} total\n`,
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
