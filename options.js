const DEFAULT_CATEGORIES = ["稍后阅读", "工作效率", "技术开发", "设计灵感", "学习资料", "生活兴趣", "新闻资讯", "工具服务"];
const { canonicalUrl, escapeHtml } = AppUtils;
let settings = {};
let usageStats = {};
let bookmarksCache = [];
let recycleBinCache = [];
let pendingImport = null;
let nativeBookmarkScan = null;
let nativeImportJob = null;
const $ = id => document.getElementById(id);
const t = (source, params) => I18n.t(source, params);
const locale = () => I18n.language === "en" ? "en-US" : "zh-CN";
const categoryLabel = category => t(category);
const l = (zh, en) => I18n.language === "en" ? en : zh;

async function init() {
  const data = await chrome.storage.local.get(["settings", "modelUsage", "bookmarks", "recycleBin", "lastSafetyBackup", "nativeBookmarkImportJob"]);
  settings = sanitizeSettings(data.settings || {});
  await I18n.init(settings);
  usageStats = data.modelUsage || {};
  bookmarksCache = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  recycleBinCache = Array.isArray(data.recycleBin) ? data.recycleBin : [];
  $("apiUrl").value = settings.apiUrl || "https://api.openai.com/v1";
  $("apiKey").value = settings.apiKey || "";
  $("modelName").value = settings.model || "gpt-4o-mini";
  settings.categories = settings.categories || [...DEFAULT_CATEGORIES];
  const storedColors = settings.categoryColorVersion === CategoryColors.VERSION ? settings.categoryColors || {} : {};
  const colorResult = CategoryColors.ensure(settings.categories, storedColors);
  settings.categoryColors = colorResult.colors;
  settings.categoryColorVersion = CategoryColors.VERSION;
  if (colorResult.changed || data.settings?.categoryColorVersion !== CategoryColors.VERSION) await chrome.storage.local.set({ settings });
  settings.autoClassifyOnSave = settings.autoClassifyOnSave ?? true;
  settings.autoDeleteWithNative = settings.autoDeleteWithNative ?? true;
  settings.autoReclassifyLowConfidenceOnOpen = settings.autoReclassifyLowConfidenceOnOpen ?? true;
  settings.lowConfidenceThreshold = Number(settings.lowConfidenceThreshold ?? 0.6);
  settings.language = settings.language || "auto";
  $("languageSelect").value = settings.language;
  $("autoClassifyOnSave").checked = settings.autoClassifyOnSave;
  $("autoDeleteWithNative").checked = settings.autoDeleteWithNative;
  $("autoReclassifyLowConfidenceOnOpen").checked = settings.autoReclassifyLowConfidenceOnOpen;
  $("lowConfidenceThreshold").value = String(settings.lowConfidenceThreshold);
  renderCategories();
  renderUsage();
  renderAiQueue();
  nativeImportJob = data.nativeBookmarkImportJob || null;
  renderNativeImportJob();
  $("restoreBackupBtn").disabled = !data.lastSafetyBackup;
}

function readForm() {
  return {
    ...sanitizeSettings(settings),
    apiUrl: $("apiUrl").value.trim(), apiKey: $("apiKey").value.trim(), model: $("modelName").value.trim(),
    categories: settings.categories,
    autoClassifyOnSave: $("autoClassifyOnSave").checked,
    autoDeleteWithNative: $("autoDeleteWithNative").checked,
    autoReclassifyLowConfidenceOnOpen: $("autoReclassifyLowConfidenceOnOpen").checked,
    lowConfidenceThreshold: Number($("lowConfidenceThreshold").value),
    language: $("languageSelect").value
  };
}

async function persistBehavior() {
  settings = readForm();
  await chrome.storage.local.set({ settings });
  toast(t("默认行为已更新"));
}

async function saveSettings() {
  const next = readForm();
  if (!next.apiUrl || !next.apiKey || !next.model) return toast(t("请完整填写模型配置"));
  settings = next;
  await chrome.storage.local.set({ settings });
  toast(t("配置已保存"));
}

async function testConnection() {
  const next = readForm();
  const result = $("testResult");
  result.className = "result";
  result.textContent = t("正在连接模型…");
  $("testBtn").disabled = true;
  let usageRecorded = false;
  let requestStarted = false;
  try {
    if (!next.apiUrl || !next.apiKey || !next.model) throw new Error(t("请先完整填写模型配置"));
    requestStarted = true;
    const body = AiClient.buildRequest({
        model: next.model,
        temperature: 0,
        maxOutputTokens: 8,
        messages: [{ role: "user", content: I18n.language === "en" ? "Reply only: Connected" : "只回复：连接成功" }]
    });
    const response = await AiClient.request({ apiUrl: next.apiUrl, apiKey: next.apiKey, body });
    if (!response.ok) {
      usageRecorded = true;
      await reportModelUsage("connection_test", null, false, next.model);
      throw new Error(I18n.language === "en" ? `Connection failed (HTTP ${response.status})` : `连接失败（HTTP ${response.status}）`);
    }
    const data = response.data;
    usageRecorded = true;
    await reportModelUsage("connection_test", data.usage, true, next.model);
    if (!data.choices?.[0]) throw new Error(I18n.language === "en" ? "Incompatible API response" : "接口返回格式不兼容");
    result.textContent = I18n.language === "en" ? `Connected. Model ${next.model} is available.` : `连接成功，模型 ${next.model} 可以使用。`;
  } catch (error) {
    if (requestStarted && !usageRecorded) await reportModelUsage("connection_test", null, false, next.model);
    result.classList.add("error");
    result.textContent = error.message;
  } finally { $("testBtn").disabled = false; }
}

function renderUsage() {
  const stats = usageStats || {};
  $("usageRequests").textContent = formatNumber(stats.requests || 0);
  $("usageTotalTokens").textContent = formatNumber(stats.totalTokens || 0);
  $("usageInputTokens").textContent = formatNumber(stats.inputTokens || 0);
  $("usageOutputTokens").textContent = formatNumber(stats.outputTokens || 0);
  const today = stats.daily?.[usageDateKey()] || {};
  $("usageToday").textContent = `${formatNumber(today.totalTokens || 0)} Token`;
  $("usageEstimatedSaved").textContent = `${formatNumber(stats.estimatedInputTokensSaved || 0)} Token`;
  $("usageSuccess").textContent = `${formatNumber(stats.successful || 0)} / ${formatNumber(stats.failed || 0)}`;
  $("usageLastUsed").textContent = stats.lastUsedAt ? new Date(stats.lastUsedAt).toLocaleString(locale(), { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }) : t("暂无");
  const features = [
    ["auto_classification", t("自动分类与摘要"), "auto"],
    ["classification", t("手动 AI 分类"), "classify"],
    ["summary", t("单独生成摘要"), "summary"],
    ["connection_test", t("模型连接测试"), "test"]
  ];
  $("usageFeatureList").innerHTML = features.map(([key, label, tone]) => {
    const value = stats.byFeature?.[key] || {};
    return `<div class="feature-row"><span><i class="feature-dot ${tone}"></i>${label}</span><strong>${formatNumber(value.requests || 0)} / ${formatNumber(value.totalTokens || 0)}</strong></div>`;
  }).join("");
}

function usageDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function formatNumber(value) { return Number(value || 0).toLocaleString(locale()); }

async function reportModelUsage(feature, usage, success, model) {
  try {
    await chrome.runtime.sendMessage({ type:"record-model-usage", payload:{ feature, usage, success, model } });
  } catch {}
}

async function refreshUsage() {
  const data = await chrome.storage.local.get("modelUsage");
  usageStats = data.modelUsage || {};
  renderUsage();
}

async function resetUsage() {
  if (!confirm(I18n.language === "en" ? "Clear all model usage statistics? This cannot be undone." : "确定清空全部模型用量统计吗？此操作无法撤销。")) return;
  await chrome.storage.local.remove("modelUsage");
  usageStats = {};
  renderUsage();
  toast(I18n.language === "en" ? "Model usage statistics cleared" : "模型用量统计已清空");
}

function renderCategories() {
  $("categoryList").innerHTML = settings.categories.map((category, index) => {
    const color = settings.categoryColors?.[category] || "#475569";
    return `<span class="category-chip"><i class="category-color-dot" style="${escapeHtml(CategoryColors.cssVariables(color))}"></i>${escapeHtml(categoryLabel(category))}<button data-index="${index}" title="${escapeHtml(t("删除"))}">×</button></span>`;
  }).join("");
}

function renderAiQueue() {
  const failed = bookmarksCache.filter(item => item.aiStatus === "failed").length;
  const pending = bookmarksCache.filter(item => item.aiStatus === "pending" || item.aiStatus === "processing").length;
  const incomplete = bookmarksCache.filter(item => !item.summary).length;
  const lowConfidence = bookmarksCache.filter(item => Number.isFinite(Number(item.aiConfidence)) && Number(item.aiConfidence) < Number(settings.lowConfidenceThreshold ?? 0.6)).length;
  $("aiQueueSummary").textContent = I18n.language === "en" ? `Failed ${failed} · Processing/waiting ${pending} · Missing summary ${incomplete} · Low confidence ${lowConfidence}` : `失败 ${failed} · 处理中/等待 ${pending} · 缺少摘要 ${incomplete} · 低置信度 ${lowConfidence}`;
  $("retryAllAiBtn").disabled = !bookmarksCache.some(item => item.aiStatus === "failed" || item.aiStatus === "pending" || !item.summary);
}

async function retryAllAi() {
  if (!settings.apiUrl || !settings.apiKey || !settings.model) return toast(I18n.language === "en" ? "Complete the model configuration first" : "请先完成模型配置");
  const button = $("retryAllAiBtn");
  button.disabled = true;
  button.textContent = I18n.language === "en" ? "Processing…" : "正在批量处理…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "retry-all-ai" });
    if (!result?.success) throw new Error(result?.error || (I18n.language === "en" ? "Batch processing failed" : "批量处理失败"));
    toast(I18n.language === "en" ? `Completed: ${result.completed}/${result.total}` : `处理完成：${result.completed}/${result.total}`);
  } catch (error) {
    toast(error.message || (I18n.language === "en" ? "Batch processing failed" : "批量处理失败"));
  } finally {
    button.textContent = t("重新处理失败与缺失内容");
    const data = await chrome.storage.local.get("bookmarks");
    bookmarksCache = data.bookmarks || [];
    renderAiQueue();
  }
}

function flattenNativeBookmarks(nodes, path = [], result = []) {
  for (const node of nodes || []) {
    if (node.url && /^https?:/i.test(node.url)) {
      result.push({
        nativeBookmarkId: String(node.id), title: node.title || node.url, url: node.url,
        folderPath: path.filter(Boolean).join(" / ")
      });
    }
    if (node.children?.length) {
      const nextPath = node.title ? [...path, node.title] : path;
      flattenNativeBookmarks(node.children, nextPath, result);
    }
  }
  return result;
}

async function scanNativeBookmarks() {
  const button = $("scanNativeBookmarksBtn");
  button.disabled = true;
  button.textContent = l("正在扫描…", "Scanning…");
  try {
    const tree = await chrome.bookmarks.getTree();
    const raw = flattenNativeBookmarks(tree);
    const grouped = new Map();
    for (const item of raw) {
      const key = canonicalUrl(item.url);
      const current = grouped.get(key) || {
        title: item.title || item.url, url: item.url, nativeBookmarkIds: [], folderPath: item.folderPath
      };
      current.nativeBookmarkIds.push(item.nativeBookmarkId);
      if (!current.folderPath && item.folderPath) current.folderPath = item.folderPath;
      grouped.set(key, current);
    }
    const entries = [...grouped.values()].map(item => ({ ...item, nativeBookmarkIds: [...new Set(item.nativeBookmarkIds)] }));
    const localByUrl = new Map(bookmarksCache.map(item => [canonicalUrl(item.url), item]));
    const newCount = entries.filter(item => !localByUrl.has(canonicalUrl(item.url))).length;
    const linkedCount = entries.length - newCount;
    const organizeCount = entries.filter(item => {
      const existing = localByUrl.get(canonicalUrl(item.url));
      return !existing || !existing.summary || !(existing.tags || []).length;
    }).length;
    nativeBookmarkScan = {
      entries, total: raw.length, unique: entries.length, newCount, linkedCount,
      duplicates: Math.max(0, raw.length - entries.length), organizeCount
    };
    $("nativeTotalCount").textContent = formatNumber(raw.length);
    $("nativeNewCount").textContent = formatNumber(newCount);
    $("nativeLinkedCount").textContent = formatNumber(linkedCount);
    $("nativeDuplicateCount").textContent = formatNumber(nativeBookmarkScan.duplicates);
    const modelReady = Boolean(settings.apiUrl && settings.apiKey && settings.model);
    $("nativeImportPreviewNote").textContent = I18n.language === "en"
      ? `${entries.length} unique URLs found. AI organization will make about ${organizeCount} model calls. Public page text is fetched without cookies; duplicate URLs are merged.${modelReady ? "" : " Configure and save a model to enable AI organization."}`
      : `共发现 ${entries.length} 个唯一网址。使用 AI 整理预计调用模型约 ${organizeCount} 次；公开页面会在不携带 Cookie 的情况下读取正文，重复网址会自动合并。${modelReady ? "" : " 请先配置并保存模型以启用 AI 整理。"}`;
    $("nativeImportPreview").classList.remove("hidden");
    $("nativeImportProgress").classList.add("hidden");
    $("organizeNativeBtn").disabled = organizeCount === 0 || !modelReady;
    $("importNativeOnlyBtn").disabled = entries.length === 0;
    if (!entries.length) toast(l("没有发现可导入的网页书签", "No web bookmarks found"));
  } catch (error) {
    toast(error.message || l("扫描 Chrome 书签失败", "Failed to scan Chrome bookmarks"));
  } finally {
    button.disabled = false;
    button.textContent = l("重新扫描", "Scan again");
  }
}

async function startNativeBookmarkImport(organizeWithAI) {
  if (!nativeBookmarkScan) await scanNativeBookmarks();
  if (!nativeBookmarkScan?.entries.length) return;
  if (organizeWithAI && (!settings.apiUrl || !settings.apiKey || !settings.model)) {
    toast(l("请先完成模型配置", "Complete the model configuration first"));
    return;
  }
  $("importNativeOnlyBtn").disabled = true;
  $("organizeNativeBtn").disabled = true;
  nativeImportJob = {
    status: "importing", organizeWithAI, totalNative: nativeBookmarkScan.total,
    imported: 0, linked: 0, total: nativeBookmarkScan.organizeCount, processed: 0, succeeded: 0, failed: 0
  };
  renderNativeImportJob();
  try {
    const response = await chrome.runtime.sendMessage({
      type: "import-native-bookmarks", entries: nativeBookmarkScan.entries, organizeWithAI
    });
    if (!response?.success) throw new Error(response?.error || l("Chrome 书签整理失败", "Chrome bookmark organization failed"));
    nativeImportJob = response.job || nativeImportJob;
    const data = await chrome.storage.local.get(["bookmarks", "nativeBookmarkImportJob"]);
    bookmarksCache = data.bookmarks || [];
    nativeImportJob = data.nativeBookmarkImportJob || nativeImportJob;
    renderAiQueue();
    renderNativeImportJob();
  } catch (error) {
    toast(error.message || l("Chrome 书签整理失败", "Chrome bookmark organization failed"));
    const data = await chrome.storage.local.get("nativeBookmarkImportJob");
    nativeImportJob = data.nativeBookmarkImportJob || { ...nativeImportJob, status: "failed", error: error.message };
    renderNativeImportJob();
  }
}

function renderNativeImportJob() {
  if (!nativeImportJob) return;
  const job = nativeImportJob;
  const active = ["importing", "organizing"].includes(job.status);
  const terminal = ["completed", "cancelled", "failed"].includes(job.status);
  $("nativeImportPreview").classList.add("hidden");
  $("nativeImportProgress").classList.remove("hidden");
  const total = Number(job.total || 0);
  const processed = Number(job.processed || 0);
  const percent = job.status === "completed" ? 100 : job.status === "importing" ? 4 : total ? Math.min(100, Math.round(processed / total * 100)) : 100;
  const titles = {
    importing: l("正在导入并关联 Chrome 书签", "Importing and linking Chrome bookmarks"),
    organizing: l("正在使用 AI 整理 Chrome 书签", "Organizing Chrome bookmarks with AI"),
    completed: l("Chrome 书签整理完成", "Chrome bookmark organization complete"),
    cancelled: l("任务已停止", "Task stopped"),
    failed: l("Chrome 书签整理失败", "Chrome bookmark organization failed")
  };
  $("nativeProgressTitle").textContent = titles[job.status] || titles.importing;
  $("nativeProgressCurrent").textContent = job.error || job.currentTitle || (terminal ? l("可以通过安全快照恢复操作前的数据", "Use the safety snapshot to restore data from before this operation") : "");
  $("nativeProgressPercent").textContent = `${percent}%`;
  $("nativeProgressBar").style.width = `${percent}%`;
  $("nativeProgressMeta").textContent = I18n.language === "en"
    ? `Imported ${job.imported || 0} · Linked ${job.linked || 0} · AI ${processed}/${total} · Succeeded ${job.succeeded || 0} · Failed ${job.failed || 0}`
    : `新增 ${job.imported || 0} · 关联 ${job.linked || 0} · AI 进度 ${processed}/${total} · 成功 ${job.succeeded || 0} · 失败 ${job.failed || 0}`;
  $("cancelNativeImportBtn").classList.toggle("hidden", !active);
  $("cancelNativeImportBtn").disabled = Boolean(job.cancelRequested);
  $("scanNativeBookmarksBtn").disabled = active;
  if (terminal) {
    $("scanNativeBookmarksBtn").textContent = l("重新扫描", "Scan again");
    $("scanNativeBookmarksBtn").disabled = false;
  }
}

async function cancelNativeBookmarkImport() {
  $("cancelNativeImportBtn").disabled = true;
  await chrome.runtime.sendMessage({ type: "cancel-native-bookmark-import" });
  toast(l("将在当前网址处理完成后停止", "The task will stop after the current bookmark"));
}

async function persistCategories() { await chrome.storage.local.set({ settings: readForm() }); }

async function addCategory() {
  const input = $("newCategory");
  const value = input.value.trim();
  if (!value) return;
  if (settings.categories.includes(value)) return toast("这个分类已经存在");
  settings.categories.push(value);
  settings.categoryColors = CategoryColors.ensure(settings.categories, settings.categoryColors || {}).colors;
  input.value = ""; renderCategories(); await persistCategories();
}

async function removeCategory(index) {
  if (settings.categories.length <= 1) return toast("至少保留一个分类");
  const category = settings.categories[index];
  const affected = bookmarksCache.filter(item => item.category === category);
  const affectedTrash = recycleBinCache.filter(item => item.bookmark?.category === category);
  let target = "";
  if (affected.length || affectedTrash.length) {
    const available = settings.categories.filter((_, itemIndex) => itemIndex !== index);
    const availableLabels = available.map(categoryLabel);
    const input = prompt(l(`“${category}”中有 ${affected.length} 个收藏，回收站中有 ${affectedTrash.length} 个。请输入迁移目标分类：\n${available.join("、")}`, `“${categoryLabel(category)}” contains ${affected.length} bookmarks and ${affectedTrash.length} trash items. Enter a target category:\n${availableLabels.join(", ")}`), categoryLabel(available[0] || "稍后阅读"));
    if (input === null) return;
    target = available.find(item => item === input.trim() || categoryLabel(item) === input.trim()) || "";
    if (!available.includes(target)) return toast("请输入现有的目标分类");
  }
  await createSafetySnapshot("delete-category");
  settings.categories.splice(index, 1);
  settings.categoryColors = CategoryColors.ensure(settings.categories, settings.categoryColors || {}).colors;
  if (target) bookmarksCache = bookmarksCache.map(item => item.category === category ? { ...item, category: target, updatedAt: new Date().toISOString() } : item);
  if (target) recycleBinCache = recycleBinCache.map(item => item.bookmark?.category === category ? { ...item, bookmark: { ...item.bookmark, category: target, updatedAt: new Date().toISOString() } } : item);
  await chrome.storage.local.set({ settings: readForm(), bookmarks: bookmarksCache, recycleBin: recycleBinCache });
  renderCategories();
  const migrated = affected.length + affectedTrash.length;
  toast(migrated ? l(`分类已删除，${migrated} 个收藏已迁移`, `Category deleted; ${migrated} bookmarks migrated`) : t("分类已删除"));
}

async function exportData() {
  const data = await chrome.storage.local.get(["bookmarks", "settings", "modelUsage", "recycleBin"]);
  const exportedSettings = { ...(data.settings || {}) };
  const includeApiKey = $("includeApiKey").checked;
  if (!includeApiKey) delete exportedSettings.apiKey;
  const payload = {
    format: "shiye-backup", version: 2, exportedAt: new Date().toISOString(),
    security: { includesApiKey: includeApiKey },
    bookmarks: data.bookmarks || [], recycleBin: data.recycleBin || [], settings: exportedSettings,
    modelUsage: data.modelUsage || {}
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `${I18n.language === "en" ? "shiye-backup" : "拾页备份"}-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
  toast(includeApiKey ? "备份已导出，请安全保管其中的 API Key" : "安全备份已导出（不含 API Key）");
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.bookmarks)) throw new Error("备份文件格式不正确");
    if (data.version && Number(data.version) > 2) throw new Error("备份版本高于当前插件，请升级后再导入");
    const localByUrl = new Map(bookmarksCache.map(item => [canonicalUrl(item.url), item]));
    const duplicates = data.bookmarks.filter(item => localByUrl.has(canonicalUrl(item.url))).length;
    pendingImport = { data, duplicates, fileName: file.name };
    $("importPreviewStats").innerHTML = I18n.language === "en"
      ? `<span><strong>${data.bookmarks.length}</strong> bookmarks</span><span><strong>${duplicates}</strong> duplicates</span><span><strong>${(data.recycleBin || []).length}</strong> trash items</span>`
      : `<span><strong>${data.bookmarks.length}</strong> 个收藏</span><span><strong>${duplicates}</strong> 个重复</span><span><strong>${(data.recycleBin || []).length}</strong> 个回收站项目</span>`;
    $("importPreviewNote").textContent = t(data.security?.includesApiKey || data.settings?.apiKey
      ? "此备份包含 API Key。导入后会保存到当前浏览器。"
      : "此备份不包含 API Key，将保留当前浏览器中的模型密钥。");
    $("importPreview").classList.remove("hidden");
  } catch (error) { toast(error.message || "导入失败"); }
}

async function applyImport(mode) {
  if (!pendingImport) return;
  const { data, duplicates } = pendingImport;
  await createSafetySnapshot(`before-import-${mode}`);
  let nextBookmarks;
  if (mode === "replace") {
    nextBookmarks = deduplicateBookmarks(data.bookmarks);
  } else {
    const merged = new Map(bookmarksCache.map(item => [canonicalUrl(item.url), item]));
    for (const imported of data.bookmarks) {
      if (!imported?.url) continue;
      const key = canonicalUrl(imported.url);
      const local = merged.get(key);
      merged.set(key, local ? mergeBookmarkRecords(local, imported) : imported);
    }
    nextBookmarks = [...merged.values()];
  }
  const importedSettings = sanitizeSettings(data.settings && typeof data.settings === "object" ? data.settings : {});
  const nextSettings = { ...settings, ...importedSettings, apiKey: importedSettings.apiKey || settings.apiKey || "" };
  const updates = {
    bookmarks: nextBookmarks,
    settings: nextSettings,
    recycleBin: mode === "replace" ? (data.recycleBin || []) : [...recycleBinCache, ...(data.recycleBin || [])],
    ...(data.modelUsage ? { modelUsage: data.modelUsage } : {})
  };
  await chrome.storage.local.set(updates);
  closeImportPreview();
  toast(mode === "replace" ? l(`已恢复 ${nextBookmarks.length} 个收藏`, `Restored ${nextBookmarks.length} bookmarks`) : l(`已合并导入，处理 ${duplicates} 个重复网址`, `Import merged; processed ${duplicates} duplicate URLs`));
  await init();
}

function closeImportPreview() {
  pendingImport = null;
  $("importPreview").classList.add("hidden");
  $("importInput").value = "";
}

function sanitizeSettings(value = {}) {
  const next = { ...value };
  delete next.enableAds;
  delete next.adFeedUrl;
  return next;
}

function mergeBookmarkRecords(local, imported) {
  return {
    ...imported, ...local,
    summary: (local.summary || "").length >= (imported.summary || "").length ? local.summary : imported.summary,
    tags: [...new Set([...(local.tags || []), ...(imported.tags || [])])].slice(0, 8),
    nativeBookmarkIds: [...new Set([...(local.nativeBookmarkIds || []), ...(imported.nativeBookmarkIds || [])])],
    updatedAt: new Date().toISOString()
  };
}

function deduplicateBookmarks(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.url) continue;
    const key = canonicalUrl(item.url);
    map.set(key, map.has(key) ? mergeBookmarkRecords(map.get(key), item) : item);
  }
  return [...map.values()];
}

async function createSafetySnapshot(reason) {
  const data = await chrome.storage.local.get(["bookmarks", "settings", "modelUsage", "recycleBin"]);
  await chrome.storage.local.set({ lastSafetyBackup: { version: 2, reason, createdAt: new Date().toISOString(), ...data } });
}

async function restoreSafetySnapshot() {
  const data = await chrome.storage.local.get(["lastSafetyBackup", "bookmarks", "settings", "recycleBin", "modelUsage"]);
  const snapshot = data.lastSafetyBackup;
  if (!snapshot?.bookmarks) return toast("暂无可恢复的安全快照");
  if (!confirm(l(`确定恢复 ${new Date(snapshot.createdAt).toLocaleString("zh-CN")} 的安全快照吗？`, `Restore the safety snapshot from ${new Date(snapshot.createdAt).toLocaleString("en-US")}?`))) return;
  await chrome.storage.local.set({
    bookmarks: snapshot.bookmarks || [], settings: snapshot.settings || settings,
    recycleBin: snapshot.recycleBin || [], modelUsage: snapshot.modelUsage || {},
    lastSafetyBackup: {
      version: 2, reason: "before-restore", createdAt: new Date().toISOString(),
      bookmarks: data.bookmarks || [], settings: data.settings || settings, recycleBin: data.recycleBin || [],
      modelUsage: data.modelUsage || {}
    }
  });
  toast("安全快照已恢复");
  await init();
}

async function clearBookmarksSafely() {
  if (!confirm(l("确定将所有收藏移入回收站吗？30 天内可以恢复。", "Move all bookmarks to trash? They can be restored within 30 days."))) return;
  await createSafetySnapshot("clear-bookmarks");
  const now = Date.now();
  const recycleBin = [...bookmarksCache.map(bookmark => ({ id: crypto.randomUUID(), bookmark, deletedAt: now, reason: "clear-all" })), ...recycleBinCache];
  await chrome.storage.local.set({ bookmarks: [], recycleBin });
  bookmarksCache = [];
  recycleBinCache = recycleBin;
  renderAiQueue();
  toast("所有收藏已移入回收站");
}

function toast(message) { const el=$("toast"); el.textContent=t(message); el.classList.add("show"); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),2200); }

async function changeLanguage() {
  settings = readForm();
  await chrome.storage.local.set({ settings });
  location.reload();
}

$("toggleKey").addEventListener("click", () => { const input=$("apiKey"); input.type=input.type==="password"?"text":"password"; $("toggleKey").textContent=input.type==="password"?t("显示"):t("隐藏"); });
$("languageSelect").addEventListener("change", changeLanguage);
$("saveBtn").addEventListener("click", saveSettings);
$("testBtn").addEventListener("click", testConnection);
$("autoClassifyOnSave").addEventListener("change", persistBehavior);
$("autoDeleteWithNative").addEventListener("change", persistBehavior);
$("autoReclassifyLowConfidenceOnOpen").addEventListener("change", persistBehavior);
$("lowConfidenceThreshold").addEventListener("change", persistBehavior);
$("refreshUsageBtn").addEventListener("click", refreshUsage);
$("resetUsageBtn").addEventListener("click", resetUsage);
$("retryAllAiBtn").addEventListener("click", retryAllAi);
$("scanNativeBookmarksBtn").addEventListener("click", scanNativeBookmarks);
$("importNativeOnlyBtn").addEventListener("click", () => startNativeBookmarkImport(false));
$("organizeNativeBtn").addEventListener("click", () => startNativeBookmarkImport(true));
$("cancelNativeImportBtn").addEventListener("click", cancelNativeBookmarkImport);
$("addCategory").addEventListener("click", addCategory);
$("newCategory").addEventListener("keydown", e => { if(e.key==="Enter") addCategory(); });
$("categoryList").addEventListener("click", e => { const button=e.target.closest("button[data-index]"); if(button) removeCategory(Number(button.dataset.index)); });
$("exportBtn").addEventListener("click", exportData);
$("importInput").addEventListener("change", e => { if(e.target.files[0]) importData(e.target.files[0]); });
$("cancelImportBtn").addEventListener("click", closeImportPreview);
$("mergeImportBtn").addEventListener("click", () => applyImport("merge"));
$("replaceImportBtn").addEventListener("click", () => applyImport("replace"));
$("restoreBackupBtn").addEventListener("click", restoreSafetySnapshot);
$("clearBtn").addEventListener("click", clearBookmarksSafely);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.modelUsage) {
    usageStats = changes.modelUsage.newValue || {};
    renderUsage();
  }
  if (area === "local" && changes.bookmarks) {
    bookmarksCache = Array.isArray(changes.bookmarks.newValue) ? changes.bookmarks.newValue : [];
    renderAiQueue();
  }
  if (area === "local" && changes.recycleBin) recycleBinCache = Array.isArray(changes.recycleBin.newValue) ? changes.recycleBin.newValue : [];
  if (area === "local" && changes.nativeBookmarkImportJob) {
    nativeImportJob = changes.nativeBookmarkImportJob.newValue || null;
    renderNativeImportJob();
  }
});
init();
