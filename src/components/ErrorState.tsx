import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

interface ErrorStateProps {
  title: string;
  message: string;
  errorType: "apiKey" | "rateLimit" | "generic";
  onRetry: () => void;
}

export function ErrorState({ title, message, errorType, onRetry }: ErrorStateProps) {
  return (
    <div className="p-5">
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2 mt-4">
        {errorType === "apiKey" && (
          <>
            <Button size="sm" onClick={() => chrome.runtime.openOptionsPage()}>
              Open Settings
            </Button>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          </>
        )}
        {errorType === "rateLimit" && (
          <>
            <Button size="sm" onClick={() => setTimeout(onRetry, 60000)}>
              Retry in 1 minute
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                chrome.tabs.create({
                  url: "https://console.anthropic.com/account/billing",
                })
              }
            >
              Check Usage
            </Button>
          </>
        )}
        {errorType === "generic" && (
          <>
            <Button size="sm" onClick={onRetry}>
              Retry
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                chrome.tabs.create({
                  url: "https://github.com/anthropics/claude-code/issues",
                })
              }
            >
              Report Issue
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
