import { useState, useEffect, useCallback, useRef } from "react";
import type { PanelState, ReadwiseTag } from "@/types/chrome-messages";

export interface ReadwiseState {
  tags: ReadwiseTag[];
  saveStatus: "idle" | "loading-tags" | "ready" | "saving" | "success" | "error";
  error: string | null;
}

interface PanelReadyResponse {
  tabId: number | null;
  windowId: number | null;
  state: PanelState;
}

const EMPTY_STATE: PanelState = { phase: "empty" };
const EMPTY_READWISE: ReadwiseState = { tags: [], saveStatus: "idle", error: null };

// Read one tab's state out of the persisted tabStates map. Object keys are
// strings (Object.fromEntries), so a numeric tabId indexes fine via coercion.
function readTabState(
  map: Record<string, PanelState> | undefined,
  tabId: number | null
): PanelState {
  if (map == null || tabId == null) return EMPTY_STATE;
  return map[tabId] ?? EMPTY_STATE;
}

/**
 * State sync for the side panel.
 *
 * Two hard-won reliability rules drive this design:
 *
 *  1. The panel does NOT figure out its own tab via chrome.tabs.query — that
 *     query is racy when issued from a just-opened side panel and often returns
 *     the wrong tab (or none), which left the panel bound to a tab with no state
 *     and stuck on the empty placeholder. Instead the service worker — which
 *     knows exactly which tab the panel was opened for — hands the tab id back in
 *     the panelReady reply.
 *
 *  2. The panel does NOT rely on the worker pushing state via runtime.sendMessage
 *     (those broadcasts get dropped). chrome.storage.session is the single source
 *     of truth; the panel reads it and subscribes to chrome.storage.onChanged.
 *
 * Tab switches come from the chrome.tabs.onActivated event's own tabId (reliable,
 * unlike a re-query). Visibility regain re-reads storage. Every path converges to
 * the latest stored state.
 */
export function useChromeMessages() {
  const [panelState, setPanelState] = useState<PanelState>(EMPTY_STATE);
  const [tabId, setTabId] = useState<number | null>(null);
  const [readwise, setReadwise] = useState<ReadwiseState>(EMPTY_READWISE);

  // The tab/window the panel is currently showing — kept in refs so the
  // once-registered listeners always see the latest values.
  const tabIdRef = useRef<number | null>(null);
  const windowIdRef = useRef<number | null>(null);

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

  useEffect(() => {
    let cancelled = false;

    // Render a state for the current tab, running phase-driven side effects.
    const applyState = (state: PanelState) => {
      if (cancelled) return;
      setPanelState(state);
      if (state.phase === "empty" || state.phase === "summary") {
        resetRetryState();
      }
    };

    // Point the panel at a tab and render its state. Resets per-tab UI (retry
    // counter, readwise) only when the tab actually changes.
    const showTab = (
      nextTabId: number | null,
      nextWindowId: number | null,
      state: PanelState
    ) => {
      if (cancelled) return;
      if (nextWindowId != null) windowIdRef.current = nextWindowId;
      if (nextTabId !== tabIdRef.current) {
        tabIdRef.current = nextTabId;
        setTabId(nextTabId);
        resetRetryState();
        setReadwise(EMPTY_READWISE);
      }
      applyState(state);
    };

    // Re-read the current tab's stored state and render it (no tab change).
    const reread = async () => {
      if (tabIdRef.current == null) return;
      const { tabStates } = await chrome.storage.session.get("tabStates");
      if (cancelled) return;
      applyState(readTabState(tabStates, tabIdRef.current));
    };

    // Bind to a (possibly new) tab and render its stored state.
    const loadTab = async (nextTabId: number) => {
      const { tabStates } = await chrome.storage.session.get("tabStates");
      if (cancelled) return;
      showTab(nextTabId, null, readTabState(tabStates, nextTabId));
    };

    // Live state update: the worker rewrote the tabStates map. The event carries
    // the full new map, so just re-index our tab — no re-read needed.
    const onStorageChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== "session" || !changes.tabStates) return;
      if (tabIdRef.current == null) return;
      const map = changes.tabStates.newValue as
        | Record<string, PanelState>
        | undefined;
      applyState(readTabState(map, tabIdRef.current));
    };

    // Tab switched in our window — rebind using the event's own tab id.
    const onTabActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      if (
        windowIdRef.current != null &&
        activeInfo.windowId !== windowIdRef.current
      ) {
        return;
      }
      void loadTab(activeInfo.tabId);
    };

    // The panel's JS is throttled while hidden, so it can miss change events.
    // Reconcile from storage whenever it becomes visible again.
    const onVisibility = () => {
      if (document.visibilityState === "visible") void reread();
    };

    // Readwise results come back as direct replies to a panel-initiated request
    // while the panel is visible — reliable, unlike background-pushed state.
    const onMessage = (message: { action: string; [key: string]: unknown }) => {
      switch (message.action) {
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
        case "readwiseTagsError":
          setReadwise((prev) => ({
            ...prev,
            saveStatus: "error",
            error: message.error as string,
          }));
          break;
      }
    };

    chrome.storage.onChanged.addListener(onStorageChanged);
    chrome.tabs.onActivated.addListener(onTabActivated);
    document.addEventListener("visibilitychange", onVisibility);
    chrome.runtime.onMessage.addListener(onMessage);

    // Authoritative initial bind: ask the worker which tab the panel owns and
    // its current state (it also auto-starts summarization if the tab is empty).
    chrome.runtime.sendMessage(
      { action: "panelReady" },
      (response?: PanelReadyResponse) => {
        if (chrome.runtime.lastError || !response || cancelled) return;
        showTab(
          response.tabId ?? null,
          response.windowId ?? null,
          response.state ?? EMPTY_STATE
        );
      }
    );

    return () => {
      cancelled = true;
      clearRetryTimeout();
      chrome.storage.onChanged.removeListener(onStorageChanged);
      chrome.tabs.onActivated.removeListener(onTabActivated);
      document.removeEventListener("visibilitychange", onVisibility);
      chrome.runtime.onMessage.removeListener(onMessage);
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
    setReadwise(EMPTY_READWISE);
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
