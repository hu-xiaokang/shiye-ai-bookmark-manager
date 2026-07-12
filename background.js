const DEFAULT_CATEGORY = "稍后阅读";
const ACTIVE_SESSIONS_KEY = "activeBrowsingSessions";
const METRICS_KEY = "browsingMetrics";
const PENDING_DELETIONS_KEY = "pendingNativeDeletions";
const MODEL_USAGE_KEY = "modelUsage";
const RECYCLE_BIN_KEY = "recycleBin";
const MIN_SESSION_MS = 3_000;
const MAX_SESSION_MS = 4 * 60 * 60 * 1_000;
let bookmarkSyncQueue = Promise.resolve();
let modelUsageQueue = Promise.resolve();

function enqueueBookmarkSync(task) {
  bookmarkSyncQueue = bookmarkSyncQueue.then(task, task).catch(() => {});
  return bookmarkSyncQueue;
}

function emptyUsageBucket() {
  return { requests: 0, successful: 0, failed: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
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

function addUsage(bucket, tokens, success) {
  for (const key of ["requests", "successful", "failed", "inputTokens", "outputTokens", "totalTokens"]) {
    bucket[key] = Number(bucket[key]) || 0;
  }
  bucket.requests += 1;
  bucket.successful += success ? 1 : 0;
  bucket.failed += success ? 0 : 1;
  bucket.inputTokens += tokens.inputTokens;
  bucket.outputTokens += tokens.outputTokens;
  bucket.totalTokens += tokens.totalTokens;
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
    const dayKey = usageDateKey();
    stats.byFeature ||= {};
    stats.byModel ||= {};
    stats.daily ||= {};
    stats.byFeature[feature] ||= emptyUsageBucket();
    stats.byModel[model] ||= emptyUsageBucket();
    stats.daily[dayKey] ||= emptyUsageBucket();
    addUsage(stats, tokens, success);
    addUsage(stats.byFeature[feature], tokens, success);
    addUsage(stats.byModel[model], tokens, success);
    addUsage(stats.daily[dayKey], tokens, success);
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

function canonicalUrl(value = "") {
  try {
    const url = new URL(value);
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.port = "";
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    const tracking = /^(utm_[a-z]+|fbclid|gclid|yclid|mc_[a-z]+|ref|referrer|source)$/i;
    [...url.searchParams.keys()].forEach(key => { if (tracking.test(key)) url.searchParams.delete(key); });
    url.searchParams.sort();
    return url.toString();
  } catch {
    return String(value).replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function normalizeEndpoint(value = "") {
  const clean = value.trim().replace(/\/$/, "");
  if (/\/chat\/completions$/i.test(clean)) return clean;
  if (/\/v1$/i.test(clean)) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
}

function parseModelJson(content = "") {
  const cleaned = String(content).replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

async function extractOpenPageContent(url) {
  try {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(item => item.id && canonicalUrl(item.url) === canonicalUrl(url));
    if (!tab) return "";
    const [{ result = "" } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const meta = document.querySelector('meta[name="description"], meta[property="og:description"]')?.content || "";
        const source = document.querySelector("article, main, [role='main']") || document.body;
        if (!source) return meta;
        const copy = source.cloneNode(true);
        copy.querySelectorAll("script, style, noscript, svg, canvas, iframe, nav, header, footer, aside, form, button").forEach(node => node.remove());
        const text = (copy.innerText || copy.textContent || "").replace(/\s+/g, " ").trim();
        return [meta, text].filter(Boolean).join("\n").slice(0, 10000);
      }
    });
    return result;
  } catch {
    return "";
  }
}

async function autoClassifyBookmark(pluginBookmarkId, settings, force = false) {
  if ((!force && settings?.autoClassifyOnSave === false) || !settings?.apiUrl || !settings?.apiKey || !settings?.model) {
    await updateBookmarkAiState(pluginBookmarkId, "idle", !force && settings?.autoClassifyOnSave === false ? "自动整理已关闭" : "请先配置模型");
    return { success: false, error: "模型未配置或自动整理已关闭" };
  }
  const data = await chrome.storage.local.get("bookmarks");
  const bookmark = (data.bookmarks || []).find(item => item.id === pluginBookmarkId);
  if (!bookmark) return { success: false, error: "收藏不存在" };
  await updateBookmarkAiState(pluginBookmarkId, "processing", "");
  let usageRecorded = false;
  try {
    const categories = settings.categories?.length ? settings.categories : [DEFAULT_CATEGORY];
    const pageContent = await extractOpenPageContent(bookmark.url);
    const response = await fetch(normalizeEndpoint(settings.apiUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: `你是网址收藏整理助手。请从候选分类中选择一项，并生成2-4个简短中文标签和60-120字中文摘要。只返回JSON：{"category":"分类","tags":["标签"],"summary":"摘要"}。候选分类：${categories.join("、")}` },
          { role: "user", content: `标题：${bookmark.title}\n网址：${bookmark.url}\n网页正文：\n${pageContent || "正文暂时无法读取，请根据标题和网址判断。"}` }
        ]
      })
    });
    if (!response.ok) {
      usageRecorded = true;
      await recordModelUsage({ feature: "auto_classification", model: settings.model, success: false });
      const message = `模型请求失败（${response.status}）`;
      await updateBookmarkAiState(pluginBookmarkId, "failed", message, true);
      return { success: false, error: message };
    }
    const payload = await response.json();
    usageRecorded = true;
    await recordModelUsage({ feature: "auto_classification", model: settings.model, success: true, usage: payload.usage });
    const result = parseModelJson(payload.choices?.[0]?.message?.content);
    if (!result) throw new Error("模型返回内容无法识别");

    const latest = await chrome.storage.local.get("bookmarks");
    const bookmarks = latest.bookmarks || [];
    const target = bookmarks.find(item => item.id === pluginBookmarkId);
    if (!target) return;
    target.category = categories.includes(result.category) ? result.category : DEFAULT_CATEGORY;
    target.tags = Array.isArray(result.tags) ? result.tags.slice(0, 4).map(String) : [];
    target.summary = String(result.summary || "").trim();
    target.aiStatus = "completed";
    target.aiError = "";
    target.aiRetryCount = Number(target.aiRetryCount || 0);
    target.autoClassifiedAt = new Date().toISOString();
    target.updatedAt = target.autoClassifiedAt;
    await chrome.storage.local.set({ bookmarks });
    return { success: true };
  } catch (error) {
    if (!usageRecorded) await recordModelUsage({ feature: "auto_classification", model: settings.model, success: false });
    const message = String(error?.message || "AI 整理失败").slice(0, 160);
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
  chrome.contextMenus.create({
    id: "save-to-shiye",
    title: "收藏到「拾页」",
    contexts: ["page", "link"]
  });
  startFocusedTab();
  purgeRecycleBin().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  startFocusedTab();
  refreshPendingDeletionBadge();
  purgeRecycleBin().catch(() => {});
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
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm.name.startsWith("ai-retry:")) return;
  const bookmarkId = alarm.name.slice("ai-retry:".length);
  chrome.storage.local.get("settings").then(data => autoClassifyBookmark(bookmarkId, data.settings || {}, true)).catch(() => {});
});

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
  try { await startSession(await chrome.tabs.get(tabId)); } catch {}
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "complete")) await startSession(tab);
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
