importScripts("model-utils.js", "app-utils.js", "ai-client.js", "page-content.js", "bookmark-model.js");

const { canonicalUrl, parseModelJson } = AppUtils;
const { extractPageContext } = PageContent;

const DEFAULT_CATEGORY = BookmarkModel.UNCLASSIFIED_CATEGORY;
const ACTIVE_SESSIONS_KEY = "activeBrowsingSessions";
const METRICS_KEY = "browsingMetrics";
const PENDING_DELETIONS_KEY = "pendingNativeDeletions";
const MODEL_USAGE_KEY = "modelUsage";
const RECYCLE_BIN_KEY = "recycleBin";
const NATIVE_IMPORT_JOB_KEY = "nativeBookmarkImportJob";
const READ_LATER_EXPIRY_ALARM = "read-later-expiry";
const MIN_SESSION_MS = 3_000;
const MAX_SESSION_MS = 4 * 60 * 60 * 1_000;
let bookmarkSyncQueue = Promise.resolve();
let modelUsageQueue = Promise.resolve();
let nativeImportRunning = false;
const confidenceReprocessQueue = new Set();

async function clearExpiredReadLaterMarkers(now = Date.now()) {
  const data = await chrome.storage.local.get("bookmarks");
  let changed = false;
  const bookmarks = (data.bookmarks || []).map(bookmark => {
    const expiresAt = BookmarkModel.expiryTime(bookmark.readLaterUntil);
    if (!bookmark.readLater || expiresAt == null || expiresAt > now) return bookmark;
    changed = true;
    return { ...bookmark, readLater: false, readLaterUntil: null, updatedAt: new Date(now).toISOString() };
  });
  if (changed) await chrome.storage.local.set({ bookmarks });
  return changed;
}

async function ensureReadLaterExpiryAlarm() {
  await chrome.alarms.create(READ_LATER_EXPIRY_ALARM, { periodInMinutes: 1 });
  await clearExpiredReadLaterMarkers();
}

function useEnglish(settings = {}) {
  if (settings.language === "en") return true;
  if (settings.language === "zh-CN") return false;
  return chrome.i18n.getUILanguage().toLowerCase().startsWith("en");
}

function contextMenuTitle(settings = {}) {
  return useEnglish(settings) ? "Save to ShiYe" : "收藏到「拾页」";
}

async function syncContextMenuLanguage(settings) {
  if (!settings) settings = (await chrome.storage.local.get("settings")).settings || {};
  try { await chrome.contextMenus.update("save-to-shiye", { title: contextMenuTitle(settings) }); } catch {}
}

function enqueueBookmarkSync(task) {
  bookmarkSyncQueue = bookmarkSyncQueue.then(task, task).catch(() => {});
  return bookmarkSyncQueue;
}

function emptyUsageBucket() {
  return { requests: 0, successful: 0, failed: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedInputTokensSaved: 0 };
}

function normalizeTokenUsage(usage = {}) {
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? 0) || 0;
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens) || 0;
  return { inputTokens, outputTokens, totalTokens };
}

function usageDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addUsage(bucket, tokens, success, estimatedSaved = 0) {
  for (const key of ["requests", "successful", "failed", "inputTokens", "outputTokens", "totalTokens", "estimatedInputTokensSaved"]) {
    bucket[key] = Number(bucket[key]) || 0;
  }
  bucket.requests += 1;
  bucket.successful += success ? 1 : 0;
  bucket.failed += success ? 0 : 1;
  bucket.inputTokens += tokens.inputTokens;
  bucket.outputTokens += tokens.outputTokens;
  bucket.totalTokens += tokens.totalTokens;
  bucket.estimatedInputTokensSaved += estimatedSaved;
}

function recordModelUsage(entry = {}) {
  modelUsageQueue = modelUsageQueue.then(async () => {
    const data = await chrome.storage.local.get(MODEL_USAGE_KEY);
    const stats = data[MODEL_USAGE_KEY] || {
      ...emptyUsageBucket(), byFeature: {}, byModel: {}, daily: {}, lastUsedAt: null
    };
    const feature = ["auto_classification", "classification", "summary", "connection_test"].includes(entry.feature)
      ? entry.feature : "other";
    const model = String(entry.model || "未指定模型").slice(0, 100);
    const success = entry.success !== false;
    const tokens = normalizeTokenUsage(entry.usage);
    const estimatedSaved = Math.max(0, Number(entry.optimization?.originalTokens || 0) - Number(entry.optimization?.sentTokens || 0));
    const dayKey = usageDateKey();
    stats.byFeature ||= {};
    stats.byModel ||= {};
    stats.daily ||= {};
    stats.byFeature[feature] ||= emptyUsageBucket();
    stats.byModel[model] ||= emptyUsageBucket();
    stats.daily[dayKey] ||= emptyUsageBucket();
    addUsage(stats, tokens, success, estimatedSaved);
    addUsage(stats.byFeature[feature], tokens, success, estimatedSaved);
    addUsage(stats.byModel[model], tokens, success, estimatedSaved);
    addUsage(stats.daily[dayKey], tokens, success, estimatedSaved);
    stats.lastUsedAt = new Date().toISOString();

    const dailyKeys = Object.keys(stats.daily).sort().reverse();
    for (const oldKey of dailyKeys.slice(90)) delete stats.daily[oldKey];
    await chrome.storage.local.set({ [MODEL_USAGE_KEY]: stats });
  }).catch(() => {});
  return modelUsageQueue;
}

function isTrackableUrl(url = "") {
  return /^https?:/i.test(url);
}

function evaluateClassificationConfidence(result = {}, pageContext = {}, categoryRecognized = true) {
  const contentLength = String(pageContext.content || "").length;
  const confidence = AiClient.calculateConfidence({
    modelConfidence: result.confidence,
    source: pageContext.source || "title-url",
    contentLength,
    categoryRecognized,
    hasSummary: Boolean(String(result.summary || "").trim()),
    hasTags: Array.isArray(result.tags) && result.tags.length > 0
  });
  return {
    score: confidence.score, level: confidence.level,
    reason: String(result.confidenceReason || "").trim().slice(0, 240),
    source: pageContext.source || "title-url"
  };
}

async function autoClassifyBookmark(pluginBookmarkId, settings, force = false, trigger = "auto", providedPageContext = null) {
  const english = useEnglish(settings);
  if ((!force && settings?.autoClassifyOnSave === false) || !settings?.apiUrl || !settings?.apiKey || !settings?.model) {
    await updateBookmarkAiState(pluginBookmarkId, "idle", english ? (!force && settings?.autoClassifyOnSave === false ? "Automatic processing is disabled" : "Configure a model first") : (!force && settings?.autoClassifyOnSave === false ? "自动整理已关闭" : "请先配置模型"));
    return { success: false, error: english ? "Model not configured or automatic processing disabled" : "模型未配置或自动整理已关闭" };
  }
  const data = await chrome.storage.local.get("bookmarks");
  const bookmark = (data.bookmarks || []).find(item => item.id === pluginBookmarkId);
  if (!bookmark) return { success: false, error: english ? "Bookmark not found" : "收藏不存在" };
  await updateBookmarkAiState(pluginBookmarkId, "processing", "");
  let usageRecorded = false;
  let inputOptimization = null;
  try {
    const categories = BookmarkModel.normalizeCategories(settings.categories);
    const pageContext = providedPageContext || await extractPageContext(bookmark.url);
    const compactedContent = ModelText.compactPageContent(pageContext.content, 2600);
    const pageContent = compactedContent.text;
    const compactTitle = ModelText.compactField(bookmark.title, 400);
    const compactUrl = ModelText.compactField(bookmark.url, 1200);
    inputOptimization = { originalTokens: compactedContent.originalTokens, sentTokens: compactedContent.estimatedTokens };
    const requestBody = AiClient.buildRequest({
      model: settings.model,
      maxOutputTokens: 320,
      messages: AiClient.classificationMessages({
        english,
        candidateText: categories.join(english ? ", " : "、"),
        title: compactTitle,
        url: compactUrl,
        pageContent
      })
    });
    const response = await AiClient.request({ apiUrl: settings.apiUrl, apiKey: settings.apiKey, body: requestBody });
    if (!response.ok) {
      usageRecorded = true;
      await recordModelUsage({ feature: "auto_classification", model: settings.model, success: false, optimization: inputOptimization });
      const message = english ? `Model request failed (${response.status})` : `模型请求失败（${response.status}）`;
      await updateBookmarkAiState(pluginBookmarkId, "failed", message, true);
      return { success: false, error: message };
    }
    const payload = response.data;
    usageRecorded = true;
    await recordModelUsage({ feature: "auto_classification", model: settings.model, success: true, usage: payload.usage, optimization: inputOptimization });
    const result = parseModelJson(response.content);
    if (!result) throw new Error(english ? "Could not parse the model response" : "模型返回内容无法识别");

    const latest = await chrome.storage.local.get("bookmarks");
    const bookmarks = latest.bookmarks || [];
    const target = bookmarks.find(item => item.id === pluginBookmarkId);
    if (!target) return;
    const categoryRecognized = categories.includes(result.category);
    const confidence = evaluateClassificationConfidence(result, pageContext, categoryRecognized);
    target.category = categoryRecognized ? result.category : DEFAULT_CATEGORY;
    target.tags = Array.isArray(result.tags) ? result.tags.slice(0, 4).map(String) : [];
    target.summary = String(result.summary || "").trim();
    target.aiStatus = "completed";
    target.aiError = "";
    target.aiRetryCount = Number(target.aiRetryCount || 0);
    target.aiConfidence = confidence.score;
    target.aiConfidenceLevel = confidence.level;
    target.aiConfidenceReason = confidence.reason;
    target.aiContentSource = confidence.source;
    target.aiContentLength = String(pageContext.content || "").length;
    target.aiContentFingerprint = ModelText.fingerprint(pageContext.content || "");
    target.aiInputEstimatedTokens = compactedContent.estimatedTokens;
    target.aiInputOriginalEstimatedTokens = compactedContent.originalTokens;
    target.aiConfidenceAssessedAt = new Date().toISOString();
    target.confidenceReprocessPending = false;
    if (trigger === "confidence-reprocess") target.confidenceReprocessedAt = new Date().toISOString();
    target.autoClassifiedAt = new Date().toISOString();
    target.updatedAt = target.autoClassifiedAt;
    await chrome.storage.local.set({ bookmarks });
    return { success: true, confidence };
  } catch (error) {
    if (!usageRecorded) await recordModelUsage({ feature: "auto_classification", model: settings.model, success: false, optimization: inputOptimization });
    const message = String(error?.message || (english ? "AI processing failed" : "AI 整理失败")).slice(0, 160);
    await updateBookmarkAiState(pluginBookmarkId, "failed", message, true);
    return { success: false, error: message };
  }
}

async function updateBookmarkAiState(bookmarkId, status, error = "", increaseRetry = false) {
  const data = await chrome.storage.local.get("bookmarks");
  const bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  const bookmark = bookmarks.find(item => item.id === bookmarkId);
  if (!bookmark) return;
  bookmark.aiStatus = status;
  bookmark.aiError = error;
  if (increaseRetry) bookmark.aiRetryCount = Number(bookmark.aiRetryCount || 0) + 1;
  if (status === "failed") bookmark.confidenceReprocessPending = false;
  bookmark.aiUpdatedAt = new Date().toISOString();
  if (status === "failed" && increaseRetry && bookmark.aiRetryCount <= 2) {
    const delayInMinutes = bookmark.aiRetryCount === 1 ? 1 : 5;
    bookmark.aiNextRetryAt = Date.now() + delayInMinutes * 60_000;
    await chrome.alarms.create(`ai-retry:${bookmarkId}`, { delayInMinutes });
  } else if (status === "completed" || status === "processing") {
    bookmark.aiNextRetryAt = null;
  }
  await chrome.storage.local.set({ bookmarks });
}

async function resetBookmarkAiRetries(bookmarkId) {
  await chrome.alarms.clear(`ai-retry:${bookmarkId}`);
  const data = await chrome.storage.local.get("bookmarks");
  const bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  const bookmark = bookmarks.find(item => item.id === bookmarkId);
  if (!bookmark) return;
  bookmark.aiRetryCount = 0;
  bookmark.aiNextRetryAt = null;
  await chrome.storage.local.set({ bookmarks });
}

async function maybeReclassifyLowConfidence(tab) {
  if (!tab?.id || !tab.active || tab.status !== "complete" || !isTrackableUrl(tab.url)) return { triggered: false };
  const data = await chrome.storage.local.get(["bookmarks", "settings"]);
  const settings = data.settings || {};
  if ((settings.autoReclassifyLowConfidenceOnOpen ?? true) === false) return { triggered: false };
  if (!settings.apiUrl || !settings.apiKey || !settings.model) return { triggered: false };
  const threshold = Math.max(0.4, Math.min(0.8, Number(settings.lowConfidenceThreshold ?? 0.6)));
  const bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  const bookmark = bookmarks.find(item => canonicalUrl(item.url) === canonicalUrl(tab.url));
  if (!bookmark || !Number.isFinite(Number(bookmark.aiConfidence))) return { triggered: false };
  const alreadyHasRenderedContent = bookmark.aiContentSource === "open-tab" && Number(bookmark.aiContentLength || 0) >= 250;
  if (Number(bookmark.aiConfidence) >= threshold || alreadyHasRenderedContent) return { triggered: false };
  if (bookmark.confidenceReprocessPending || Number(bookmark.confidenceReprocessCount || 0) >= 1) return { triggered: false };
  if (["pending", "processing"].includes(bookmark.aiStatus) || confidenceReprocessQueue.has(bookmark.id)) return { triggered: false };

  confidenceReprocessQueue.add(bookmark.id);
  try {
    const pageContext = await extractPageContext(bookmark.url, { renderWaitMs: 900, minimumLength: 250 });
    if (pageContext.source !== "open-tab" || String(pageContext.content || "").length < 250) return { triggered: false };
    const nextFingerprint = ModelText.fingerprint(pageContext.content);
    const previousLength = Number(bookmark.aiContentLength || 0);
    const materiallyRicher = bookmark.aiContentSource === "title-url"
      || String(pageContext.content).length >= Math.max(300, previousLength * 1.1)
      || (nextFingerprint !== bookmark.aiContentFingerprint && String(pageContext.content).length >= 500);
    if (!materiallyRicher) return { triggered: false };
    bookmark.confidenceReprocessPending = true;
    bookmark.confidenceReprocessCount = Number(bookmark.confidenceReprocessCount || 0) + 1;
    bookmark.confidenceReprocessTriggeredAt = new Date().toISOString();
    await chrome.storage.local.set({ bookmarks });
    const result = await autoClassifyBookmark(bookmark.id, settings, true, "confidence-reprocess", pageContext);
    return { triggered: true, success: Boolean(result?.success), result };
  } finally {
    confidenceReprocessQueue.delete(bookmark.id);
  }
}

function scheduleConfidenceReview(tab, delays) {
  if (!tab?.id || !isTrackableUrl(tab.url)) return;
  for (const delay of delays) {
    setTimeout(async () => {
      try {
        const currentTab = await chrome.tabs.get(tab.id);
        if (canonicalUrl(currentTab.url) !== canonicalUrl(tab.url)) return;
        await maybeReclassifyLowConfidence(currentTab);
      } catch {}
    }, delay);
  }
}

async function syncNativeBookmark(id, node) {
  if (!isTrackableUrl(node?.url)) return;
  const { bookmarks = [], settings = {} } = await chrome.storage.local.get(["bookmarks", "settings"]);
  const normalized = canonicalUrl(node.url);
  const existing = bookmarks.find(item =>
    item.nativeBookmarkIds?.includes(id) || canonicalUrl(item.url) === normalized
  );
  let createdBookmark = null;

  if (existing) {
    existing.nativeBookmarkIds = [...new Set([...(existing.nativeBookmarkIds || []), id])];
    existing.nativeBookmarkId = id;
    existing.updatedAt = new Date().toISOString();
  } else {
    createdBookmark = {
      id: crypto.randomUUID(),
      title: node.title || node.url,
      url: node.url,
      category: DEFAULT_CATEGORY,
      tags: [],
      summary: "",
      aiStatus: settings.autoClassifyOnSave !== false && settings.apiUrl && settings.apiKey && settings.model ? "pending" : "idle",
      aiError: "",
      source: "chrome-bookmark",
      nativeBookmarkId: id,
      nativeBookmarkIds: [id],
      createdAt: new Date().toISOString()
    };
    bookmarks.unshift(createdBookmark);
  }
  await chrome.storage.local.set({ bookmarks });
  if (createdBookmark) await autoClassifyBookmark(createdBookmark.id, settings);
}

function flattenRemovedBookmarks(node, fallbackId) {
  const result = [];
  const visit = (item, id) => {
    if (isTrackableUrl(item?.url)) result.push({ id: item.id || id, title: item.title || item.url, url: item.url });
    for (const child of item?.children || []) visit(child, child.id);
  };
  visit(node, fallbackId);
  return result;
}

async function queueNativeBookmarkDeletions(removedNodes) {
  if (!removedNodes.length) return;
  const data = await chrome.storage.local.get(["bookmarks", PENDING_DELETIONS_KEY, "settings", RECYCLE_BIN_KEY]);
  const bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  const pending = Array.isArray(data[PENDING_DELETIONS_KEY]) ? data[PENDING_DELETIONS_KEY] : [];
  const recycleBin = Array.isArray(data[RECYCLE_BIN_KEY]) ? data[RECYCLE_BIN_KEY] : [];
  const autoDeleteWithNative = data.settings?.autoDeleteWithNative ?? true;

  for (const removed of removedNodes) {
    const normalized = canonicalUrl(removed.url);
    const pluginBookmark = bookmarks.find(item =>
      item.nativeBookmarkIds?.includes(removed.id) || item.nativeBookmarkId === removed.id || canonicalUrl(item.url) === normalized
    );
    if (!pluginBookmark) continue;

    let remainingNative = [];
    try { remainingNative = await chrome.bookmarks.search({ url: removed.url }); } catch {}
    pluginBookmark.nativeBookmarkIds = remainingNative.filter(item => item.url).map(item => item.id);
    pluginBookmark.nativeBookmarkId = pluginBookmark.nativeBookmarkIds[0] || null;
    if (pluginBookmark.nativeBookmarkIds.length) continue;

    if (autoDeleteWithNative) {
      const index = bookmarks.findIndex(item => item.id === pluginBookmark.id);
      if (index >= 0) {
        recycleBin.unshift({ id: crypto.randomUUID(), bookmark: { ...bookmarks[index] }, deletedAt: Date.now(), reason: "native-bookmark" });
        bookmarks.splice(index, 1);
      }
      const pendingIndex = pending.findIndex(item => item.pluginBookmarkId === pluginBookmark.id);
      if (pendingIndex >= 0) pending.splice(pendingIndex, 1);
      continue;
    }

    const alreadyPending = pending.some(item => item.pluginBookmarkId === pluginBookmark.id);
    if (!alreadyPending) {
      pending.push({
        id: crypto.randomUUID(),
        pluginBookmarkId: pluginBookmark.id,
        nativeBookmarkId: removed.id,
        title: pluginBookmark.title || removed.title,
        url: pluginBookmark.url || removed.url,
        removedAt: Date.now()
      });
    }
  }

  await chrome.storage.local.set({ bookmarks, [PENDING_DELETIONS_KEY]: pending, [RECYCLE_BIN_KEY]: recycleBin });
  if (!pending.length) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: "#F59E0B" });
  await chrome.action.setBadgeText({ text: pending.length > 9 ? "9+" : String(pending.length) });
  try { await chrome.runtime.sendMessage({ type: "native-bookmark-deleted" }); } catch {}
  try { await chrome.action.openPopup(); } catch {}
}

async function refreshPendingDeletionBadge() {
  const data = await chrome.storage.local.get(PENDING_DELETIONS_KEY);
  const pending = Array.isArray(data[PENDING_DELETIONS_KEY]) ? data[PENDING_DELETIONS_KEY] : [];
  await chrome.action.setBadgeBackgroundColor({ color: "#F59E0B" });
  await chrome.action.setBadgeText({ text: pending.length ? (pending.length > 9 ? "9+" : String(pending.length)) : "" });
}

async function finishSession(windowId, endedAt = Date.now()) {
  const data = await chrome.storage.session.get(ACTIVE_SESSIONS_KEY);
  const sessions = data[ACTIVE_SESSIONS_KEY] || {};
  const session = sessions[windowId];
  if (!session) return;
  delete sessions[windowId];
  await chrome.storage.session.set({ [ACTIVE_SESSIONS_KEY]: sessions });

  const duration = Math.min(endedAt - session.startedAt, MAX_SESSION_MS);
  if (!isTrackableUrl(session.url) || duration < MIN_SESSION_MS) return;
  const local = await chrome.storage.local.get(METRICS_KEY);
  const metrics = local[METRICS_KEY] || {};
  const current = metrics[session.url] || { durationMs: 0, activeSessions: 0, lastActiveAt: 0 };
  metrics[session.url] = {
    durationMs: current.durationMs + duration,
    activeSessions: current.activeSessions + 1,
    lastActiveAt: endedAt
  };

  const entries = Object.entries(metrics);
  if (entries.length > 1200) {
    entries.sort((a, b) => (b[1].lastActiveAt || 0) - (a[1].lastActiveAt || 0));
    for (const [url] of entries.slice(1000)) delete metrics[url];
  }
  await chrome.storage.local.set({ [METRICS_KEY]: metrics });
}

async function startSession(tab) {
  if (!tab?.active || !isTrackableUrl(tab.url)) return;
  await finishSession(tab.windowId);
  const data = await chrome.storage.session.get(ACTIVE_SESSIONS_KEY);
  const sessions = data[ACTIVE_SESSIONS_KEY] || {};
  sessions[tab.windowId] = { tabId: tab.id, url: tab.url, startedAt: Date.now() };
  await chrome.storage.session.set({ [ACTIVE_SESSIONS_KEY]: sessions });
}

async function finishAllSessions() {
  const data = await chrome.storage.session.get(ACTIVE_SESSIONS_KEY);
  const sessions = data[ACTIVE_SESSIONS_KEY] || {};
  for (const windowId of Object.keys(sessions)) await finishSession(windowId);
}

async function startFocusedTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) await startSession(tab);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("settings").then(data => chrome.contextMenus.create({
    id: "save-to-shiye", title: contextMenuTitle(data.settings || {}), contexts: ["page", "link"]
  }));
  startFocusedTab();
  purgeRecycleBin().catch(() => {});
  ensureReadLaterExpiryAlarm().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  startFocusedTab();
  refreshPendingDeletionBadge();
  purgeRecycleBin().catch(() => {});
  syncContextMenuLanguage().catch(() => {});
  ensureReadLaterExpiryAlarm().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) syncContextMenuLanguage(changes.settings.newValue || {}).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "record-model-usage") {
    recordModelUsage(message.payload || {});
    return;
  }
  if (message?.type === "retry-ai-bookmark") {
    chrome.storage.local.get("settings")
      .then(async data => {
        await resetBookmarkAiRetries(message.bookmarkId);
        return autoClassifyBookmark(message.bookmarkId, data.settings || {}, true);
      })
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message || "AI 整理失败" }));
    return true;
  }
  if (message?.type === "retry-all-ai") {
    retryAllAiTasks().then(sendResponse).catch(error => sendResponse({ success: false, error: error.message || "批量处理失败" }));
    return true;
  }
  if (message?.type === "import-native-bookmarks") {
    runNativeBookmarkImport(message.entries || [], Boolean(message.organizeWithAI))
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message || "Chrome 书签整理失败" }));
    return true;
  }
  if (message?.type === "cancel-native-bookmark-import") {
    chrome.storage.local.get(NATIVE_IMPORT_JOB_KEY).then(data => {
      const job = data[NATIVE_IMPORT_JOB_KEY];
      if (job && ["importing", "organizing"].includes(job.status)) {
        job.cancelRequested = true;
        if (!nativeImportRunning) {
          job.status = "cancelled";
          job.completedAt = new Date().toISOString();
        }
        job.updatedAt = new Date().toISOString();
        return chrome.storage.local.set({ [NATIVE_IMPORT_JOB_KEY]: job });
      }
    }).then(() => sendResponse({ success: true })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === READ_LATER_EXPIRY_ALARM) {
    clearExpiredReadLaterMarkers().catch(() => {});
    return;
  }
  if (!alarm.name.startsWith("ai-retry:")) return;
  const bookmarkId = alarm.name.slice("ai-retry:".length);
  chrome.storage.local.get("settings").then(data => autoClassifyBookmark(bookmarkId, data.settings || {}, true)).catch(() => {});
});

ensureReadLaterExpiryAlarm().catch(() => {});

async function retryAllAiTasks() {
  const data = await chrome.storage.local.get(["bookmarks", "settings"]);
  const candidates = (data.bookmarks || []).filter(item => ["failed", "pending"].includes(item.aiStatus) || !item.summary);
  let completed = 0;
  for (const bookmark of candidates) {
    const result = await autoClassifyBookmark(bookmark.id, data.settings || {}, true);
    if (result?.success) completed += 1;
  }
  return { success: true, total: candidates.length, completed };
}

async function updateNativeImportJob(patch) {
  const data = await chrome.storage.local.get(NATIVE_IMPORT_JOB_KEY);
  const current = data[NATIVE_IMPORT_JOB_KEY] || {};
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [NATIVE_IMPORT_JOB_KEY]: next });
  return next;
}

async function runNativeBookmarkImport(rawEntries, organizeWithAI) {
  if (nativeImportRunning) return { success: false, error: "已有 Chrome 书签整理任务正在运行" };
  nativeImportRunning = true;
  const jobId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  try {
    const grouped = new Map();
    for (const entry of Array.isArray(rawEntries) ? rawEntries.slice(0, 20_000) : []) {
      if (!isTrackableUrl(entry?.url)) continue;
      const key = canonicalUrl(entry.url);
      const current = grouped.get(key) || {
        title: String(entry.title || entry.url).slice(0, 500), url: entry.url,
        nativeBookmarkIds: [], sourceFolders: []
      };
      current.nativeBookmarkIds.push(...(Array.isArray(entry.nativeBookmarkIds) ? entry.nativeBookmarkIds : [entry.nativeBookmarkId]).filter(Boolean).map(String));
      if (entry.folderPath) current.sourceFolders.push(String(entry.folderPath).slice(0, 500));
      grouped.set(key, current);
    }
    const entries = [...grouped.values()].map(entry => ({
      ...entry,
      nativeBookmarkIds: [...new Set(entry.nativeBookmarkIds)],
      sourceFolders: [...new Set(entry.sourceFolders)]
    }));
    const nativeCount = entries.reduce((sum, entry) => sum + entry.nativeBookmarkIds.length, 0);
    const data = await chrome.storage.local.get(["bookmarks", "settings", "modelUsage", RECYCLE_BIN_KEY, NATIVE_IMPORT_JOB_KEY]);
    const previousJob = data[NATIVE_IMPORT_JOB_KEY];
    if (previousJob && ["importing", "organizing"].includes(previousJob.status)) {
      const age = Date.now() - new Date(previousJob.updatedAt || previousJob.startedAt || 0).getTime();
      if (Number.isFinite(age) && age < 10 * 60_000) return { success: false, error: "已有 Chrome 书签整理任务正在运行" };
    }
    const settings = data.settings || {};
    if (organizeWithAI && (!settings.apiUrl || !settings.apiKey || !settings.model)) {
      return { success: false, error: useEnglish(settings) ? "Configure the model before AI organization" : "请先完成模型配置再进行 AI 整理" };
    }
    const bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
    await chrome.storage.local.set({
      lastSafetyBackup: {
        version: 2, reason: "before-native-bookmark-import", createdAt: startedAt,
        bookmarks: structuredClone(bookmarks), settings: data.settings || {},
        recycleBin: data[RECYCLE_BIN_KEY] || [], modelUsage: data.modelUsage || {}
      },
      [NATIVE_IMPORT_JOB_KEY]: {
        id: jobId, status: "importing", organizeWithAI, totalNative: nativeCount,
        uniqueUrls: entries.length, duplicates: Math.max(0, nativeCount - entries.length),
        imported: 0, linked: 0, total: 0, processed: 0, succeeded: 0, failed: 0,
        cancelRequested: false, startedAt, updatedAt: startedAt
      }
    });

    const byUrl = new Map(bookmarks.map(bookmark => [canonicalUrl(bookmark.url), bookmark]));
    const candidates = [];
    let imported = 0;
    let linked = 0;
    for (const entry of entries) {
      const key = canonicalUrl(entry.url);
      const existing = byUrl.get(key);
      if (existing) {
        existing.nativeBookmarkIds = [...new Set([...(existing.nativeBookmarkIds || []), ...entry.nativeBookmarkIds])];
        existing.nativeBookmarkId = existing.nativeBookmarkIds[0] || existing.nativeBookmarkId || null;
        existing.sourceFolders = [...new Set([...(existing.sourceFolders || []), ...entry.sourceFolders])];
        existing.updatedAt = new Date().toISOString();
        linked += 1;
        if (organizeWithAI && (!existing.summary || !(existing.tags || []).length)) candidates.push(existing.id);
        continue;
      }
      const created = {
        id: crypto.randomUUID(), title: entry.title || entry.url, url: entry.url,
        category: DEFAULT_CATEGORY, tags: [], summary: "",
        aiStatus: organizeWithAI ? "pending" : "idle", aiError: "",
        source: "chrome-bookmark-import", sourceFolders: entry.sourceFolders,
        nativeBookmarkId: entry.nativeBookmarkIds[0] || null,
        nativeBookmarkIds: entry.nativeBookmarkIds,
        createdAt: new Date().toISOString()
      };
      bookmarks.unshift(created);
      byUrl.set(key, created);
      imported += 1;
      if (organizeWithAI) candidates.push(created.id);
    }
    await chrome.storage.local.set({ bookmarks });
    let job = await updateNativeImportJob({
      status: organizeWithAI && candidates.length ? "organizing" : "completed",
      imported, linked, total: candidates.length,
      completedAt: organizeWithAI && candidates.length ? null : new Date().toISOString()
    });
    if (!organizeWithAI || !candidates.length) return { success: true, job };

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    for (const bookmarkId of candidates) {
      job = (await chrome.storage.local.get(NATIVE_IMPORT_JOB_KEY))[NATIVE_IMPORT_JOB_KEY] || job;
      if (job.cancelRequested) {
        job = await updateNativeImportJob({ status: "cancelled", processed, succeeded, failed, completedAt: new Date().toISOString() });
        return { success: true, cancelled: true, job };
      }
      const latest = await chrome.storage.local.get("bookmarks");
      const target = (latest.bookmarks || []).find(item => item.id === bookmarkId);
      await updateNativeImportJob({ currentTitle: target?.title || target?.url || "", processed, succeeded, failed });
      const result = await autoClassifyBookmark(bookmarkId, settings, true);
      processed += 1;
      if (result?.success) succeeded += 1;
      else failed += 1;
      await updateNativeImportJob({ processed, succeeded, failed });
    }
    job = await updateNativeImportJob({ status: "completed", currentTitle: "", processed, succeeded, failed, completedAt: new Date().toISOString() });
    return { success: true, job };
  } catch (error) {
    await updateNativeImportJob({ status: "failed", error: String(error?.message || error), completedAt: new Date().toISOString() }).catch(() => {});
    return { success: false, error: String(error?.message || error) };
  } finally {
    nativeImportRunning = false;
  }
}

async function purgeRecycleBin() {
  const data = await chrome.storage.local.get(RECYCLE_BIN_KEY);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recycleBin = (Array.isArray(data[RECYCLE_BIN_KEY]) ? data[RECYCLE_BIN_KEY] : [])
    .filter(item => item.bookmark && Number(item.deletedAt || 0) >= cutoff);
  await chrome.storage.local.set({ [RECYCLE_BIN_KEY]: recycleBin });
}

async function cleanupLegacyAdData() {
  const data = await chrome.storage.local.get(["settings", "lastSafetyBackup"]);
  const settings = { ...(data.settings || {}) };
  const hadLegacySettings = Object.hasOwn(settings, "enableAds") || Object.hasOwn(settings, "adFeedUrl");
  delete settings.enableAds;
  delete settings.adFeedUrl;
  const lastSafetyBackup = data.lastSafetyBackup ? { ...data.lastSafetyBackup } : null;
  if (lastSafetyBackup) {
    lastSafetyBackup.settings = { ...(lastSafetyBackup.settings || {}) };
    delete lastSafetyBackup.settings.enableAds;
    delete lastSafetyBackup.settings.adFeedUrl;
    delete lastSafetyBackup.adMetrics;
  }
  if (hadLegacySettings || lastSafetyBackup) await chrome.storage.local.set({ settings, ...(lastSafetyBackup ? { lastSafetyBackup } : {}) });
  await chrome.storage.local.remove(["adCache", "adMetrics"]);
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await startSession(tab);
    if (tab.status === "complete") scheduleConfidenceReview(tab, [500, 3000]);
  } catch {}
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "complete")) await startSession(tab);
  if (tab.active && changeInfo.status === "complete") scheduleConfidenceReview(tab, [700, 3500, 8000]);
});

chrome.tabs.onRemoved.addListener(async (tabId, { windowId }) => {
  const data = await chrome.storage.session.get(ACTIVE_SESSIONS_KEY);
  if (data[ACTIVE_SESSIONS_KEY]?.[windowId]?.tabId === tabId) await finishSession(windowId);
});

chrome.windows.onFocusChanged.addListener(async windowId => {
  await finishAllSessions();
  if (windowId !== chrome.windows.WINDOW_ID_NONE) await startFocusedTab();
});

chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener(async state => {
  if (state === "active") await startFocusedTab();
  else await finishAllSessions();
});

chrome.bookmarks.onCreated.addListener((id, node) => {
  enqueueBookmarkSync(() => syncNativeBookmark(id, node));
});

chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
  enqueueBookmarkSync(async () => {
    try {
      const [node] = await chrome.bookmarks.get(id);
      if (!isTrackableUrl(node?.url)) return;
      const { bookmarks = [] } = await chrome.storage.local.get("bookmarks");
      const existing = bookmarks.find(item =>
        item.nativeBookmarkIds?.includes(id) || item.nativeBookmarkId === id
      );
      if (!existing) return syncNativeBookmark(id, node);
      if (changeInfo.title) existing.title = changeInfo.title;
      if (changeInfo.url) existing.url = changeInfo.url;
      existing.updatedAt = new Date().toISOString();
      await chrome.storage.local.set({ bookmarks });
    } catch {}
  });
});

chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  const removed = flattenRemovedBookmarks(removeInfo.node, id);
  enqueueBookmarkSync(() => queueNativeBookmarkDeletions(removed));
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "save-to-shiye") return;
  const url = info.linkUrl || tab?.url;
  if (!url || !/^https?:/i.test(url)) return;

  const title = info.linkUrl ? info.selectionText || info.linkUrl : tab.title || url;
  const { bookmarks = [], settings = {} } = await chrome.storage.local.get(["bookmarks", "settings"]);
  const existing = bookmarks.find((item) => canonicalUrl(item.url) === canonicalUrl(url));
  let createdBookmark = null;

  if (existing) {
    existing.title = title || existing.title;
    existing.updatedAt = new Date().toISOString();
  } else {
    createdBookmark = {
      id: crypto.randomUUID(),
      title,
      url,
      category: DEFAULT_CATEGORY,
      tags: [],
      summary: "",
      aiStatus: settings.autoClassifyOnSave !== false && settings.apiUrl && settings.apiKey && settings.model ? "pending" : "idle",
      aiError: "",
      createdAt: new Date().toISOString()
    };
    bookmarks.unshift(createdBookmark);
  }

  await chrome.storage.local.set({ bookmarks });
  if (createdBookmark) await autoClassifyBookmark(createdBookmark.id, settings);
  chrome.action.setBadgeText({ text: "✓", tabId: tab.id });
  chrome.action.setBadgeBackgroundColor({ color: "#2563EB", tabId: tab.id });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 1600);
});

refreshPendingDeletionBadge().catch(() => {});
cleanupLegacyAdData().catch(() => {});
