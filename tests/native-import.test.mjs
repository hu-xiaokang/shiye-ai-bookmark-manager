import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { randomUUID } from "node:crypto";

function event() { return { addListener() {} }; }

function storageArea(store) {
  return {
    async get(keys) {
      if (keys == null) return { ...store };
      if (typeof keys === "string") return { [keys]: store[keys] };
      const result = {};
      for (const key of keys) result[key] = store[key];
      return result;
    },
    async set(values) { Object.assign(store, structuredClone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; }
  };
}

test("native bookmark import deduplicates URLs, links IDs, and creates a safety snapshot", async () => {
  const localStore = {
    bookmarks: [{
      id: "existing", title: "Existing", url: "http://www.example.com/page?utm_source=test",
      category: "稍后阅读", tags: [], summary: "", nativeBookmarkIds: ["old"]
    }],
    settings: { categories: ["稍后阅读"] }, recycleBin: [], modelUsage: {}
  };
  const sessionStore = {};
  const chrome = {
    storage: { local: storageArea(localStore), session: storageArea(sessionStore), onChanged: event() },
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), async sendMessage() {} },
    contextMenus: { create() {}, async update() {}, onClicked: event() },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async openPopup() {} },
    tabs: { async query() { return []; }, async get() { return null; }, onActivated: event(), onUpdated: event(), onRemoved: event() },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: event() },
    idle: { setDetectionInterval() {}, onStateChanged: event() },
    bookmarks: { async search() { return []; }, onCreated: event(), onChanged: event(), onRemoved: event() },
    alarms: { async create() {}, async clear() {}, onAlarm: event() },
    scripting: { async executeScript() { return [{ result: "" }]; } },
    i18n: { getUILanguage() { return "en-US"; } }
  };
  const context = {
    chrome, URL, AbortController, structuredClone, crypto: { randomUUID }, console, setTimeout, clearTimeout,
    importScripts() {},
    fetch: async () => { throw new Error("fetch should not run for import-only mode"); }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL("../model-utils.js", import.meta.url), "utf8"), context);
  vm.runInContext(fs.readFileSync(new URL("../app-utils.js", import.meta.url), "utf8"), context);
  vm.runInContext(fs.readFileSync(new URL("../ai-client.js", import.meta.url), "utf8"), context);
  vm.runInContext(fs.readFileSync(new URL("../page-content.js", import.meta.url), "utf8"), context);
  vm.runInContext(fs.readFileSync(new URL("../background.js", import.meta.url), "utf8"), context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(context.PageContent.isPublicPageUrl("http://127.0.0.1/admin"), false);
  assert.equal(context.PageContent.isPublicPageUrl("https://192.168.1.10/private"), false);
  assert.equal(context.PageContent.isPublicPageUrl("https://example.com/public"), true);
  assert.match(context.PageContent.htmlToPlainText("<html><script>ignore()</script><main>Useful &amp; safe</main></html>"), /Useful & safe/);
  assert.equal(context.evaluateClassificationConfidence({ confidence: 0.95, tags: ["x"], summary: "x" }, { source: "title-url", content: "" }, true).score, 0.5);

  const response = await context.runNativeBookmarkImport([
    { title: "Existing copy", url: "https://example.com/page", nativeBookmarkIds: ["10", "11"], folderPath: "Work" },
    { title: "Docs", url: "https://docs.example.com", nativeBookmarkIds: ["20"], folderPath: "Learning" },
    { title: "Docs duplicate", url: "https://www.docs.example.com/", nativeBookmarkIds: ["21"], folderPath: "Other" }
  ], false);

  assert.equal(response.success, true);
  assert.equal(localStore.bookmarks.length, 2);
  const existing = localStore.bookmarks.find(item => item.id === "existing");
  assert.deepEqual([...existing.nativeBookmarkIds].sort(), ["10", "11", "old"]);
  const imported = localStore.bookmarks.find(item => item.id !== "existing");
  assert.deepEqual([...imported.nativeBookmarkIds].sort(), ["20", "21"]);
  assert.equal(localStore.nativeBookmarkImportJob.status, "completed");
  assert.equal(localStore.nativeBookmarkImportJob.imported, 1);
  assert.equal(localStore.nativeBookmarkImportJob.linked, 1);
  assert.equal(localStore.lastSafetyBackup.reason, "before-native-bookmark-import");
  assert.equal(localStore.lastSafetyBackup.bookmarks.length, 1);

  localStore.settings = {
    categories: ["稍后阅读"], apiUrl: "https://model.example/v1", apiKey: "test-key", model: "test-model", language: "en"
  };
  let modelRequest = null;
  let modelCallCount = 0;
  let modelConfidence = 0.45;
  let modelSummary = "Technical documentation.";
  context.fetch = async (url, options = {}) => {
    if (String(url).startsWith("https://api.example.com")) {
      return {
        ok: true, status: 200, headers: { get: () => "text/html; charset=utf-8" },
        async text() { return "<html><main>Reference content for the public API.</main></html>"; }
      };
    }
    modelCallCount += 1;
    modelRequest = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: JSON.stringify({ category: "稍后阅读", tags: ["documentation"], summary: modelSummary, confidence: modelConfidence, confidenceReason: "Content was limited." }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        };
      }
    };
  };
  const aiResponse = await context.runNativeBookmarkImport([
    { title: "API Reference", url: "https://api.example.com/reference", nativeBookmarkIds: ["30"], folderPath: "Development" }
  ], true);

  assert.equal(aiResponse.success, true);
  assert.equal(localStore.nativeBookmarkImportJob.status, "completed");
  assert.equal(localStore.nativeBookmarkImportJob.succeeded, 1);
  const organized = localStore.bookmarks.find(item => item.url === "https://api.example.com/reference");
  assert.equal(organized.summary, "Technical documentation.");
  assert.deepEqual(organized.tags, ["documentation"]);
  assert.equal(organized.aiConfidence, 0.45);
  assert.equal(organized.aiConfidenceLevel, "low");
  assert.equal(organized.aiContentSource, "public-fetch");
  assert.equal(localStore.modelUsage.requests, 1);
  assert.match(modelRequest.messages[1].content, /Reference content for the public API/);

  modelConfidence = 0.92;
  modelSummary = "Improved summary from the opened page.";
  chrome.tabs.query = async () => [{ id: 7, active: true, status: "complete", url: organized.url }];
  chrome.scripting.executeScript = async () => [{ result: "Detailed opened page content. ".repeat(100) }];
  const reprocess = await context.maybeReclassifyLowConfidence({ id: 7, active: true, status: "complete", url: organized.url });
  assert.equal(reprocess.triggered, true);
  const reviewed = localStore.bookmarks.find(item => item.id === organized.id);
  assert.equal(reviewed.summary, modelSummary);
  assert.equal(reviewed.aiContentSource, "open-tab");
  assert.equal(reviewed.aiConfidenceLevel, "high");
  assert.equal(reviewed.confidenceReprocessCount, 1);
  const repeated = await context.maybeReclassifyLowConfidence({ id: 7, active: true, status: "complete", url: organized.url });
  assert.equal(repeated.triggered, false);

  const openedContent = "Detailed opened page content. ".repeat(100);
  reviewed.aiConfidence = 0.4;
  reviewed.aiConfidenceLevel = "low";
  reviewed.aiContentSource = "public-fetch";
  reviewed.aiContentLength = openedContent.length;
  reviewed.aiContentFingerprint = context.ModelText.fingerprint(openedContent);
  reviewed.confidenceReprocessCount = 0;
  reviewed.confidenceReprocessPending = false;
  const callsBeforeSkip = modelCallCount;
  const noNewContent = await context.maybeReclassifyLowConfidence({ id: 7, active: true, status: "complete", url: organized.url });
  assert.equal(noNewContent.triggered, false);
  assert.equal(modelCallCount, callsBeforeSkip);
});
