import { useState, useEffect, useCallback, useRef } from "react";
import type { PanelState, ReadwiseTag, PanelReadyResponse } from "@/types/chrome-messages";

export interface ReadwiseState {
  tags: ReadwiseTag[];
  saveStatus: "idle" | "loading-tags" | "ready" | "saving" | "success" | "error";
  error: string | null;
}

export function useChromeMessages() {
  const [panelState, setPanelState] = useState<PanelState>({ phase: "empty" });
  const [tabId, setTabId] = useState<number | null>(null);
  const [readwise, setReadwise] = useState<ReadwiseState>({
    tags: [],
    saveStatus: "idle",
    error: null,
  });

  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;

  const retryCountRef = useRef(0);
  const maxRetries = 3;

  // On mount: send panelReady to background
  useEffect(() => {
    chrome.runtime.sendMessage(
      { action: "panelReady" },
      (response?: PanelReadyResponse) => {
        if (chrome.runtime.lastError) return;
        if (response) {
          // Update ref immediately so stateUpdate messages aren't dropped
          // before React re-renders (setTabId is async/batched)
          tabIdRef.current = response.tabId;
          setTabId(response.tabId);
          setPanelState(response.state ?? { phase: "empty" });
        }
      }
    );
  }, []);

  // Listen for messages from background
  useEffect(() => {
    const listener = (
      message: { action: string; [key: string]: unknown },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => {
      switch (message.action) {
        case "stateUpdate":
          if ((message.tabId as number) === tabIdRef.current) {
            setPanelState(message.state as PanelState);
            // Reset readwise state when switching to a new summary
            if ((message.state as PanelState).phase === "summary") {
              setReadwise({ tags: [], saveStatus: "idle", error: null });
            }
          }
          break;
        case "activeTabChanged":
          setTabId(message.tabId as number);
          setPanelState(message.state as PanelState);
          setReadwise({ tags: [], saveStatus: "idle", error: null });
          break;
        case "readwiseTagsReceived":
          setReadwise((prev) => ({
            ...prev,
            tags: message.tags as ReadwiseTag[],
            saveStatus: "ready",
          }));
          break;
        case "readwiseSaveSuccess":
          setReadwise((prev) => ({ ...prev, saveStatus: "success" }));
          break;
        case "readwiseSaveError":
          setReadwise((prev) => ({
            ...prev,
            saveStatus: "error",
            error: message.error as string,
          }));
          break;
        case "readwiseTagsError":
          setReadwise((prev) => ({
            ...prev,
            saveStatus: "error",
            error: message.error as string,
          }));
          break;
      }
      sendResponse({ status: "ok" });
      return true;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const retry = useCallback(() => {
    if (!tabIdRef.current) return;
    retryCountRef.current++;
    if (retryCountRef.current > maxRetries) {
      setPanelState({
        phase: "error",
        title: "Maximum Retries Exceeded",
        message: "Please check your connection and try again later.",
        errorType: "generic",
      });
      retryCountRef.current = 0;
      return;
    }
    const delay = Math.pow(2, retryCountRef.current - 1) * 1000;
    setPanelState({
      phase: "progress",
      stage: "retrying",
      message: `Retrying in ${delay / 1000} seconds... (${retryCountRef.current}/${maxRetries})`,
    });
    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: "retrySummarize",
        tabId: tabIdRef.current,
      });
    }, delay);
  }, []);

  const requestReadwiseTags = useCallback(() => {
    chrome.storage.sync.get(
      ["enableReadwise", "readwiseToken"],
      (result: { [key: string]: unknown }) => {
        if (!result.enableReadwise || !result.readwiseToken) {
          setPanelState({
            phase: "error",
            title: "Readwise Not Configured",
            message:
              "Please enable Readwise integration and set your API token in the extension settings.",
            errorType: "apiKey",
          });
          return;
        }
        setReadwise((prev) => ({ ...prev, saveStatus: "loading-tags" }));
        chrome.runtime.sendMessage({ action: "getReadwiseTags" });
      }
    );
  }, []);

  const saveToReadwise = useCallback(
    (url: string, title: string, summary: string, tags: string[]) => {
      setReadwise((prev) => ({ ...prev, saveStatus: "saving" }));
      chrome.runtime.sendMessage({
        action: "saveToReadwise",
        url,
        title,
        summary,
        tags,
      });
    },
    []
  );

  const dismissReadwise = useCallback(() => {
    setReadwise({ tags: [], saveStatus: "idle", error: null });
  }, []);

  return {
    panelState,
    tabId,
    readwise,
    retry,
    requestReadwiseTags,
    saveToReadwise,
    dismissReadwise,
  };
}
