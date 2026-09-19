import type { GatewayModelId, streamObject } from "ai";

// Web-page summarization settings. After editing, run `bun run build` and
// reload the extension in chrome://extensions. YouTube still uses YTS.
export const summarizationConfig = {
  // Model IDs: https://vercel.com/ai-gateway/models
  model: "google/gemini-3.5-flash-lite",
  // Minimal thinking keeps Flash-Lite responsive. When switching models,
  // choose a supported level, or use "provider-default".
  reasoning: "minimal",
  maxOutputTokens: 4096,
  maxInputCharacters: 100_000,
} satisfies {
  model: GatewayModelId;
  reasoning: Parameters<typeof streamObject>[0]["reasoning"];
  maxOutputTokens: number;
  maxInputCharacters: number;
};
