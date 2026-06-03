import { useState, useEffect, useCallback, useRef } from "react";
import type { PanelState, ReadwiseTag, PanelReadyResponse } from "@/types/chrome-messages";

export interface ReadwiseState {
  tags: ReadwiseTag[];
  saveStatus: "idle" | "loading-tags" | "ready" | "saving" | "success" | "error";
  error: string | null;
}

const seqOf = (state: PanelState | undefined): number =>
  typeof state?.seq === "number" ? state.seq : -1;

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

  // Highest state `seq` already applied for the current tab. Lets us ignore a
  // snapshot or broadcast that lost a delivery race with a newer one. Reset on
  // every tab switch (seq is global, so a freshly-activated tab can be lower).
  const lastSeqRef = useRef(-1);
  // Live updates that land before the panelReady handshake tells us which tab we
  // belong to. We can't match them on tabId yet, so buffer the newest per tab
  // and reconcile once the handshake resolves — this is what stops the final
  // summary from being dropped and leaving the panel stuck on the placeholder.
  const pendingByTabRef = useRef<Map<number, PanelState>>(new Map());
  // Set once the user switches the active tab, so a late panelReady response
  // (its snapshot computed for the original tab) can't revert us.
  const sawActiveTabChangeRef = useRef(false);

  const retryCountRef = useRef(0);
  const retryTabIdRef = useRef<number | null>(null);
  const retryTimeoutRef = useRef<number | null>(null);
  const maxRetries = 3;

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current != null) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const resetRetryState = useCallback(() => {
    retryCountRef.current = 0;
    retryTabIdRef.current = null;
    clearRetryTimeout();
  }, [clearRetryTimeout]);

  // Listen for messages before requesting the initial snapshot so we don't
  // miss progress updates triggered by the panelReady handshake itself.
  useEffect(() => {
    // Apply a state for the current tab, advancing the seq watermark and running
    // the phase-driven side effects (retry/readwise resets).
    const applyState = (nextState: PanelState) => {
      lastSeqRef.current = Math.max(lastSeqRef.current, seqOf(nextState));
      setPanelState(nextState);
      if (nextState.phase === "empty" || nextState.phase === "summary") {
        resetRetryState();
      }
      // Reset readwise state once a summary finishes streaming, not on every
      // partial delta (which would wipe it repeatedly).
      if (nextState.phase === "summary" && !nextState.streaming) {
        setReadwise({ tags: [], saveStatus: "idle", error: null });
      }
    };

    const listener = (
      message: { action: string; [key: string]: unknown },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => {
      switch (message.action) {
        case "stateUpdate": {
          const nextState = message.state as PanelState;
          const msgTabId = message.tabId as number;
          if (tabIdRef.current == null) {
            // We don't know our tab yet (panelReady hasn't resolved). Buffer the
            // freshest update per tab instead of dropping it; reconciled below.
            const existing = pendingByTabRef.current.get(msgTabId);
            if (!existing || seqOf(nextState) > seqOf(existing)) {
              pendingByTabRef.current.set(msgTabId, nextState);
            }
          } else if (
            msgTabId === tabIdRef.current &&
            seqOf(nextState) > lastSeqRef.current
          ) {
            applyState(nextState);
          }
          break;
        }
        case "activeTabChanged": {
          // A tab switch always wins and is the freshest snapshot for that tab,
          // so apply unconditionally and reset the per-tab seq watermark.
          const nextState = message.state as PanelState;
          sawActiveTabChangeRef.current = true;
          resetRetryState();
          tabIdRef.current = message.tabId as number;
          setTabId(message.tabId as number);
          pendingByTabRef.current.clear();
          lastSeqRef.current = seqOf(nextState);
          setPanelState(nextState);
          setReadwise({ tags: [], saveStatus: "idle", error: null });
          break;
        }
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

    chrome.runtime.sendMessage(
      { action: "panelReady" },
      (response?: PanelReadyResponse) => {
        if (chrome.runtime.lastError) return;
        if (!response) return;

        // The user already switched tabs — that live state wins. Don't let this
        // snapshot (computed for the original tab) override it.
        if (sawActiveTabChangeRef.current) return;

        // Update ref immediately so later stateUpdate messages target the
        // correct tab even before React has re-rendered.
        tabIdRef.current = response.tabId;
        setTabId(response.tabId);

        // Pick the freshest of: this snapshot vs. any live update that arrived
        // (and was buffered) before we knew our tab. Buffering + seq ordering is
        // what prevents a dropped summary leaving us stuck on the placeholder.
        let chosen: PanelState = response.state ?? { phase: "empty" };
        if (response.tabId != null) {
          const buffered = pendingByTabRef.current.get(response.tabId);
          if (buffered && seqOf(buffered) > seqOf(chosen)) {
            chosen = buffered;
          }
        }
        pendingByTabRef.current.clear();

        if (seqOf(chosen) > lastSeqRef.current || lastSeqRef.current < 0) {
          applyState(chosen);
        }
      }
    );

    return () => {
      clearRetryTimeout();
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [clearRetryTimeout, resetRetryState]);

  const retry = useCallback(() => {
    const currentTabId = tabIdRef.current;
    if (!currentTabId) return;

    if (retryTabIdRef.current !== currentTabId) {
      retryCountRef.current = 0;
      retryTabIdRef.current = currentTabId;
    }

    clearRetryTimeout();
    retryCountRef.current++;
    if (retryCountRef.current > maxRetries) {
      setPanelState({
        phase: "error",
        title: "Maximum Retries Exceeded",
        message: "Please check your connection and try again later.",
        errorType: "generic",
      });
      resetRetryState();
      return;
    }

    const delay = Math.pow(2, retryCountRef.current - 1) * 1000;
    setPanelState({
      phase: "progress",
      stage: "retrying",
      message: `Retrying in ${delay / 1000} seconds... (${retryCountRef.current}/${maxRetries})`,
    });

    retryTimeoutRef.current = window.setTimeout(() => {
      retryTimeoutRef.current = null;
      chrome.runtime.sendMessage({
        action: "retrySummarize",
        tabId: currentTabId,
      });
    }, delay);
  }, [clearRetryTimeout, resetRetryState]);

  const requestReadwiseTags = useCallback(() => {
    chrome.storage.sync.get(
      ["enableReadwise", "readwiseToken"],
      (result: { [key: string]: unknown }) => {
        if (!result.enableReadwise || !result.readwiseToken) {
          setReadwise({
            tags: [],
            saveStatus: "error",
            error:
              "Readwise integration is not configured. Enable it and add your API token in Settings.",
          });
          return;
        }
        setReadwise((prev) => ({ ...prev, saveStatus: "loading-tags", error: null }));
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
