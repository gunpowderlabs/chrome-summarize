export function EmptyState() {
  return (
    <div className="p-5">
      <h2 className="text-xl font-bold mb-4 pb-2 border-b-2 border-foreground">
        Page Summarizer
      </h2>
      <p className="text-sm text-muted-foreground">
        Click the extension icon or press{" "}
        <kbd className="inline-block px-1.5 py-0.5 text-xs font-mono bg-muted border border-border rounded shadow-sm">
          Cmd+Shift+S
        </kbd>{" "}
        to summarize the current page.
      </p>
    </div>
  );
}
