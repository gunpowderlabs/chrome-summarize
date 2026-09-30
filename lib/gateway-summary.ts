import { createGateway } from "ai";
import { summarizationConfig } from "../config";
import { streamSummary, type Summary } from "./summarize";
import type { SummaryDiagnosticEvent } from "./summary-diagnostics";

/** Route extracted page text through Gateway using the shared configuration. */
export async function summarizePage({
  apiKey,
  content,
  system,
  onPartial,
  onDiagnostic,
  fetch,
}: {
  apiKey: string;
  content: string;
  system: string;
  onPartial?: (partial: Summary) => void;
  onDiagnostic?: (event: SummaryDiagnosticEvent) => void | Promise<void>;
  fetch?: NonNullable<Parameters<typeof createGateway>[0]>["fetch"];
}) {
  const gateway = createGateway({ apiKey, fetch });
  const { model, reasoning, maxOutputTokens, maxInputCharacters } =
    summarizationConfig;
  const result = await streamSummary({
    model: gateway(model),
    reasoning,
    maxOutputTokens,
    system,
    prompt: content.slice(0, maxInputCharacters),
    onPartial,
    onDiagnostic: onDiagnostic && ((event) => onDiagnostic({
      ...event,
      originalInputCharacters: content.length,
      inputTruncated: content.length > maxInputCharacters,
    })),
  });
  return { ...result, model };
}
