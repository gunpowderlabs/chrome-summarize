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
