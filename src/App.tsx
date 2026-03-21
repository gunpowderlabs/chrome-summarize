import { useEffect } from "react";
import { useChromeMessages } from "@/hooks/use-chrome-messages";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { SummaryState } from "@/components/SummaryState";

export function App() {
  const {
    panelState,
    readwise,
    retry,
    requestReadwiseTags,
    saveToReadwise,
    dismissReadwise,
  } = useChromeMessages();

  // Sync dark mode class with system preference
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.classList.toggle("dark", mq.matches);
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  switch (panelState.phase) {
    case "empty":
      return <EmptyState />;
    case "progress":
      return (
        <LoadingState stage={panelState.stage} message={panelState.message} />
      );
    case "error":
      return (
        <ErrorState
          title={panelState.title}
          message={panelState.message}
          errorType={panelState.errorType}
          onRetry={retry}
        />
      );
    case "summary":
      return (
        <SummaryState
          summary={panelState.summary}
          model={panelState.model}
          metadata={panelState.metadata}
          url={panelState.url}
          pageTitle={panelState.pageTitle}
          readwise={readwise}
          onRequestReadwiseTags={requestReadwiseTags}
          onSaveToReadwise={saveToReadwise}
          onDismissReadwise={dismissReadwise}
        />
      );
  }
}
