/**
 * Plafond temporaire d’inscriptions (MAX_USERS).
 * Usage: npx tsx --tsconfig tsconfig.json scripts/test-signup-user-limit.ts
 */
import assert from "node:assert/strict";

import {
  evaluateSignupCapacity,
  getSignupMaxUsers,
  isSignupUserLimitEnabled,
  MAX_USERS,
  SIGNUP_FULL_MESSAGE,
} from "../src/config/signup-limits";
import { AppError } from "../src/lib/errors";
import {
  assertSignupAllowed,
  assertSignupCapacity,
  withSignupCapacityGate,
} from "../src/services/auth/signup-limit";

function withEnv(
  env: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

async function main() {
  console.log("=== Signup user limit ===\n");

  await withEnv({ SIGNUP_MAX_USERS: undefined }, () => {
    assert.equal(MAX_USERS, 35);
    assert.equal(getSignupMaxUsers(), 35);
    assert.equal(isSignupUserLimitEnabled(), true);
    console.log("OK défaut MAX_USERS=35 actif");
  });

  await withEnv({ SIGNUP_MAX_USERS: "0" }, () => {
    assert.equal(getSignupMaxUsers(), null);
    assert.equal(isSignupUserLimitEnabled(), false);
    assert.deepEqual(evaluateSignupCapacity(999, getSignupMaxUsers()), {
      allowed: true,
      message: null,
    });
    console.log("OK SIGNUP_MAX_USERS=0 désactive la limite");
  });

  await withEnv({ SIGNUP_MAX_USERS: "off" }, () => {
    assert.equal(getSignupMaxUsers(), null);
    console.log("OK SIGNUP_MAX_USERS=off désactive la limite");
  });

  await withEnv({ SIGNUP_MAX_USERS: "50" }, () => {
    assert.equal(getSignupMaxUsers(), 50);
    console.log("OK SIGNUP_MAX_USERS=50 surcharge le plafond");
  });

  await withEnv({ SIGNUP_MAX_USERS: undefined }, () => {
    assert.deepEqual(evaluateSignupCapacity(34, 35), {
      allowed: true,
      message: null,
    });
    assert.deepEqual(evaluateSignupCapacity(35, 35), {
      allowed: false,
      message: SIGNUP_FULL_MESSAGE,
    });
    assert.deepEqual(evaluateSignupCapacity(36, 35), {
      allowed: false,
      message: SIGNUP_FULL_MESSAGE,
    });
    assertSignupCapacity(34);
    assert.throws(
      () => assertSignupCapacity(35),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 403 &&
        err.message === SIGNUP_FULL_MESSAGE,
    );
    console.log("OK capacité : 34 OK, 35+ refusé");
  });

  // Simulation compteur (35e accepté, 36e refusé)
  await withEnv({ SIGNUP_MAX_USERS: undefined }, async () => {
    let users = 34;
    const countUsers = async () => users;

    await withSignupCapacityGate(async () => {
      await assertSignupAllowed(countUsers);
      users += 1; // 35e
    });
    assert.equal(users, 35);

    await assert.rejects(
      () =>
        withSignupCapacityGate(async () => {
          await assertSignupAllowed(countUsers);
          users += 1;
        }),
      (err: unknown) =>
        err instanceof AppError && err.message === SIGNUP_FULL_MESSAGE,
    );
    assert.equal(users, 35);
    console.log("OK 35e accepté, 36e refusé");
  });

  // Concurrence : deux inscriptions quand count=34 → une seule passe
  await withEnv({ SIGNUP_MAX_USERS: undefined }, async () => {
    let users = 34;
    const countUsers = async () => users;

    const results = await Promise.allSettled([
      withSignupCapacityGate(async () => {
        await assertSignupAllowed(countUsers);
        await new Promise((r) => setTimeout(r, 30));
        users += 1;
      }),
      withSignupCapacityGate(async () => {
        await assertSignupAllowed(countUsers);
        users += 1;
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    assert.equal(fulfilled, 1);
    assert.equal(rejected, 1);
    assert.equal(users, 35);
    const rejectedErr = results.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    assert.ok(
      rejectedErr &&
        rejectedErr.reason instanceof AppError &&
        rejectedErr.reason.message === SIGNUP_FULL_MESSAGE,
    );
    console.log("OK concurrence : 1 acceptée / 1 refusée, total=35");
  });

  // Limite désactivée : pas de plafond même à 1000
  await withEnv({ SIGNUP_MAX_USERS: "0" }, async () => {
    let users = 1000;
    const countUsers = async () => users;
    await withSignupCapacityGate(async () => {
      await assertSignupAllowed(countUsers);
      users += 1;
    });
    assert.equal(users, 1001);
    console.log("OK limite off : inscription sans plafond");
  });

  console.log("\nTous les tests signup-limit OK.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
