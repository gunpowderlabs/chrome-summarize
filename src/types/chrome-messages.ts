export type ProgressStage =
  | "extracting"
  | "processing"
  | "generating"
  | "retrying";

export interface EmptyState {
  phase: "empty";
}

export interface ProgressState {
  phase: "progress";
  stage: ProgressStage;
  message: string;
}

export interface ErrorState {
  phase: "error";
  title: string;
  message: string;
  errorType: "apiKey" | "rateLimit" | "generic";
  url?: string;
  pageTitle?: string;
}

export interface YouTubeMetadata {
  duration: string;
  channel: string;
  hasTranscript: boolean;
  fullSummary?: string;
}

export interface SummaryState {
  phase: "summary";
  summary: string;
  model: string | null;
  metadata: YouTubeMetadata | null;
  durationMs?: number | null;
  url?: string;
  pageTitle?: string;
}

export type PanelState = EmptyState | ProgressState | ErrorState | SummaryState;

export interface ReadwiseTag {
  name: string;
}

export interface PanelReadyResponse {
  tabId: number | null;
  state: PanelState;
}
