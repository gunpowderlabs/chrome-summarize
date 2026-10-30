import type { GatewayModelId, streamObject } from "ai";

// Web-page summarization settings. After editing, run `bun run build` and
// reload the extension in chrome://extensions. YouTube still uses YTS.
export const summarizationConfig = {
  // Model IDs: https://vercel.com/ai-gateway/models
  model: "openai/gpt-6.1-terra",
  // Low reasoning balances summary quality and latency. When switching models,
  // choose a supported level, or use "provider-default".
  reasoning: "low",
  // Use the OpenAI BYOK credential configured in the Vercel team dashboard.
  // This limits the provider, but Gateway can still fall back to system credentials.
  providerOptions: { gateway: { only: ["openai"] } },
  // Budget for both reasoning and the visible summary. The prompt controls
  // summary length; a retry gets twice this only if the model hits the limit.
  maxOutputTokens: 16_384,
  maxInputCharacters: 100_000,
} satisfies {
  model: GatewayModelId;
  reasoning: Parameters<typeof streamObject>[0]["reasoning"];
  providerOptions: Parameters<typeof streamObject>[0]["providerOptions"];
  maxOutputTokens: number;
  maxInputCharacters: number;
};
