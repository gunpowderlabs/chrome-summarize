import { test, expect } from "bun:test";
import { summarizationConfig } from "../config";
import { summarizePage } from "./gateway-summary";
import { classifyError, type Summary } from "./summarize";

test("summarizePage sends configured structured requests through the real Gateway adapter", async () => {
  const expected = {
    tldr: "Small experiments help you test a new habit.",
    summary: "- The author recommends trying one change before committing to it.\n\n## Apply this to your life\n\n1. Pick one habit you want to try today and write down what you expect to change.\n2. After trying it, compare the result with your expectation and decide whether to repeat it.",
    tags: ["habits"],
  };
  const json = JSON.stringify(expected);
  const partials: Summary[] = [];
  let requests = 0;
  const result = await summarizePage({
    apiKey: "test-gateway-key",
    system: "Summarize faithfully.",
    content: "x".repeat(100_001),
    onPartial: (partial) => partials.push(partial),
    fetch: async (url, init) => {
      requests++;
      expect(String(url)).toBe("https://ai-gateway.vercel.sh/v4/ai/language-model");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-gateway-key");
      expect(headers.get("ai-language-model-id")).toBe(summarizationConfig.model);
      expect(headers.get("ai-language-model-streaming")).toBe("true");
      expect(headers.has("anthropic-dangerous-direct-browser-access")).toBe(false);
      const body = JSON.parse(init?.body as string);
      expect(body.reasoning).toBe("minimal");
      expect(body.maxOutputTokens).toBe(summarizationConfig.maxOutputTokens);
      expect(body.temperature).toBeUndefined();
      expect(body.prompt[0].content).toBe("Summarize faithfully.");
      expect(body.prompt[1].content[0].text.length).toBe(100_000);
      expect(body.responseFormat.type).toBe("json");
      expect(body.responseFormat.schema.required).toEqual(["tldr", "summary", "tags"]);

      const chunks = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: json.slice(0, 40) },
        { type: "text-delta", id: "1", delta: json.slice(40) },
        { type: "text-end", id: "1" },
        {
          type: "finish", finishReason: { unified: "stop", raw: "STOP" },
          usage: { inputTokens: { total: 100 }, outputTokens: { total: 50 } },
          providerMetadata: { gateway: { cost: "0.000155" } },
        },
      ];
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  expect(requests).toBe(1);
  expect(result.model).toBe("google/gemini-3.5-flash-lite");
  expect(result.summary).toEqual(expected);
  expect(result.costUsd).toBe(0.000155);
  expect(partials.length).toBeGreaterThan(1);
  expect(partials.at(-1)).toEqual(expected);
});

test("Gateway authentication failures reach the settings error without retrying", async () => {
  let requests = 0;
  try {
    await summarizePage({
      apiKey: "invalid-test-key", system: "Summarize.", content: "Page text.",
      fetch: async () => {
        requests++;
        return Response.json({ error: { message: "Invalid API key", type: "authentication_error" } }, { status: 401 });
      },
    });
    throw new Error("Expected authentication failure");
  } catch (error) {
    expect(classifyError(error).errorType).toBe("apiKey");
  }
  expect(requests).toBe(1);
});
