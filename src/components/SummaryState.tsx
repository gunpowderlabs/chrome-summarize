import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReadwiseUI } from "./ReadwiseUI";
import type { YouTubeMetadata } from "@/types/chrome-messages";
import type { ReadwiseState } from "@/hooks/use-chrome-messages";
import { Separator } from "@/components/ui/separator";
import { Copy, BookOpen } from "lucide-react";

interface SummaryStateProps {
  summary: string;
  model: string | null;
  metadata: YouTubeMetadata | null;
  durationMs?: number | null;
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
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${p}</p>`)
    .join("");
  return html;
}

export function SummaryState({
  summary,
  model,
  metadata,
  durationMs,
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

  // Parse summary and tags
  const parts = summary.split("\nTAGS:");
  const summaryText = parts[0]!;
  const suggestedTags =
    parts.length > 1
      ? parts[1]!
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

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

  const wordCount = summaryText.trim().split(/\s+/).filter((w) => w.length > 0).length;

  // Check if Readwise is enabled
  useEffect(() => {
    chrome.storage.sync.get(["enableReadwise", "readwiseToken"], (result) => {
      setReadwiseEnabled(Boolean(result.enableReadwise && result.readwiseToken));
    });
  }, []);

  const handleCopy = useCallback(() => {
    const cleanSummary = summaryText.replace(/\*\*(.*?)\*\*/g, "$1");
    const snippet = `${url}\n\nTL;DR: ${cleanSummary}`;
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
  }, [url, summaryText]);

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
      <div
        className="prose dark:prose-invert max-w-none [&_p]:mb-3 [&_p]:text-base [&_p]:leading-relaxed [&_strong]:font-semibold"
        dangerouslySetInnerHTML={{ __html: processedHtml + metadataHtml }}
      />

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
          durationMs != null && `${(durationMs / 1000).toFixed(1)}s`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </div>
  );
}
