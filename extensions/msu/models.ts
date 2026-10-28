// Read the model list from CatChat (LiteLLM). /v1/models gives only ids.
// /v1/model/info can give limits and features, but it can be hidden from students, so all of it is optional.

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { CATCHAT_API, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "./config.ts";

interface ModelInfo {
  model_name?: string;
  model_info?: {
    max_input_tokens?: number | null;
    max_tokens?: number | null;
    max_output_tokens?: number | null;
    supports_vision?: boolean | null;
    supports_reasoning?: boolean | null;
  };
}

async function getJson<T>(path: string, key: string, signal: AbortSignal): Promise<T | null> {
  const res = await fetch(`${CATCHAT_API}${path}`, { headers: { Authorization: `Bearer ${key}` }, signal });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function fetchModels(key: string, signal: AbortSignal): Promise<ProviderModelConfig[]> {
  const list = await getJson<{ data: { id: string }[] }>("/v1/models", key, signal);
  if (!list) throw new Error("CatChat did not return a model list. Run /login again.");
  const info = await getJson<{ data: ModelInfo[] }>("/v1/model/info", key, signal).catch(() => null);
  const byName = new Map((info?.data ?? []).map((m) => [m.model_name, m.model_info ?? {}]));

  return list.data.map(({ id }) => {
    const i = byName.get(id) ?? {};
    return {
      id,
      name: id,
      reasoning: i.supports_reasoning ?? /gpt-oss|qwen3|deepseek-r1/i.test(id),
      input: i.supports_vision ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: i.max_input_tokens ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: i.max_output_tokens ?? i.max_tokens ?? DEFAULT_MAX_TOKENS,
      compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
    } satisfies ProviderModelConfig;
  });
}
