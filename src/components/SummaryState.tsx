import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ReadwiseUI } from "./ReadwiseUI";
import type { YouTubeMetadata } from "@/types/chrome-messages";
import type { ReadwiseState } from "@/hooks/use-chrome-messages";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Copy, BookOpen } from "lucide-react";

interface SummaryStateProps {
  tldr: string | null;
  summary: string;
  tags: string[];
  model: string | null;
  metadata: YouTubeMetadata | null;
  costUsd?: number | null;
  durationMs?: number | null;
  streaming?: boolean;
  url?: string;
  pageTitle?: string;
  readwise: ReadwiseState;
  onRequestReadwiseTags: () => void;
  onSaveToReadwise: (url: string, title: string, summary: string, tags: string[]) => void;
  onDismissReadwise: () => void;
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function processMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/^#{1,6}\s+(.*)$/gm, "$1");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${p}</p>`)
    .join("");
  return html;
}

function formatCost(costUsd: number | null | undefined): string | null {
  if (costUsd == null) {
    return null;
  }
  if (costUsd > 0 && costUsd < 0.001) {
    return "<$0.001";
  }
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(3)}`;
  }
  return `$${costUsd.toFixed(2)}`;
}

export function SummaryState({
  tldr,
  summary = "",
  tags = [],
  model,
  metadata,
  costUsd,
  durationMs,
  streaming = false,
  url,
  pageTitle,
  readwise,
  onRequestReadwiseTags,
  onSaveToReadwise,
  onDismissReadwise,
}: SummaryStateProps) {
  const [copyLabel, setCopyLabel] = useState("Copy Sharable Snippet");
  const [showReadwise, setShowReadwise] = useState(false);
  const [readwiseEnabled, setReadwiseEnabled] = useState(false);

  // Structured fields arrive directly from the model — no parsing required.
  const tldrText = tldr;
  const summaryText = summary;
  const suggestedTags = tags;

  const tldrHtml = tldrText ? processMarkdown(tldrText) : null;
  const processedHtml = processMarkdown(summaryText);

  // YouTube metadata HTML
  let metadataHtml = "";
  if (metadata) {
    const items: string[] = [];
    if (metadata.duration) items.push(`<strong>Duration:</strong> ${escapeHtml(metadata.duration)}`);
    if (metadata.channel) items.push(`<strong>Channel:</strong> ${escapeHtml(metadata.channel)}`);
    if (metadata.hasTranscript) items.push(`<strong>Source:</strong> Video transcript`);
    if (items.length) metadataHtml = `<p>${items.join("<br>")}</p>`;
  }

  const fullText = tldrText ? `${tldrText} ${summaryText}` : summaryText;
  const wordCount = fullText.trim().split(/\s+/).filter((w) => w.length > 0).length;
  const estimatedCostLabel = formatCost(costUsd);

  // Check if Readwise is enabled
  useEffect(() => {
    chrome.storage.sync.get(["enableReadwise", "readwiseToken"], (result) => {
      setReadwiseEnabled(Boolean(result.enableReadwise && result.readwiseToken));
    });
  }, []);

  const handleCopy = useCallback(() => {
    const copySource = tldrText ?? summaryText;
    const cleanSummary = copySource.replace(/\*\*(.*?)\*\*/g, "$1").trim();
    const snippet = url ? `${url}\nTL;DR: ${cleanSummary}` : `TL;DR: ${cleanSummary}`;
    navigator.clipboard
      .writeText(snippet)
      .then(() => {
        setCopyLabel("Copied!");
        setTimeout(() => setCopyLabel("Copy Sharable Snippet"), 2000);
      })
      .catch(() => {
        setCopyLabel("Copy failed");
        setTimeout(() => setCopyLabel("Copy Sharable Snippet"), 2000);
      });
  }, [url, tldrText, summaryText]);

  const handleReadwiseClick = () => {
    setShowReadwise(true);
    onRequestReadwiseTags();
  };

  const handleSaveToReadwise = (selectedTags: string[]) => {
    const cleanSummary = summaryText.replace(/\*\*(.*?)\*\*/g, "$1");
    onSaveToReadwise(url ?? "", pageTitle ?? "", cleanSummary, selectedTags);
  };

  const handleDismissReadwise = () => {
    setShowReadwise(false);
    onDismissReadwise();
  };

  return (
    <div className="p-5">
      {tldrHtml && (
        <Card className="mb-4 border-border/60 bg-muted/40 py-4">
          <CardContent className="px-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              TL;DR
            </div>
            <div
              className="prose dark:prose-invert max-w-none [&_p]:mb-2 [&_p:last-child]:mb-0 [&_p]:text-base [&_p]:leading-relaxed [&_strong]:font-semibold [&_code]:rounded [&_code]:bg-background [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm"
              dangerouslySetInnerHTML={{ __html: tldrHtml }}
            />
          </CardContent>
        </Card>
      )}
      <div
        className="prose dark:prose-invert max-w-none [&_p]:mb-3 [&_p]:text-base [&_p]:leading-relaxed [&_strong]:font-semibold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm"
        dangerouslySetInnerHTML={{ __html: processedHtml + metadataHtml }}
      />

      {streaming && (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          Generating…
        </div>
      )}

      {!streaming && (
        <>
          {suggestedTags.length > 0 && !readwiseEnabled && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestedTags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-4">
            <Button size="sm" onClick={handleCopy}>
              <Copy />
              {copyLabel}
            </Button>
            <Button size="sm" variant="secondary" onClick={handleReadwiseClick}>
              <BookOpen />
              Save to Readwise
            </Button>
          </div>

          {showReadwise && (
            <ReadwiseUI
              readwise={readwise}
              suggestedTags={suggestedTags}
              onSave={handleSaveToReadwise}
              onDismiss={handleDismissReadwise}
            />
          )}

          <Separator className="mt-4" />
          <div className="pt-3 text-xs text-muted-foreground">
            {[
              `${wordCount} words`,
              model,
              estimatedCostLabel && `est. ${estimatedCostLabel}`,
              durationMs != null && `${(durationMs / 1000).toFixed(1)}s`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </>
      )}
    </div>
  );
}
