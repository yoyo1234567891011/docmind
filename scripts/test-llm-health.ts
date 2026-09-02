/**
 * Tests unitaires : health LLM suit LLM_PROVIDER (cloud vs Ollama).
 * Aucun appel réseau réel — fetch mocké.
 */
import assert from "assert";

function clearLlmEnv() {
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.LLM_API_BASE_URL;
  delete process.env.LLM_MODEL;
  delete process.env.OLLAMA_BASE_URL;
}

async function withMockedFetch<T>(
  impl: typeof fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = prev;
  }
}

async function main() {
  clearLlmEnv();

  const { resolveLlmHealthBackend, checkLlmHealth } = await import(
    "../src/ai/models/llm-health"
  );

  // --- resolveLlmHealthBackend ---
  clearLlmEnv();
  process.env.LLM_PROVIDER = "ollama";
  process.env.GROQ_API_KEY = "gsk_test_not_used";
  assert.strictEqual(
    resolveLlmHealthBackend(),
    "ollama",
    "LLM_PROVIDER=ollama force Ollama même avec clé Groq",
  );

  clearLlmEnv();
  process.env.LLM_PROVIDER = "openai_compatible";
  process.env.GROQ_API_KEY = "gsk_test";
  assert.strictEqual(resolveLlmHealthBackend(), "cloud");

  clearLlmEnv();
  process.env.LLM_PROVIDER = "openai_compatible";
  // Pas de clé : backend health = cloud (ne pas basculer sur Ollama)
  assert.strictEqual(
    resolveLlmHealthBackend(),
    "cloud",
    "openai_compatible sans clé → health cloud (échouera), pas Ollama",
  );

  clearLlmEnv();
  process.env.GROQ_API_KEY = "gsk_test";
  assert.strictEqual(
    resolveLlmHealthBackend(),
    "cloud",
    "clé présente sans LLM_PROVIDER → cloud",
  );

  clearLlmEnv();
  assert.strictEqual(
    resolveLlmHealthBackend(),
    "ollama",
    "défaut local sans clé → ollama",
  );

  // --- checkLlmHealth cloud success (pas d'appel Ollama) ---
  clearLlmEnv();
  process.env.LLM_PROVIDER = "openai_compatible";
  process.env.GROQ_API_KEY = "gsk_test_key";
  process.env.LLM_API_BASE_URL = "https://api.groq.com/openai/v1";
  process.env.LLM_MODEL = "openai/gpt-oss-120b";

  let ollamaCalled = false;
  const cloudOk = await withMockedFetch(async (input) => {
    const url = String(input);
    if (url.includes("/api/tags") || url.includes("11434")) {
      ollamaCalled = true;
      return new Response("should-not-call-ollama", { status: 500 });
    }
    if (url.includes("/models")) {
      assert.ok(
        url.startsWith("https://api.groq.com/openai/v1/models"),
        `URL ping inattendue: ${url}`,
      );
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    return new Response("unexpected", { status: 500 });
  }, () => checkLlmHealth({ cloudTimeoutMs: 2_000 }));

  assert.strictEqual(cloudOk.backend, "cloud");
  assert.strictEqual(cloudOk.ok, true);
  assert.strictEqual(ollamaCalled, false, "cloud health ne doit pas sonder Ollama");

  // --- cloud forcé sans clé → down, toujours backend cloud ---
  clearLlmEnv();
  process.env.LLM_PROVIDER = "openai_compatible";
  const cloudNoKey = await checkLlmHealth({ cloudTimeoutMs: 500 });
  assert.strictEqual(cloudNoKey.backend, "cloud");
  assert.strictEqual(cloudNoKey.ok, false);

  // --- Ollama local OK ---
  clearLlmEnv();
  process.env.LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
  process.env.GROQ_API_KEY = "gsk_should_be_ignored";

  let cloudCalled = false;
  const ollamaOk = await withMockedFetch(async (input) => {
    const url = String(input);
    if (url.includes("/models") || url.includes("groq.com")) {
      cloudCalled = true;
      return new Response("no", { status: 500 });
    }
    if (url.includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
    return new Response("unexpected", { status: 500 });
  }, () => checkLlmHealth({ ollamaTimeoutMs: 2_000 }));

  assert.strictEqual(ollamaOk.backend, "ollama");
  assert.strictEqual(ollamaOk.ok, true);
  assert.strictEqual(cloudCalled, false, "ollama health ne doit pas sonder Groq");

  // --- Ollama down ---
  clearLlmEnv();
  process.env.LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
  const ollamaDown = await withMockedFetch(async () => {
    return new Response("down", { status: 503 });
  }, () => checkLlmHealth({ ollamaTimeoutMs: 500 }));
  assert.strictEqual(ollamaDown.backend, "ollama");
  assert.strictEqual(ollamaDown.ok, false);

  const { normalizeCloudModelId } = await import("../src/ai/models/llm-provider");
  assert.strictEqual(
    normalizeCloudModelId("llama-3.3-70b-versatile"),
    "qwen/qwen3.6-27b",
  );
  assert.strictEqual(
    normalizeCloudModelId("llama-3.1-8b-instant"),
    "openai/gpt-oss-20b",
  );

  console.log("OK test-llm-health");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
