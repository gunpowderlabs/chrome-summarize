import type { ProgressStage } from "@/types/chrome-messages";

interface LoadingStateProps {
  stage: ProgressStage;
  message: string;
}

export function LoadingState({ stage, message }: LoadingStateProps) {
  let detail = "";

  switch (stage) {
    case "extracting":
      detail = "Analyzing page structure...";
      break;
    case "processing":
      detail = "Optimizing content for AI...";
      break;
    case "generating":
      detail = "Claude is reading and summarizing...";
      break;
    case "retrying":
      detail = "Preparing to retry...";
      break;
  }

  return (
    <div className="flex flex-col items-center justify-center p-10 text-center">
      <div className="size-10 border-4 border-muted border-t-primary rounded-full animate-spin mb-4" />
      <p className="text-muted-foreground mb-2">{message}</p>
      <p className="text-xs text-muted-foreground/70">{detail}</p>
    </div>
  );
}
