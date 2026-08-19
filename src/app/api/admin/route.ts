import { listOllamaModels } from "@/ai/models/client";
import {
  getActiveProfileId,
  MODEL_PROFILE_IDS,
  MODEL_PROFILES,
} from "@/ai/models/config";
import { getLlmProviderConfig, isCloudLlmEnabled } from "@/ai/models/llm-provider";
import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import {
  ensureAdminRuntimeLoaded,
  readAdminConfig,
  readAdminMetrics,
  readAdminPrompts,
  summarizeFrequentErrors,
  summarizePerformance,
} from "@/services/admin";
import {
  readAnalyticsFile,
  summarizeProductAnalytics,
} from "@/services/analytics";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    await ensureAdminRuntimeLoaded();
    const [config, prompts, metricsFile, models, analyticsFile] =
      await Promise.all([
        readAdminConfig(),
        readAdminPrompts(),
        readAdminMetrics(),
        listOllamaModels(),
        readAnalyticsFile(),
      ]);

    return apiSuccess({
      config,
      prompts,
      models,
      performance: summarizePerformance(metricsFile.events),
      frequentErrors: summarizeFrequentErrors(metricsFile.events),
      recentEvents: metricsFile.events.slice(0, 40),
      productAnalytics: summarizeProductAnalytics(analyticsFile.events, {
        windowDays: 30,
      }),
      llmRuntime: (() => {
        const cfg = getLlmProviderConfig();
        if (cfg.kind === "openai_compatible") {
          const provider = cfg.baseUrl.includes("groq.com")
            ? "groq"
            : cfg.baseUrl.includes("mistral")
              ? "mistral"
              : "openai_compatible";
          return {
            cloudEnabled: true,
            provider,
            model: cfg.model,
            baseUrl: cfg.baseUrl,
          };
        }
        return {
          cloudEnabled: false,
          provider: "ollama" as const,
          model: config.tasks.analyze.model,
          baseUrl: config.ollamaBaseUrl,
        };
      })(),
      modelProfiles: isCloudLlmEnabled()
        ? undefined
        : {
            active: getActiveProfileId(),
            runtime: config.profileId ?? getActiveProfileId(),
            profiles: MODEL_PROFILE_IDS.map((id) => ({
              id,
              label: MODEL_PROFILES[id].label,
              description: MODEL_PROFILES[id].description,
              chat: MODEL_PROFILES[id].chat,
              embed: MODEL_PROFILES[id].embed,
            })),
          },
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
