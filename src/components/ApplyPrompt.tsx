import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ApplyPrompt({ url }: { url?: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const resourceUrl = url?.trim();
  const prompt = resourceUrl
    ? `Help me apply the ideas in this resource to my life:
${resourceUrl}

Read the resource first. If you can't access it, ask me to paste the content or transcript.

Use what you know about my goals, circumstances, and constraints. Ask me one question at a time when you need more context.

Identify the ideas that are most relevant to me. Help me choose a small, realistic change to try, with a concrete first step and a way to tell whether it's helping. Be specific about how it fits my situation. If an idea doesn't fit, say so.`
    : null;

  useEffect(() => {
    if (copyState !== "copied") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const handleCopy = async () => {
    if (!prompt) return;
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Apply to my life</h2>
        <p className="text-sm text-muted-foreground">
          Copy this prompt into your AI chat to turn the ideas into practical steps.
        </p>
      </div>
      {prompt ? (
        <>
          <pre
            tabIndex={0}
            aria-label="Prompt to apply this resource to my life"
            className="max-h-[min(55vh,28rem)] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-4 font-[family-name:var(--font-geist-mono)] text-sm leading-relaxed [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {prompt}
          </pre>
          <div className="flex flex-col items-start gap-2">
            <Button size="sm" variant="outline" onClick={handleCopy} disabled={copyState === "copying"}>
              {copyState === "copied" ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              <span aria-live="polite">
                {copyState === "copied" ? "Copied!" : copyState === "copying" ? "Copying..." : "Copy prompt"}
              </span>
            </Button>
            {copyState === "error" && (
              <p role="alert" className="text-sm text-muted-foreground">
                Couldn't copy automatically. Select the prompt above and copy it.
              </p>
            )}
          </div>
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          The resource link is missing. Summarize the page again to create a prompt.
        </p>
      )}
    </div>
  );
}
