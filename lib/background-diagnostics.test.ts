import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createDiagnosticsStore, DIAGNOSTICS_STORAGE_KEY } from "./summary-diagnostics";
import { summarizationConfig } from "../config";
import { buildSystemPrompt, classifyError, mapYouTubeSummary } from "./summarize";

test("worker records sanitized failures and permits diagnostics export/clear only from extension pages", async () => {
  const local: Record<string, unknown> = { otherSetting: "keep" };
  let onMessage: any;
  const listener = { addListener() {} };
  const fakeKey = "fake-gateway-credential";
  const fakeToken = "fake-readwise-credential";
  const origin = "chrome-extension://test/";
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "1.15.0" }), getURL: (path: string) => origin + path,
      onMessage: { addListener: (callback: unknown) => { onMessage = callback; } },
    },
    storage: {
      local: {
        async setAccessLevel() {},
        async get(key: string) { return { [key]: structuredClone(local[key]) }; },
        async set(values: object) { Object.assign(local, structuredClone(values)); },
        async remove(key: string) { delete local[key]; },
      },
      session: { async get() { return {}; }, async set() {} },
      sync: { async get() { return { gatewayApiKey: fakeKey, readwiseToken: fakeToken }; } },
    },
    sidePanel: { async setOptions() {}, async setPanelBehavior() {} },
    action: { onClicked: listener }, tabs: { onRemoved: listener, onUpdated: listener },
  };
  // Run the actual worker source with its imports injected and browser APIs mocked.
  const source = readFileSync(new URL("../background.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, "");
  const worker = runInNewContext(source + "\n({ updateTabState, handleSummarization });", {
    chrome, crypto, console: { warn() {}, error() {} },
    summarizationConfig, createDiagnosticsStore, buildSystemPrompt, classifyError, mapYouTubeSummary,
    fetch: async () => new Response("Summarize."),
    summarizePage: async (options: any) => {
      await options.onDiagnostic({ event: "attempt-started", attempt: 1 });
      const error = new Error(`Provider failed: ${fakeKey}; ${fakeToken}`);
      await options.onDiagnostic({ event: "attempt-failed", attempt: 1, error, responseText: `invalid JSON ${fakeKey}`, willRetry: false });
      throw error;
    },
  });
  worker.updateTabState(7, { requestId: "request-1", diagnosticsRequestId: "request-1", url: "https://example.com/article?secret=hidden" });
  await worker.handleSummarization(7, "PRIVATE_SOURCE_TEXT", "request-1");
  const message = (action: string, senderUrl: string, requestId?: string) => new Promise<any>((resolve) => {
    onMessage({ action, requestId }, { url: senderUrl }, resolve);
  });
  const exported = await message("getSummaryDiagnostics", origin + "sidepanel.html", "request-1");
  expect(exported.ok).toBe(true);
  expect(exported.report.records.map((record: any) => record.event)).toEqual(["attempt-started", "attempt-failed", "request-failed"]);
  const json = JSON.stringify(exported.report);
  for (const secret of [fakeKey, fakeToken, "PRIVATE_SOURCE_TEXT", "secret=hidden"]) expect(json).not.toContain(secret);
  expect(json).toContain("<REDACTED>");
  const blocked = await message("getSummaryDiagnostics", "https://example.com/article");
  expect(blocked.ok).toBe(false);
  expect(blocked.report).toBeUndefined();
  expect((await message("clearSummaryDiagnostics", "https://example.com/article")).ok).toBe(false);
  expect(local[DIAGNOSTICS_STORAGE_KEY]).toBeDefined();
  expect((await message("clearSummaryDiagnostics", origin + "options.html")).ok).toBe(true);
  expect(local[DIAGNOSTICS_STORAGE_KEY]).toBeUndefined();
  expect(local.otherSetting).toBe("keep");
});
