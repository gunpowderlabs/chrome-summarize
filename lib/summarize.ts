import {
  streamObject,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
} from "ai";
import { z } from "zod";

// Model used for summarization.
export const CLAUDE_MODEL = "claude-sonnet-5";

// Structured shape the model fills in — replaces the old delimiter parsing.
const summaryOutputSchema = z.object({
  tldr: z
    .string()
    .describe(
      "A self-contained 2-3 sentence overview (~100 words max). The bottom line: what the author argues and why it matters. Plain prose, no heading or label. Finish every sentence and close every Markdown marker."
    ),
  summary: z
    .string()
    .describe(
      "A comprehensive summary that expands on the TL;DR with supporting arguments and evidence. Do not repeat the TL;DR. Make key words and phrases bold using **double asterisks**. No headings or labels. Finish every sentence and close every Markdown marker."
    ),
  tags: z
    .array(z.string())
    .describe(
      "3-5 concise topical tags (1-2 words each) mixing general categories and specific topics."
    ),
});

function hasCompleteProseAndMarkdown(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const unescaped = trimmed.replace(/\\./g, "");
  const boldMarkers = unescaped.match(/\*\*/g)?.length ?? 0;
  const backticks = unescaped.match(/`/g)?.length ?? 0;
  if (boldMarkers % 2 !== 0 || backticks % 2 !== 0) {
    return false;
  }

  const withoutClosingMarkdown = trimmed.replace(/(?:\*\*|__|~~|`+|\]|\))+\s*$/g, "").trim();
  return /[.!?…]["'’”]?$/.test(withoutClosingMarkdown);
}

export const summarySchema = summaryOutputSchema.superRefine((value, context) => {
  for (const field of ["tldr", "summary"] as const) {
    if (!hasCompleteProseAndMarkdown(value[field])) {
      context.addIssue({
        code: "custom",
        message: "Must end with complete prose and balanced Markdown.",
        path: [field],
      });
    }
  }
});

export type Summary = z.infer<typeof summarySchema>;
export type SummaryErrorType = "apiKey" | "rateLimit" | "generic";

export type SummaryUsage = Pick<
  LanguageModelUsage,
  "inputTokens" | "outputTokens" | "totalTokens"
>;

export interface SummaryResult {
  summary: Summary;
  usage: SummaryUsage;
  costUsd: number | null;
}

class IncompleteSummaryError extends Error {
  constructor(finishReason: FinishReason) {
    super(
      finishReason === "length"
        ? "Claude reached its output limit before completing the summary."
        : "Claude returned an incomplete summary."
    );
    this.name = "IncompleteSummaryError";
  }
}

function addUsage(total: SummaryUsage, usage: LanguageModelUsage): SummaryUsage {
  return {
    inputTokens: (total.inputTokens ?? 0) + (usage.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (usage.outputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (usage.totalTokens ?? 0),
  };
}

type TokenPricing = { input: number; output: number };
type ScheduledTokenPricing = TokenPricing & { until?: Date };

const PRICING_PER_MILLION_TOKENS: Record<
  string,
  TokenPricing | ScheduledTokenPricing[]
> = {
  // https://platform.claude.com/docs/en/about-claude/pricing
  "claude-sonnet-5": [
    { input: 2, output: 10, until: new Date("2026-09-01T00:00:00.000Z") },
    { input: 3, output: 15 },
  ],
  "claude-sonnet-4-6": { input: 3, output: 15 },
};

function getTokenPricing(modelId: string, asOf: Date): TokenPricing | null {
  const pricing = PRICING_PER_MILLION_TOKENS[modelId];
  if (!pricing) {
    return null;
  }

  if (!Array.isArray(pricing)) {
    return pricing;
  }

  return pricing.find((entry) => !entry.until || asOf < entry.until) ?? null;
}

export function estimateCostUsd(
  modelId: string,
  usage: SummaryUsage,
  asOf = new Date()
): number | null {
  const pricing = getTokenPricing(modelId, asOf);
  if (!pricing) {
    return null;
  }

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;

  return (
    (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
  );
}

/**
 * Coerce a partial object from the stream into a stable shape. The streamed
 * object is not validated, so fields may be missing or — for the in-progress
 * tag array — contain non-string entries.
 */
export function normalizePartial(partial: {
  tldr?: unknown;
  summary?: unknown;
  tags?: unknown;
}): Summary {
  return {
    tldr: typeof partial?.tldr === "string" ? partial.tldr : "",
    summary: typeof partial?.summary === "string" ? partial.summary : "",
    tags: Array.isArray(partial?.tags)
      ? partial.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

/**
 * Append a Readwise tag constraint to the system prompt so the model only
 * suggests tags the user already uses. Returns the base prompt unchanged when
 * there are no existing tags.
 */
export function buildSystemPrompt(
  basePrompt: string,
  availableTags: string[] = []
): string {
  if (availableTags.length === 0) {
    return basePrompt;
  }
  return `${basePrompt}\n\nFor the "tags" field, you MUST select ONLY from these existing tags that the user already uses in Readwise: ${availableTags.join(
    ", "
  )}. Do not create new tags — only choose from this list.`;
}

/**
 * Map an error from the AI SDK (or a thrown Error) to the UI error state. The
 * SDK surfaces HTTP failures as APICallError with a statusCode; fall back to
 * matching the message for anything that doesn't carry one.
 */
export function classifyError(error: unknown): {
  errorType: SummaryErrorType;
  title: string;
  message: string;
} {
  const err = error as { statusCode?: number; message?: string; data?: any };
  const status = err?.statusCode ?? err?.data?.error?.status;
  const raw = err?.message || "";

  let errorType: SummaryErrorType = "generic";
  let message = raw || "Error generating summary.";

  if (status === 401 || raw.includes("401")) {
    errorType = "apiKey";
    message =
      "Invalid API key. Please check your Anthropic API key in the extension settings.";
  } else if (status === 429 || raw.includes("429")) {
    errorType = "rateLimit";
    message = "Rate limit exceeded. Please wait a moment before trying again.";
  } else if ((typeof status === "number" && status >= 500 && status < 600) || raw.includes("500")) {
    message = "Anthropic API is experiencing issues. Please try again later.";
  } else if (
    raw.toLowerCase().includes("network") ||
    raw.toLowerCase().includes("fetch")
  ) {
    message =
      "Network error. Please check your internet connection and try again.";
  }

  const title =
    errorType === "apiKey"
      ? "API Key Issue"
      : errorType === "rateLimit"
        ? "Rate Limit Exceeded"
        : "Processing Error";

  return { errorType, title, message };
}

/**
 * Stream a structured summary from any AI SDK language model. onPartial fires
 * with progressively more complete (normalized) objects; the resolved value is
 * the fully validated summary. Provider-agnostic — the caller supplies the model.
 */
export async function streamSummary({
  model,
  system,
  prompt,
  temperature = 0.7,
  maxOutputTokens = 1500,
  providerOptions,
  pricingModelId,
  maxIncompleteRetries = 1,
  onPartial = () => {},
}: {
  model: LanguageModel;
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  providerOptions?: Parameters<typeof streamObject>[0]["providerOptions"];
  pricingModelId?: string;
  maxIncompleteRetries?: number;
  onPartial?: (partial: Summary) => void;
}): Promise<SummaryResult> {
  // Anthropic ignores sampling params (temperature/top_p/top_k) under extended
  // thinking — it warns and silently drops them — so omit temperature whenever
  // a thinking config is supplied.
  const thinkingEnabled = Boolean(
    (providerOptions?.anthropic as { thinking?: unknown } | undefined)?.thinking
  );

  let totalUsage: SummaryUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  for (let attempt = 0; attempt <= maxIncompleteRetries; attempt++) {
    const retryInstruction =
      attempt === 0
        ? ""
        : "\n\nThis is a retry because the previous result ended unexpectedly. Start over, finish every sentence, and close every Markdown marker in both prose fields before returning tags.";
    const { partialObjectStream, object, usage, finishReason } = streamObject({
      model,
      schema: summaryOutputSchema,
      system: `${system}${retryInstruction}`,
      prompt,
      ...(thinkingEnabled ? {} : { temperature }),
      maxOutputTokens,
      providerOptions,
      // Fail fast — the side panel owns retry/backoff (see use-chrome-messages),
      // so we don't want the SDK's built-in exponential backoff on top.
      maxRetries: 0,
    });

    // If the stream errors, the loop below throws and we skip the awaits — mark
    // promises handled so they never become unhandled rejections (the await still
    // re-throws into the caller's try/catch).
    object.catch(() => {});
    usage.catch(() => {});
    finishReason.catch(() => {});

    for await (const partial of partialObjectStream) {
      onPartial(normalizePartial(partial));
    }

    const final = await object;
    const finalUsage = await usage;
    const finalFinishReason = await finishReason;
    totalUsage = addUsage(totalUsage, finalUsage);
    const validation = summarySchema.safeParse(final);

    if (!validation.success || finalFinishReason === "length") {
      if (attempt < maxIncompleteRetries) {
        onPartial({ tldr: "", summary: "", tags: [] });
        continue;
      }
      throw new IncompleteSummaryError(finalFinishReason);
    }

    return {
      summary: validation.data,
      usage: totalUsage,
      costUsd: pricingModelId ? estimateCostUsd(pricingModelId, totalUsage) : null,
    };
  }

  throw new Error("Summary generation did not complete.");
}

/**
 * Map a YTS native-host response into the structured summary shape used by the
 * side panel, so YouTube and web-page summaries share one rendering path.
 */
export function mapYouTubeSummary(
  summaryData: { tldr?: string; tags?: string[]; full_summary?: string },
  metadata: { duration?: string; uploader?: string }
): {
  summary: string;
  tags: string[];
  metadata: {
    duration: string;
    channel: string;
    hasTranscript: boolean;
    fullSummary?: string;
  };
} {
  return {
    summary: summaryData?.tldr || "No summary available",
    tags: summaryData?.tags || [],
    metadata: {
      duration: metadata?.duration || "Unknown",
      channel: metadata?.uploader || "Unknown",
      hasTranscript: true,
      fullSummary: summaryData?.full_summary,
    },
  };
}
