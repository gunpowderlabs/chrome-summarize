import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { useState } from "react";

interface ErrorStateProps {
  title: string;
  message: string;
  errorType: "apiKey" | "rateLimit" | "generic";
  onRetry: () => void;
  diagnosticsRequestId?: string;
}

export function ErrorState({ title, message, errorType, onRetry, diagnosticsRequestId }: ErrorStateProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const copyDiagnostics = async () => {
    setCopyStatus("copying");
    try {
      const response = await chrome.runtime.sendMessage({ action: "getSummaryDiagnostics", requestId: diagnosticsRequestId });
      if (!response?.ok || !response.report?.records?.length) throw new Error("No saved diagnostics.");
      await navigator.clipboard.writeText(JSON.stringify(response.report, null, 2));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };
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
        {diagnosticsRequestId && (
          <Button size="sm" variant="secondary" disabled={copyStatus === "copying"} onClick={copyDiagnostics}>
            {copyStatus === "copied" ? "Diagnostics copied" : copyStatus === "copying" ? "Copying..." : "Copy diagnostics"}
          </Button>
        )}
      </div>
      {copyStatus === "error" && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Could not copy diagnostics. Open Settings to export saved logs.
        </p>
      )}
    </div>
  );
}
