import {
  streamObject,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
} from "ai";
import { z } from "zod";

// Structured shape the model fills in — replaces the old delimiter parsing.
const summaryOutputSchema = z.object({
  tldr: z
    .string()
    .describe(
      "A self-contained 1-2 sentence overview, 60 words max. State what the author argues and why it matters. Plain prose, no heading or label. Finish every sentence and close every Markdown marker."
    ),
  summary: z
    .string()
    .describe(
      "A scannable 3-6 item Markdown bullet list that expands on the TL;DR with supporting arguments and evidence. Keep each bullet to 1-2 short sentences and bold at most one short phrase per bullet. Do not repeat the TL;DR or add headings. Finish every sentence and close every Markdown marker."
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
        ? "The model reached its output limit before completing the summary."
        : "The model returned an incomplete summary."
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

function gatewayCostUsd(cost: unknown): number | null {
  if (typeof cost !== "number" && !(typeof cost === "string" && cost.trim())) {
    return null;
  }
  const value = Number(cost);
  return Number.isFinite(value) && value >= 0 ? value : null;
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
      "Please check your Vercel AI Gateway API key in the extension settings.";
  } else if (status === 402) {
    message = "Your Vercel AI Gateway account needs credits. Check your balance in the Vercel dashboard.";
  } else if (status === 429 || raw.includes("429")) {
    errorType = "rateLimit";
    message = "Rate limit exceeded. Please wait a moment before trying again.";
  } else if ((typeof status === "number" && status >= 500 && status < 600) || raw.includes("500")) {
    message = "The AI service is experiencing issues. Please try again later.";
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
  temperature,
  reasoning,
  maxOutputTokens = 1500,
  providerOptions,
  maxIncompleteRetries = 1,
  onPartial = () => {},
}: {
  model: LanguageModel;
  system: string;
  prompt: string;
  temperature?: number;
  reasoning?: Parameters<typeof streamObject>[0]["reasoning"];
  maxOutputTokens?: number;
  providerOptions?: Parameters<typeof streamObject>[0]["providerOptions"];
  maxIncompleteRetries?: number;
  onPartial?: (partial: Summary) => void;
}): Promise<SummaryResult> {
  let totalUsage: SummaryUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let totalCostUsd: number | null = 0;

  for (let attempt = 0; attempt <= maxIncompleteRetries; attempt++) {
    const retryInstruction =
      attempt === 0
        ? ""
        : "\n\nThis is a retry because the previous result ended unexpectedly. Start over, finish every sentence, and close every Markdown marker in both prose fields before returning tags.";
    const { fullStream, object, usage, finishReason, providerMetadata } = streamObject({
      model,
      schema: summaryOutputSchema,
      system: `${system}${retryInstruction}`,
      prompt,
      temperature,
      reasoning,
      maxOutputTokens,
      providerOptions,
      // Fail fast — the side panel owns retry/backoff (see use-chrome-messages),
      // so we don't want the SDK's built-in exponential backoff on top.
      maxRetries: 0,
      // Handle raw errors from fullStream below, preserving Gateway status codes.
      onError: () => {},
    });

    // If the stream errors, the loop below throws and we skip the awaits — mark
    // promises handled so they never become unhandled rejections (the await still
    // re-throws into the caller's try/catch).
    object.catch(() => {});
    usage.catch(() => {});
    finishReason.catch(() => {});
    providerMetadata.catch(() => {});

    // partialObjectStream suppresses error events and can leave `object`
    // pending after authentication/network failures. Consume errors explicitly.
    for await (const part of fullStream) {
      if (part.type === "error") {
        throw part.error;
      }
      if (part.type === "object") {
        onPartial(normalizePartial(part.object));
      }
    }

    const final = await object;
    const finalUsage = await usage;
    const finalFinishReason = await finishReason;
    totalUsage = addUsage(totalUsage, finalUsage);
    // Gateway reports the charged cost, including reasoning and cache usage.
    // Keep it unknown if any attempt omits a cost, rather than undercount retries.
    const cost = gatewayCostUsd((await providerMetadata)?.gateway?.cost);
    totalCostUsd = totalCostUsd !== null && cost !== null ? totalCostUsd + cost : null;
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
      costUsd: totalCostUsd,
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
