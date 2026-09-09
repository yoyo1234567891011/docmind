/**
 * Régression dates / timezone Europe/Paris — pas de décalage d’un jour
 * pour les dates calendaires YYYY-MM-DD affichées via formatDate.
 */
import assert from "assert";

import { formatDate, formatDateTime } from "../src/lib/format";
import {
  deadlineStatusFromDue,
  parseDateToIso,
} from "../src/services/memory/normalize";

function main() {
  process.env.TZ = "Europe/Paris";

  // Parse FR → ISO calendaire
  assert.strictEqual(parseDateToIso("31/12/2025"), "2025-12-31");
  assert.strictEqual(parseDateToIso("01/01/2026"), "2026-01-01");
  assert.strictEqual(parseDateToIso("2026-06-01"), "2026-06-01");

  // Affichage : YYYY-MM-DD ne doit PAS glisser au jour précédent en Paris
  const nye = formatDate("2025-12-31");
  assert.ok(
    /31/.test(nye) && /2025|déc|Dec/i.test(nye),
    `formatDate(2025-12-31) ne doit pas être le 30 : got « ${nye} »`,
  );
  const jan1 = formatDate("2026-01-01");
  assert.ok(
    /1/.test(jan1) && /2026|janv|Jan/i.test(jan1),
    `formatDate(2026-01-01) ne doit pas être le 31/12 : got « ${jan1} »`,
  );

  // Instant minuit Paris / bascule mois
  const midnightParis = formatDateTime("2026-03-31T22:00:00.000Z"); // 00:00 Paris (CEST)
  assert.ok(
    /1\s|01/.test(midnightParis) && /avr|Apr|2026/i.test(midnightParis),
    `23:59→00:00 Paris : attendu 1 avr. 2026, got « ${midnightParis} »`,
  );

  // Status échéance : date passée / future (calendaire)
  assert.strictEqual(deadlineStatusFromDue("2020-01-01"), "past");
  assert.strictEqual(deadlineStatusFromDue("2099-12-31"), "upcoming");

  console.log("OK test-dates-timezone");
}

main();
