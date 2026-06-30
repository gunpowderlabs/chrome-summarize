import { test, expect } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  CLAUDE_MODEL,
  summarySchema,
  normalizePartial,
  buildSystemPrompt,
  classifyError,
  estimateCostUsd,
  mapYouTubeSummary,
  streamSummary,
  type Summary,
} from "./summarize";

// --- normalizePartial ---

test("normalizePartial fills missing fields with safe defaults", () => {
  expect(normalizePartial({})).toEqual({ tldr: "", summary: "", tags: [] });
});

test("normalizePartial passes through complete partials", () => {
  expect(
    normalizePartial({ tldr: "x", summary: "y", tags: ["a", "b"] })
  ).toEqual({ tldr: "x", summary: "y", tags: ["a", "b"] });
});

test("normalizePartial drops non-string tags from an in-progress array", () => {
  // The streamed object is not validated, so a half-formed tag array can hold
  // nulls/numbers before it settles.
  expect(
    normalizePartial({ tags: ["ok", null, 3, undefined] } as never)
  ).toEqual({ tldr: "", summary: "", tags: ["ok"] });
});

// --- buildSystemPrompt ---

test("buildSystemPrompt returns the base prompt unchanged when no tags", () => {
  expect(buildSystemPrompt("BASE")).toBe("BASE");
  expect(buildSystemPrompt("BASE", [])).toBe("BASE");
});

test("buildSystemPrompt appends a Readwise constraint listing the tags", () => {
  const out = buildSystemPrompt("BASE", ["tech", "ai"]);
  expect(out.startsWith("BASE")).toBe(true);
  expect(out).toContain("tech, ai");
  expect(out).toContain("MUST select ONLY");
});

// --- classifyError ---

test("classifyError maps 401 (statusCode or message) to apiKey", () => {
  expect(classifyError({ statusCode: 401 }).errorType).toBe("apiKey");
  expect(classifyError(new Error("HTTP 401 unauthorized")).errorType).toBe(
    "apiKey"
  );
});

test("classifyError maps 429 to rateLimit", () => {
  const r = classifyError({ statusCode: 429 });
  expect(r.errorType).toBe("rateLimit");
  expect(r.title).toBe("Rate Limit Exceeded");
});

test("classifyError maps 5xx and network errors to generic copy", () => {
  expect(classifyError({ statusCode: 503 }).message).toContain("issues");
  expect(
    classifyError(new Error("network request failed")).message.toLowerCase()
  ).toContain("network");
});

test("classifyError defaults to generic Processing Error", () => {
  const r = classifyError(new Error("something odd"));
  expect(r.errorType).toBe("generic");
  expect(r.title).toBe("Processing Error");
  expect(r.message).toBe("something odd");
});

// --- estimateCostUsd ---

test("estimateCostUsd uses Claude Sonnet 5 launch pricing through August 2026", () => {
  expect(
    estimateCostUsd(
      "claude-sonnet-5",
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        totalTokens: 2_000_000,
      },
      new Date("2026-08-31T23:59:59.000Z")
    )
  ).toBe(12);
});

test("estimateCostUsd uses Claude Sonnet 5 standard pricing from September 2026", () => {
  expect(
    estimateCostUsd(
      "claude-sonnet-5",
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        totalTokens: 2_000_000,
      },
      new Date("2026-09-01T00:00:00.000Z")
    )
  ).toBe(18);
});

test("estimateCostUsd returns null for unknown pricing", () => {
  expect(
    estimateCostUsd("unknown-model", {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    })
  ).toBeNull();
});

// --- mapYouTubeSummary ---

test("mapYouTubeSummary maps a YTS response into the structured shape", () => {
  expect(
    mapYouTubeSummary(
      { tldr: "t", tags: ["x"], full_summary: "full" },
      { duration: "10:00", uploader: "Channel" }
    )
  ).toEqual({
    summary: "t",
    tags: ["x"],
    metadata: {
      duration: "10:00",
      channel: "Channel",
      hasTranscript: true,
      fullSummary: "full",
    },
  });
});

test("mapYouTubeSummary falls back when fields are missing", () => {
  const r = mapYouTubeSummary({}, {});
  expect(r.summary).toBe("No summary available");
  expect(r.tags).toEqual([]);
  expect(r.metadata.duration).toBe("Unknown");
  expect(r.metadata.channel).toBe("Unknown");
});

// --- streamSummary (integration against the AI SDK mock model) ---

function jsonTextStream(obj: unknown) {
  const json = JSON.stringify(obj);
  const mid = Math.floor(json.length / 2);
  // Split the JSON across two deltas to exercise partial-object streaming.
  return simulateReadableStream({
    chunks: [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "1" },
      { type: "text-delta", id: "1", delta: json.slice(0, mid) },
      { type: "text-delta", id: "1", delta: json.slice(mid) },
      { type: "text-end", id: "1" },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          inputTokens: { total: 10 },
          outputTokens: { total: 20 },
        },
      },
    ] as never,
  });
}

test("streamSummary streams partials and returns the validated object", async () => {
  const expected: Summary = {
    tldr: "The bottom line in two sentences.",
    summary: "An expanded summary with **bold** phrases and reasoning.",
    tags: ["technology", "ai"],
  };

  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: jsonTextStream(expected) }),
  });

  const partials: Summary[] = [];
  const result = await streamSummary({
    model,
    system: "system prompt",
    prompt: "page content",
    pricingModelId: CLAUDE_MODEL,
    onPartial: (p) => partials.push(p),
  });

  // Final result matches and satisfies the schema.
  expect(result.summary).toEqual(expected);
  expect(summarySchema.parse(result.summary)).toEqual(expected);
  expect(result.usage).toEqual({
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  });
  expect(result.costUsd).toBe(0.00022);

  // We received at least one progressive update, and the last one is complete.
  expect(partials.length).toBeGreaterThan(0);
  expect(partials[partials.length - 1]).toEqual(expected);
});
