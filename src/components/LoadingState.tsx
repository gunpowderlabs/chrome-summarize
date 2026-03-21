import { Progress } from "@/components/ui/progress";
import type { ProgressStage } from "@/types/chrome-messages";

interface LoadingStateProps {
  stage: ProgressStage;
  message: string;
}

export function LoadingState({ stage, message }: LoadingStateProps) {
  let percent = 0;
  let detail = "";

  switch (stage) {
    case "extracting":
      percent = 25;
      detail = "Analyzing page structure...";
      break;
    case "processing":
      percent = 50;
      detail = "Optimizing content for AI...";
      break;
    case "generating":
      percent = 75;
      detail = "Claude is reading and summarizing...";
      break;
    case "retrying":
      percent = 25;
      detail = "Preparing to retry...";
      break;
  }

  return (
    <div className="flex flex-col items-center justify-center p-10 text-center">
      <div className="size-10 border-4 border-muted border-t-primary rounded-full animate-spin mb-4" />
      <p className="text-muted-foreground mb-2">{message}</p>
      <p className="text-xs text-muted-foreground/70 mb-4">{detail}</p>
      <Progress value={percent} className="w-full" />
    </div>
  );
}
