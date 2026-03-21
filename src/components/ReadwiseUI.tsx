import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ReadwiseState } from "@/hooks/use-chrome-messages";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, X, ExternalLink, Settings } from "lucide-react";

interface ReadwiseUIProps {
  readwise: ReadwiseState;
  suggestedTags: string[];
  onSave: (selectedTags: string[]) => void;
  onDismiss: () => void;
}

export function ReadwiseUI({ readwise, suggestedTags, onSave, onDismiss }: ReadwiseUIProps) {
  // Initialize selected tags from suggested tags that exist in available tags
  const initialSelected = useMemo(() => {
    const available = new Set(readwise.tags.map((t) => t.name));
    return new Set(suggestedTags.filter((t) => available.has(t)));
  }, [readwise.tags, suggestedTags]);

  const [selectedTags, setSelectedTags] = useState<Set<string>>(initialSelected);

  // Sync when tags arrive (from loading → ready)
  const [lastTagCount, setLastTagCount] = useState(0);
  if (readwise.tags.length !== lastTagCount) {
    setLastTagCount(readwise.tags.length);
    if (readwise.tags.length > 0) {
      const available = new Set(readwise.tags.map((t) => t.name));
      setSelectedTags(new Set(suggestedTags.filter((t) => available.has(t))));
    }
  }

  const toggleTag = (name: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (readwise.saveStatus === "loading-tags") {
    return (
      <Card className="mt-4">
        <CardContent className="flex items-center justify-center gap-2 py-6">
          <Spinner />
          <span className="text-sm text-muted-foreground">Loading tags...</span>
        </CardContent>
      </Card>
    );
  }

  if (readwise.saveStatus === "saving") {
    return (
      <Card className="mt-4">
        <CardContent className="flex items-center justify-center gap-2 py-6">
          <Spinner />
          <span className="text-sm text-muted-foreground">Saving to Readwise...</span>
        </CardContent>
      </Card>
    );
  }

  if (readwise.saveStatus === "success") {
    return (
      <Card className="mt-4">
        <CardContent className="text-center py-6">
          <p className="text-sm text-green-600 dark:text-green-400 mb-3 flex items-center justify-center gap-1.5">
            <Check className="size-4" /> Saved to Readwise!
          </p>
          <div className="flex gap-2 justify-center">
            <Button
              size="sm"
              onClick={() => chrome.tabs.create({ url: "https://read.readwise.io/new" })}
            >
              <ExternalLink className="size-3" />
              View in Readwise
            </Button>
            <Button size="sm" variant="secondary" onClick={onDismiss}>
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (readwise.saveStatus === "error") {
    return (
      <Card className="mt-4">
        <CardContent className="py-4">
          <p className="text-sm text-destructive mb-3 flex items-center gap-1.5">
            <X className="size-4" /> Error: {readwise.error}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => chrome.runtime.openOptionsPage()}>
              <Settings className="size-3" />
              Settings
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onSave(Array.from(selectedTags))}
            >
              Retry
            </Button>
            <Button size="sm" variant="secondary" onClick={onDismiss}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Ready state: show tag selection
  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Save to Readwise</CardTitle>
      </CardHeader>
      <CardContent>
        {readwise.tags.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-muted-foreground mb-2">Select tags:</p>
            <ScrollArea className="max-h-28">
            <div className="flex flex-wrap gap-1.5">
              {/* Suggested tags first */}
              {suggestedTags.map((name) => {
                const exists = readwise.tags.some((t) => t.name === name);
                if (!exists) return null;
                return (
                  <Badge
                    key={name}
                    variant={selectedTags.has(name) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleTag(name)}
                  >
                    {name}
                  </Badge>
                );
              })}
              {/* Remaining tags */}
              {readwise.tags
                .filter((t) => !suggestedTags.includes(t.name))
                .map((tag) => (
                  <Badge
                    key={tag.name}
                    variant={selectedTags.has(tag.name) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleTag(tag.name)}
                  >
                    {tag.name}
                  </Badge>
                ))}
            </div>
            </ScrollArea>
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onSave(Array.from(selectedTags))}>
            Save
          </Button>
          <Button size="sm" variant="secondary" onClick={onDismiss}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
