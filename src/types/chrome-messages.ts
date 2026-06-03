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
  tldr: string | null;
  summary: string;
  tags: string[];
  model: string | null;
  metadata: YouTubeMetadata | null;
  durationMs?: number | null;
  url?: string;
  pageTitle?: string;
  streaming?: boolean;
}

// `seq` is a monotonic stamp the background applies to every outgoing state.
// The panel uses it to order a panelReady snapshot against live broadcasts so a
// stale one never overwrites a newer one (regardless of message delivery order).
export type PanelState = (
  | EmptyState
  | ProgressState
  | ErrorState
  | SummaryState
) & { seq?: number };

export interface ReadwiseTag {
  name: string;
}

export interface PanelReadyResponse {
  tabId: number | null;
  state: PanelState;
}
