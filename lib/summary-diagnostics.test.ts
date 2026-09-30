import { test, expect } from "bun:test";
import {
  createDiagnosticRecord, createDiagnosticsStore, DIAGNOSTICS_STORAGE_KEY,
  MAX_DIAGNOSTIC_BYTES, MAX_DIAGNOSTIC_RECORDS, MAX_RESPONSE_CHARACTERS,
} from "./summary-diagnostics";

const context = { requestId: "request-1", tabId: 7, extensionVersion: "1.15.0", model: "test-model" };

function memoryStorage() {
  const values: Record<string, unknown> = { otherSetting: "keep" };
  let accessLevel: string | undefined;
  return {
    values,
    get accessLevel() { return accessLevel; },
    async setAccessLevel(options: { accessLevel: "TRUSTED_CONTEXTS" }) { accessLevel = options.accessLevel; },
    async get(key: string) { await Promise.resolve(); return { [key]: structuredClone(values[key]) }; },
    async set(update: Record<string, unknown>) { Object.assign(values, structuredClone(update)); },
    async remove(key: string) { delete values[key]; },
  };
}

test("diagnostics redact credentials and exclude request bodies, headers, and URL secrets", () => {
  const record = createDiagnosticRecord({ ...context, pageUrl: "https://user:password@example.com/article?token=url-secret#private" }, {
    event: "attempt-failed", responseText: 'Gateway: saved-gateway; Readwise: saved-readwise; Bearer other-secret; api_key="another-secret".',
    error: Object.assign(new Error("saved-gateway failed"), {
      statusCode: 401, cause: new Error("saved-readwise failed"),
      requestBodyValues: { prompt: "PRIVATE_SOURCE_TEXT" }, responseHeaders: { authorization: "SECRET_HEADER" },
    }),
  }, ["saved-gateway", "saved-readwise"]);
  const json = JSON.stringify(record);
  for (const secret of ["saved-gateway", "saved-readwise", "other-secret", "another-secret", "url-secret", "password", "PRIVATE_SOURCE_TEXT", "SECRET_HEADER"]) {
    expect(json).not.toContain(secret);
  }
  expect(record.pageUrl).toBe("https://example.com/article");
  expect(record.error?.statusCode).toBe(401);
  expect(record.error?.cause?.message).toBe("<REDACTED> failed");
  expect(record.responseText).toContain("<REDACTED>");
});

test("oversized responses preserve the beginning and end and declare truncation", () => {
  const text = "START" + "x".repeat(50_000) + "END";
  const record = createDiagnosticRecord(context, { event: "attempt-failed", responseText: text });
  expect(record.responseText?.length).toBe(MAX_RESPONSE_CHARACTERS);
  expect(record.responseText?.startsWith("START")).toBe(true);
  expect(record.responseText?.endsWith("END")).toBe(true);
  expect(record.responseTextTruncated).toBe(true);
  expect(record.responseCharacters).toBe(text.length);
});

test("diagnostics survive a worker restart and export only the selected request", async () => {
  const storage = memoryStorage();
  const store = createDiagnosticsStore(storage);
  await store.record(context, { event: "attempt-started", attempt: 1 });
  await store.record({ ...context, requestId: "request-2" }, { event: "attempt-failed", attempt: 1, responseText: "malformed JSON" });
  const restarted = createDiagnosticsStore(storage);
  const report = await restarted.read("1.15.0", "request-2");
  expect(storage.accessLevel).toBe("TRUSTED_CONTEXTS");
  expect(report.schemaVersion).toBe(1);
  expect(report.records).toHaveLength(1);
  expect(report.records[0]?.responseText).toBe("malformed JSON");
  expect((await restarted.read("1.15.0")).records).toHaveLength(2);
});

test("concurrent tab writes are serialized and evict the oldest events by count", async () => {
  const storage = memoryStorage();
  const store = createDiagnosticsStore(storage);
  await Promise.all(Array.from({ length: 65 }, (_, i) => store.record({ ...context, requestId: `request-${i}` }, { event: "attempt-started" })));
  const records = (await store.read("1.15.0")).records;
  expect(records).toHaveLength(MAX_DIAGNOSTIC_RECORDS);
  expect(records[0]?.requestId).toBe("request-15");
  expect(records.at(-1)?.requestId).toBe("request-64");
});

test("retention uses UTF-8 byte size as well as event count", async () => {
  const storage = memoryStorage();
  const store = createDiagnosticsStore(storage);
  await Promise.all(Array.from({ length: 40 }, (_, i) => store.record({ ...context, requestId: `request-${i}` }, {
    event: "attempt-failed", responseText: "漢".repeat(MAX_RESPONSE_CHARACTERS),
  })));
  const records = (await store.read("1.15.0")).records;
  expect(records.length).toBeLessThan(40);
  expect(new TextEncoder().encode(JSON.stringify(records)).byteLength).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES);
  expect(records.at(-1)?.requestId).toBe("request-39");
});

test("clear is ordered with writes and leaves unrelated storage intact", async () => {
  const storage = memoryStorage();
  const store = createDiagnosticsStore(storage);
  const before = store.record(context, { event: "attempt-started" });
  const clear = store.clear();
  await Promise.all([before, clear]);
  expect(storage.values[DIAGNOSTICS_STORAGE_KEY]).toBeUndefined();
  expect(storage.values.otherSetting).toBe("keep");
  expect((await store.read("1.15.0")).records).toHaveLength(0);
  await store.record(context, { event: "attempt-started" });
  expect((await store.read("1.15.0")).records).toHaveLength(1);
});
