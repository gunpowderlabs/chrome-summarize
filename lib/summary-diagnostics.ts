import type { SummaryUsage } from "./summarize";

export const DIAGNOSTICS_STORAGE_KEY = "summaryDiagnostics";
export const MAX_DIAGNOSTIC_RECORDS = 50;
export const MAX_DIAGNOSTIC_BYTES = 1_000_000;
export const MAX_RESPONSE_CHARACTERS = 32_768;

export interface SummaryDiagnosticEvent {
  event: "request-started" | "request-failed" | "request-succeeded" | "attempt-started" | "attempt-failed" | "attempt-succeeded";
  stage?: "extraction" | "generation" | "youtube";
  attempt?: number;
  durationMs?: number;
  inputCharacters?: number;
  originalInputCharacters?: number;
  inputTruncated?: boolean;
  systemCharacters?: number;
  maxOutputTokens?: number;
  reasoning?: string;
  finishReason?: string;
  usage?: SummaryUsage;
  costUsd?: number | null;
  responseId?: string;
  responseModel?: string;
  responseText?: string;
  error?: unknown;
  validationIssues?: { path: string; message: string }[];
  willRetry?: boolean;
}

export interface DiagnosticContext {
  requestId: string;
  tabId: number;
  extensionVersion: string;
  model?: string;
  pageUrl?: string;
}

interface DiagnosticError {
  name: string;
  message: string;
  statusCode?: number;
  stack?: string;
  cause?: DiagnosticError;
}

export interface DiagnosticRecord extends Omit<SummaryDiagnosticEvent, "error">, DiagnosticContext {
  timestamp: string;
  error?: DiagnosticError;
  responseCharacters?: number;
  responseTextTruncated?: boolean;
}

export interface DiagnosticReport {
  schemaVersion: 1;
  exportedAt: string;
  extensionVersion: string;
  records: DiagnosticRecord[];
}

function redact(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join("<REDACTED>");
  }
  return result
    .replace(/\b(Bearer|Basic)\s+[^\s"'<>]+/gi, "$1 <REDACTED>")
    .replace(/((?:api[_-]?key|gatewayApiKey|readwiseToken|authorization)\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, "$1<REDACTED>");
}

function bounded(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = "\n[... truncated ...]\n";
  const head = Math.floor((limit - marker.length) / 2);
  return text.slice(0, head) + marker + text.slice(-(limit - head - marker.length));
}

function describeError(error: unknown, secrets: string[], depth = 0): DiagnosticError {
  const err = error as { name?: unknown; message?: unknown; statusCode?: unknown; stack?: unknown; cause?: unknown } | null;
  return {
    name: bounded(redact(typeof err?.name === "string" ? err.name : "Error", secrets), 200),
    message: bounded(redact(typeof err?.message === "string" ? err.message : typeof error === "string" ? error : "Unknown error", secrets), 2_000),
    statusCode: typeof err?.statusCode === "number" ? err.statusCode : undefined,
    stack: typeof err?.stack === "string" ? bounded(redact(err.stack, secrets), 4_000) : undefined,
    cause: err?.cause != null && depth < 2 ? describeError(err.cause, secrets, depth + 1) : undefined,
  };
}

/** Keep useful page identity without credentials, query strings, or fragments. */
function diagnosticUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? bounded(`${parsed.origin}${parsed.pathname}`, 2_000)
      : parsed.protocol;
  } catch {
    return undefined;
  }
}

/** Allowlist fields: never serialize the SDK error's request body or headers. */
export function createDiagnosticRecord(context: DiagnosticContext, event: SummaryDiagnosticEvent, secrets: string[] = []): DiagnosticRecord {
  const responseText = event.responseText === undefined ? undefined : redact(event.responseText, secrets);
  return {
    timestamp: new Date().toISOString(),
    requestId: context.requestId,
    tabId: context.tabId,
    extensionVersion: context.extensionVersion,
    model: context.model,
    pageUrl: diagnosticUrl(context.pageUrl),
    event: event.event,
    stage: event.stage ?? "generation",
    attempt: event.attempt,
    durationMs: event.durationMs,
    inputCharacters: event.inputCharacters,
    originalInputCharacters: event.originalInputCharacters,
    inputTruncated: event.inputTruncated,
    systemCharacters: event.systemCharacters,
    maxOutputTokens: event.maxOutputTokens,
    reasoning: event.reasoning,
    finishReason: event.finishReason,
    usage: event.usage && { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens, totalTokens: event.usage.totalTokens },
    costUsd: event.costUsd,
    responseId: event.responseId,
    responseModel: event.responseModel,
    responseText: responseText === undefined ? undefined : bounded(responseText, MAX_RESPONSE_CHARACTERS),
    responseCharacters: event.responseText?.length,
    responseTextTruncated: responseText === undefined ? undefined : responseText.length > MAX_RESPONSE_CHARACTERS,
    error: event.error === undefined ? undefined : describeError(event.error, secrets),
    validationIssues: event.validationIssues?.slice(0, 10).map((issue) => ({
      path: bounded(redact(issue.path, secrets), 200),
      message: bounded(redact(issue.message, secrets), 500),
    })),
    willRetry: event.willRetry,
  };
}

interface DiagnosticStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
  setAccessLevel(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
}

/** One service-worker writer serializes updates from concurrent tab requests. */
export function createDiagnosticsStore(storage: DiagnosticStorage) {
  const accessReady = storage.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  accessReady.catch(() => {});
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = queue.then(() => accessReady).then(operation);
    queue = task.catch(() => {});
    return task;
  }
  async function readRecords(): Promise<DiagnosticRecord[]> {
    const stored = (await storage.get(DIAGNOSTICS_STORAGE_KEY))[DIAGNOSTICS_STORAGE_KEY];
    return Array.isArray(stored) ? stored : [];
  }
  return {
    record(context: DiagnosticContext, event: SummaryDiagnosticEvent, secrets: string[] = []) {
      const entry = createDiagnosticRecord(context, event, secrets);
      return enqueue(async () => {
        const records = [...await readRecords(), entry].slice(-MAX_DIAGNOSTIC_RECORDS);
        while (records.length > 1 && new TextEncoder().encode(JSON.stringify(records)).byteLength > MAX_DIAGNOSTIC_BYTES) {
          records.shift();
        }
        await storage.set({ [DIAGNOSTICS_STORAGE_KEY]: records });
      });
    },
    read(extensionVersion: string, requestId?: string): Promise<DiagnosticReport> {
      return enqueue(async () => ({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        extensionVersion,
        records: (await readRecords()).filter((record) => requestId === undefined || record.requestId === requestId),
      }));
    },
    clear() {
      return enqueue(() => storage.remove(DIAGNOSTICS_STORAGE_KEY));
    },
  };
}
