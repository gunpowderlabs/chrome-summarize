import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReadwiseUI } from "./ReadwiseUI";
import type { YouTubeMetadata } from "@/types/chrome-messages";
import type { ReadwiseState } from "@/hooks/use-chrome-messages";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Copy, BookOpen } from "lucide-react";
import { Streamdown } from "streamdown";
import { ApplyPrompt } from "./ApplyPrompt";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

function SummaryMarkdown({ children, streaming }: { children: string; streaming: boolean }) {
  return (
    <Streamdown
      className="space-y-0"
      controls={false}
      isAnimating={streaming}
      mode={streaming ? "streaming" : "static"}
      skipHtml
    >
      {children}
    </Streamdown>
  );
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
  const showMetadata = Boolean(metadata?.duration || metadata?.channel || metadata?.hasTranscript);

  const fullText = tldrText ? `${tldrText} ${summaryText}` : summaryText;
  const wordCount = fullText.trim().split(/\s+/).filter((w) => w.length > 0).length;
  const costLabel = formatCost(costUsd);

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
    <div className="mx-auto w-full max-w-[42rem] p-4 sm:p-5">
      <Tabs defaultValue="summary" className="gap-5">
        <TabsList aria-label="Resource views">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="prompt">Prompt</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="min-w-0">
          {tldrText && (
            <>
              <div className="typeset typeset-docs">
                <SummaryMarkdown streaming={streaming}>
                  {tldrText}
                </SummaryMarkdown>
              </div>
              <Separator className="my-5" />
            </>
          )}
          <div className="typeset typeset-docs">
            <SummaryMarkdown streaming={streaming}>
              {summaryText}
            </SummaryMarkdown>
            {showMetadata && metadata && (
              <p>
                {metadata.duration && (
                  <>
                    <strong>Duration:</strong> {metadata.duration}
                  </>
                )}
                {metadata.duration && (metadata.channel || metadata.hasTranscript) && <br />}
                {metadata.channel && (
                  <>
                    <strong>Channel:</strong> {metadata.channel}
                  </>
                )}
                {metadata.channel && metadata.hasTranscript && <br />}
                {metadata.hasTranscript && (
                  <>
                    <strong>Source:</strong> Video transcript
                  </>
                )}
              </p>
            )}
          </div>

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
                  costLabel,
                  durationMs != null && `${(durationMs / 1000).toFixed(1)}s`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="prompt" className="min-w-0">
          <ApplyPrompt key={url} url={url} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
