import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("options requires a separate Gateway key and preserves existing Readwise settings", () => {
  const elements: Record<string, any> = {
    gatewayApiKey: { value: "" }, readwiseToken: { value: "" },
    enableReadwise: { checked: false }, status: { style: {} },
    save: { addEventListener: (_event: string, callback: () => void) => { save = callback; } },
  };
  const stored: Record<string, unknown> = {
    apiKey: "legacy-anthropic-key", readwiseToken: "readwise-token", enableReadwise: true,
  };
  let ready = () => {};
  let save = () => {};
  runInNewContext(readFileSync(new URL("../options.js", import.meta.url), "utf8"), {
    document: {
      getElementById: (id: string) => elements[id],
      addEventListener: (_event: string, callback: () => void) => { ready = callback; },
    },
    chrome: { storage: { sync: {
      get: (defaults: object, callback: (items: object) => void) => callback({ ...defaults, ...stored }),
      set: (values: object, callback: () => void) => { Object.assign(stored, values); callback(); },
    } } },
    setTimeout: () => {},
  });
  ready();
  expect(elements.gatewayApiKey.value).toBe("");
  expect(elements.readwiseToken.value).toBe("readwise-token");
  expect(elements.enableReadwise.checked).toBe(true);
  elements.gatewayApiKey.value = "  gateway-key  ";
  save();
  expect(stored).toEqual({
    apiKey: "legacy-anthropic-key", gatewayApiKey: "gateway-key",
    readwiseToken: "readwise-token", enableReadwise: true,
  });
  elements.gatewayApiKey.value = "";
  ready();
  expect(elements.gatewayApiKey.value).toBe("gateway-key");
});

test("options exports the diagnostic report as JSON and clears it through the worker", async () => {
  const callbacks: Record<string, () => Promise<void>> = {};
  const elements: Record<string, any> = {
    save: { addEventListener() {} }, diagnosticsCount: {}, diagnosticsStatus: { style: {} },
    exportDiagnostics: { addEventListener: (_event: string, callback: () => Promise<void>) => { callbacks.export = callback; } },
    clearDiagnostics: { addEventListener: (_event: string, callback: () => Promise<void>) => { callbacks.clear = callback; } },
  };
  const report = { schemaVersion: 1, records: [{ requestId: "request-1", responseText: "malformed JSON" }] };
  let downloadedBlob: Blob | undefined;
  const link = { href: "", download: "", click() { clicked = true; } };
  let clicked = false;
  const messages: string[] = [];
  runInNewContext(readFileSync(new URL("../options.js", import.meta.url), "utf8"), {
    document: { getElementById: (id: string) => elements[id], addEventListener() {}, createElement: () => link },
    chrome: { runtime: { sendMessage: async (message: { action: string }) => {
      messages.push(message.action);
      if (message.action === "clearSummaryDiagnostics") { report.records = []; return { ok: true }; }
      return { ok: true, report };
    } } },
    Blob, URL: { createObjectURL: (blob: Blob) => { downloadedBlob = blob; return "blob:test"; }, revokeObjectURL() {} },
    setTimeout() {},
  });
  await callbacks.export?.();
  expect(clicked).toBe(true);
  expect(link.download).toMatch(/^page-summarizer-diagnostics-.*\.json$/);
  expect(JSON.parse(await downloadedBlob!.text())).toEqual(report);
  expect(elements.diagnosticsStatus.textContent).toContain("exported");
  await callbacks.clear?.();
  expect(messages).toEqual(["getSummaryDiagnostics", "clearSummaryDiagnostics", "getSummaryDiagnostics"]);
  expect(elements.diagnosticsCount.textContent).toContain("0 saved events");
  expect(elements.diagnosticsStatus.textContent).toBe("Saved diagnostics cleared.");
});
