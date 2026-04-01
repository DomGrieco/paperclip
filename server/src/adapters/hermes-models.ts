import fs from "node:fs";
import path from "node:path";
import type { AdapterModel } from "./types.js";
import { models as codexFallbackModels } from "@paperclipai/adapter-codex-local";
import { models as hermesFallbackModels } from "hermes-paperclip-adapter";

const DEFAULT_SHARED_HERMES_HOME_SOURCE = "/paperclip/shared/hermes-home-source";
const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";
const DEFAULT_ANTHROPIC_MODEL = "anthropic/claude-sonnet-4";

type HermesAuthStore = {
  active_provider?: string;
  provider?: string;
};

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ id, label: model.label.trim() || id });
  }
  return deduped;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function defaultModelForProvider(provider: string | null): string | null {
  if (!provider) return null;
  const normalized = provider.toLowerCase();
  if (normalized.includes("openai") || normalized.includes("codex")) return DEFAULT_CODEX_MODEL;
  if (normalized.includes("anthropic") || normalized.includes("claude")) return DEFAULT_ANTHROPIC_MODEL;
  return null;
}

function isDefaultLikeModel(model: string | null): boolean {
  return model === null || model === DEFAULT_ANTHROPIC_MODEL || model === "claude-sonnet-4";
}

function readHermesAuthStore(sharedSource = DEFAULT_SHARED_HERMES_HOME_SOURCE): HermesAuthStore | null {
  try {
    const authFile = path.join(sharedSource, "auth.json");
    if (!fs.existsSync(authFile)) return null;
    return JSON.parse(fs.readFileSync(authFile, "utf8")) as HermesAuthStore;
  } catch {
    return null;
  }
}

export function resolveHermesActiveProvider(sharedSource?: string): string | null {
  const authStore = readHermesAuthStore(sharedSource);
  return readString(authStore?.active_provider) ?? readString(authStore?.provider);
}

function filterModelsForProvider(provider: string | null): AdapterModel[] {
  if (!provider) return dedupeModels(hermesFallbackModels);
  const normalized = provider.toLowerCase();

  if (normalized.includes("openai") || normalized.includes("codex")) {
    return dedupeModels(codexFallbackModels);
  }

  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return dedupeModels(hermesFallbackModels.filter((model) => model.id.startsWith("anthropic/")));
  }

  if (normalized.includes("google") || normalized.includes("gemini")) {
    return dedupeModels(
      hermesFallbackModels.filter(
        (model) => model.id.startsWith("google/") || model.id.includes("gemini"),
      ),
    );
  }

  return dedupeModels(hermesFallbackModels);
}

export async function listHermesModels(): Promise<AdapterModel[]> {
  return filterModelsForProvider(resolveHermesActiveProvider());
}

export function normalizeHermesAdapterConfigForDisplay(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const nextConfig: Record<string, unknown> = { ...config };
  const activeProvider = resolveHermesActiveProvider();
  const currentProvider = readString(config.provider);
  const currentModel = readString(config.model);

  if (!currentProvider && activeProvider) {
    nextConfig.provider = activeProvider;
  }
  if (isDefaultLikeModel(currentModel)) {
    const defaultModel = defaultModelForProvider(currentProvider ?? activeProvider);
    if (defaultModel) {
      nextConfig.model = defaultModel;
    }
  }

  return nextConfig;
}