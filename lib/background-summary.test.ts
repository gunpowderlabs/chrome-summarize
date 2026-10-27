import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { summarizationConfig } from "../config";
import { createDiagnosticsStore } from "./summary-diagnostics";
import { buildSystemPrompt, classifyError, mapYouTubeSummary, normalizePartial } from "./summarize";
import { summaryToText } from "./summary-content";

test("worker stores structured partials and finals, restores both formats, and exports text to Readwise", async () => {
  const legacy = { phase: "summary", tldr: "Cached overview.", summary: "- Cached point.", tags: [], metadata: null };
  let stored: any = { tabStates: { 1: legacy } };
  const snapshots: any[] = [];
  const final = { tldr: "Overview.", bullets: ["First **point**.", "Second point."], steps: ["Try it."], applicationNote: null, tags: ["technology"] };
  let savedPayload: any;
  const listener = { addListener() {} };
  const chrome = {
    runtime: { getManifest: () => ({ version: "test" }), getURL: (path: string) => `chrome-extension://test/${path}`, onMessage: listener },
    storage: {
      local: { async setAccessLevel() {}, async get() { return {}; }, async set() {}, async remove() {} },
      session: {
        async get() { return structuredClone(stored); },
        async set(value: any) { stored = structuredClone(value); snapshots.push(stored); },
      },
      sync: { async get() { return { gatewayApiKey: "test-key", enableReadwise: true, readwiseToken: "test-token" }; } },
    },
    sidePanel: { async setOptions() {}, async setPanelBehavior() {} },
    action: { onClicked: listener }, tabs: { onRemoved: listener, onUpdated: listener },
  };
  const source = readFileSync(new URL("../background.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, "");
  const startWorker = () => runInNewContext(source + "\n({ stateRestored, tabStates, updateTabState, streamSummaryUpdate, handleSummarization, saveToReadwise });", {
    chrome, crypto, console, summarizationConfig, createDiagnosticsStore, buildSystemPrompt, classifyError, mapYouTubeSummary,
    summarizePage: async ({ onPartial }: any) => {
      onPartial(normalizePartial({ tldr: "Overview.", bullets: ["First **po"] }));
      return { summary: final, model: "test-model", costUsd: 0.001 };
    },
    fetch: async (url: string, init?: RequestInit) => {
      if (url.endsWith("prompt.txt")) return new Response("Summarize.");
      if (url.includes("/tags/")) return Response.json({ results: [] });
      savedPayload = JSON.parse(init?.body as string);
      return Response.json({ id: "saved" });
    },
  });
  const worker = startWorker();
  await worker.stateRestored;
  expect(worker.tabStates.get(1)).toEqual(legacy);
  worker.updateTabState(7, { requestId: "request", url: "https://example.com/article" });
  await worker.handleSummarization(7, "Page text.", "request");
  const partial = snapshots.map((s) => s.tabStates[7]).find((s) => s?.streaming);
  expect(partial.summary).toEqual({ bullets: ["First **po"], steps: [], applicationNote: null });
  const expectedContent = { bullets: final.bullets, steps: final.steps, applicationNote: null };
  expect(stored.tabStates[7].summary).toEqual(expectedContent);
  expect(stored.tabStates[7].streaming).toBe(false);
  expect(worker.streamSummaryUpdate(7, "stale-request", normalizePartial({}))).toBe(false);

  const restarted = startWorker();
  await restarted.stateRestored;
  expect(restarted.tabStates.get(7).summary).toEqual(expectedContent);
  expect(restarted.tabStates.get(1)).toEqual(legacy);
  await restarted.saveToReadwise("https://example.com/article", "Article", summaryToText(expectedContent), final.tags);
  expect(savedPayload.summary).toBe("- First point.\n- Second point.\n\nApply this to your life\n\n1. Try it.");
  expect(savedPayload.tags).toEqual(final.tags);
});
