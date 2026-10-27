import {
  NoObjectGeneratedError,
  streamObject,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
} from "ai";
import { z } from "zod";
import type { SummaryDiagnosticEvent } from "./summary-diagnostics";

// Block boundaries belong to the schema; the model supplies inline content only.
const inlineDescription = "Use complete sentences with optional **bold** phrases only. No bullet markers, numbering, headings, HTML, or other Markdown.";
const summaryOutputSchema = z.object({
  tldr: z.string().describe(
    "A self-contained 1-2 sentence overview, 60 words max. For articles, state what the author argues and why it matters. For product pages, name the product, what it does, who it is for, and the main problem it addresses. " + inlineDescription
  ),
  bullets: z.array(z.string()).min(1).describe(
    "Usually 3-6 summary points, fewer for simple sources, one point per array item. Expand on the TL;DR without repeating it. For articles, include supporting arguments and evidence. For products, prioritize problems solved, features, limits, and pricing. Preserve stated prices, currencies, plans, billing terms, and free-plan or trial distinctions. Report contact-sales pricing when stated; if no price is supplied, say 'Pricing is not stated on this page.' Never guess prices. Attribute unverified claims to the seller. Each item is 1-2 short sentences with at most one short bold phrase. " + inlineDescription
  ),
  steps: z.array(z.string()).describe(
    "Usually 3-6 concrete application steps in order, one action per array item. Address the reader as 'you'. Ground each action in the source without inventing personal details or claims. For products, help assess fit and try a relevant use case using only capabilities and instructions on the page, without assuming a purchase. Use an empty array if there is no useful personal application, and explain why in applicationNote. Otherwise applicationNote must be null. " + inlineDescription
  ),
  applicationNote: z.string().nullable().describe(
    "A brief explanation when there is no useful personal application and steps is empty. Must be null when steps are provided. " + inlineDescription
  ),
  tags: z.array(z.string()).describe(
    "3-5 concise topical tags (1-2 words each) mixing general categories and specific topics."
  ),
});

function hasCompleteInlineProse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const unescaped = trimmed.replace(/\\./g, "");
  for (const marker of [/\*\*/g, /__/g]) {
    if ((unescaped.match(marker)?.length ?? 0) % 2 !== 0) return false;
  }
  // Each array item is inline text, not a model-authored list or heading.
  if (/^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>\s|```)/m.test(trimmed)) return false;
  const withoutClosingBold = trimmed.replace(/(?:\*\*|__)+\s*$/g, "").trim();
  return /[.!?…]["'’”]?$/.test(withoutClosingBold);
}

export const summarySchema = summaryOutputSchema.superRefine((value, context) => {
  const fields: { text: string; path: (string | number)[] }[] = [
    { text: value.tldr, path: ["tldr"] },
    ...value.bullets.map((text, index) => ({ text, path: ["bullets", index] })),
    ...value.steps.map((text, index) => ({ text, path: ["steps", index] })),
    ...(value.applicationNote === null ? [] : [{ text: value.applicationNote, path: ["applicationNote"] }]),
  ];
  for (const { text, path } of fields) {
    if (!hasCompleteInlineProse(text)) {
      context.addIssue({ code: "custom", message: "Must contain complete inline prose with balanced bold and no list markers or headings.", path });
    }
  }
  if ((value.steps.length > 0) !== (value.applicationNote === null)) {
    context.addIssue({ code: "custom", message: "Provide steps with a null applicationNote, or an explanation with empty steps.", path: ["applicationNote"] });
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
 * arrays — contain non-string entries.
 */
export function normalizePartial(partial: {
  tldr?: unknown;
  bullets?: unknown;
  steps?: unknown;
  applicationNote?: unknown;
  tags?: unknown;
}): Summary {
  const strings = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  return {
    tldr: typeof partial?.tldr === "string" ? partial.tldr : "",
    bullets: strings(partial?.bullets),
    steps: strings(partial?.steps),
    applicationNote: typeof partial?.applicationNote === "string" ? partial.applicationNote : null,
    tags: strings(partial?.tags),
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
  } else if (NoObjectGeneratedError.isInstance(error)) {
    message = error.finishReason === "length"
      ? "The model reached its output limit before completing the summary. Please try again."
      : "The AI service returned a summary in an invalid format. Please try again.";
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
  onDiagnostic = () => {},
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
  onDiagnostic?: (event: SummaryDiagnosticEvent) => void | Promise<void>;
}): Promise<SummaryResult> {
  let totalUsage: SummaryUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let totalCostUsd: number | null = 0;
  let outputTokenBudget = maxOutputTokens;
  // Diagnostics are best-effort and must never break summary generation.
  const emit = async (event: SummaryDiagnosticEvent) => {
    try { await onDiagnostic(event); }
    catch { console.warn("[Page Summarizer] Unable to save summary diagnostics."); }
  };

  for (let attempt = 0; attempt <= maxIncompleteRetries; attempt++) {
    const retryInstruction =
      attempt === 0
        ? ""
        : "\n\nThe previous response was invalid or incomplete. Start over and return a single valid JSON object with a tldr string, arrays of strings in bullets, steps, and tags, and an applicationNote string or null. Put each bullet and step in its own array item, without list markers, numbering, or headings. Provide steps with applicationNote null, or empty steps with an explanation in applicationNote. Escape quotation marks, backslashes, and newlines inside JSON strings. Do not wrap the JSON in Markdown fences or add text outside the object. Keep the summary concise, finish every sentence, and close every inline bold marker in every prose item before returning tags.";
    const startedAt = Date.now();
    const attemptContext = {
      attempt: attempt + 1,
      inputCharacters: prompt.length,
      systemCharacters: system.length + retryInstruction.length,
      maxOutputTokens: outputTokenBudget,
      reasoning,
    };
    await emit({ event: "attempt-started", ...attemptContext });
    const { fullStream, object, usage, finishReason, providerMetadata } = streamObject({
      model,
      schema: summaryOutputSchema,
      system: `${system}${retryInstruction}`,
      prompt,
      temperature,
      reasoning,
      maxOutputTokens: outputTokenBudget,
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
    let responseText = "";
    let responseId: string | undefined;
    let responseModel: string | undefined;
    try {
      for await (const part of fullStream) {
        if (part.type === "error") {
          throw part.error;
        }
        if (part.type === "text-delta") responseText += part.textDelta;
        if (part.type === "finish") {
          responseId = part.response.id;
          responseModel = part.response.modelId;
        }
        if (part.type === "object") {
          onPartial(normalizePartial(part.object));
        }
      }
    } catch (error) {
      await emit({ event: "attempt-failed", ...attemptContext, durationMs: Date.now() - startedAt, responseText, responseId, responseModel, error, willRetry: false });
      throw error;
    }

    let final: Summary | undefined;
    let outputError: NoObjectGeneratedError | undefined;
    try {
      final = await object;
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) {
        await emit({ event: "attempt-failed", ...attemptContext, durationMs: Date.now() - startedAt, responseText, responseId, responseModel, error, willRetry: false });
        throw error;
      }
      // Parsing/schema failures reject `object` before our prose checks. The
      // SDK has already resolved usage and metadata for these finished requests.
      outputError = error;
    }
    const finalUsage = await usage;
    const finalFinishReason = await finishReason;
    totalUsage = addUsage(totalUsage, finalUsage);
    // Gateway reports the charged cost, including reasoning and cache usage.
    // Keep it unknown if any attempt omits a cost, rather than undercount retries.
    const cost = gatewayCostUsd((await providerMetadata)?.gateway?.cost);
    totalCostUsd = totalCostUsd !== null && cost !== null ? totalCostUsd + cost : null;
    const validation = summarySchema.safeParse(final);
    const finishedContext = { ...attemptContext, durationMs: Date.now() - startedAt, responseId, responseModel, finishReason: finalFinishReason, usage: finalUsage, costUsd: cost };

    if (!validation.success || finalFinishReason === "length") {
      const error = outputError ?? new IncompleteSummaryError(finalFinishReason);
      await emit({
        event: "attempt-failed", ...finishedContext, error,
        responseText: outputError?.text ?? responseText,
        validationIssues: !outputError && !validation.success
          ? validation.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }))
          : undefined,
        willRetry: attempt < maxIncompleteRetries,
      });
      if (attempt < maxIncompleteRetries) {
        if (finalFinishReason === "length") {
          outputTokenBudget = maxOutputTokens * 2;
        }
        onPartial(normalizePartial({}));
        continue;
      }
      throw error;
    }

    await emit({ event: "attempt-succeeded", ...finishedContext });
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
