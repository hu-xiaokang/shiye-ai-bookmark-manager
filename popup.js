const DEFAULT_CATEGORIES = ["稍后阅读", "工作效率", "技术开发", "设计灵感", "学习资料", "生活兴趣", "新闻资讯", "工具服务"];
const state = {
  bookmarks: [], settings: {}, currentUrl: "", currentTabId: null, currentCategory: "稍后阅读",
  currentTags: [], currentSummary: "", activeFilter: "全部", search: "",
  commonSites: [], recentSites: [], visibleItems: [], layoutHeight: 575, pendingNativeDeletions: [],
  editingBookmarkId: null, recycleBin: [], pendingDuplicate: null, undoAction: null
};

const $ = (id) => document.getElementById(id);
const t = (source, params) => I18n.t(source, params);
const categoryLabel = category => t(category);
const viewLabel = view => t(view);
const locale = () => I18n.language === "en" ? "en-US" : "zh-CN";
const els = {
  title: $("titleInput"), url: $("urlText"), category: $("categorySelect"), ai: $("aiBtn"),
  aiResult: $("aiResult"), save: $("saveBtn"), list: $("bookmarkList"), empty: $("emptyState"),
  filters: $("filterBar"), count: $("countText"), search: $("searchInput"), toast: $("toast"),
  searchClear: $("clearSearchBtn"), searchScope: $("searchScope"), searchShortcut: $("searchShortcut"),
  status: $("modelStatus"), settings: $("settingsBtn"), modal: $("captureModal"),
  recycle: $("recycleBinBtn"), recycleCount: $("recycleBinCount"),
  capture: $("captureBtn"), closeModal: $("closeModalBtn"), backdrop: $("modalBackdrop"),
  emptyCapture: $("emptyCaptureBtn"), viewTitle: $("viewTitle"),
  summary: $("summaryInput"), summaryBtn: $("summaryBtn"),
  nativeDeleteModal: $("nativeDeleteModal"), nativeDeleteName: $("nativeDeleteName"),
  nativeDeleteUrl: $("nativeDeleteUrl"), keepSynced: $("keepSyncedBookmarkBtn"),
  deleteSynced: $("deleteSyncedBookmarkBtn"), tags: $("tagsInput"),
  captureTitle: $("captureTitle"), captureEyebrow: $("captureEyebrow"),
  emptyTitle: $("emptyTitle"), emptyDescription: $("emptyDescription"),
  duplicateModal: $("duplicateModal"), duplicateBackdrop: $("duplicateBackdrop"),
  duplicateName: $("duplicateName"), duplicateMeta: $("duplicateMeta"),
  cancelDuplicate: $("cancelDuplicateBtn"), openDuplicate: $("openDuplicateBtn"), mergeDuplicate: $("mergeDuplicateBtn"),
  toastMessage: $("toastMessage"), toastAction: $("toastAction")
};

async function init() {
  const data = await chrome.storage.local.get(["bookmarks", "settings", "browsingMetrics", "pendingNativeDeletions", "recycleBin"]);
  state.bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  state.recycleBin = purgeExpiredTrash(Array.isArray(data.recycleBin) ? data.recycleBin : []);
  if (state.recycleBin.length !== (data.recycleBin || []).length) await chrome.storage.local.set({ recycleBin: state.recycleBin });
  state.settings = data.settings || {};
  await I18n.init(state.settings);
  state.pendingNativeDeletions = Array.isArray(data.pendingNativeDeletions) ? data.pendingNativeDeletions : [];
  const categories = [...new Set([...(state.settings.categories || DEFAULT_CATEGORIES), ...state.bookmarks.map(b => b.category).filter(Boolean)])];
  els.category.innerHTML = categories.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(categoryLabel(c))}</option>`).join("");
  updateModelStatus();
  resetCaptureForm();
  await Promise.all([loadCurrentTab(), loadHistoryViews(data.browsingMetrics || {})]);
  render();
  showNextNativeDeletion();
  els.searchShortcut.textContent = /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  if (!state.pendingNativeDeletions.length) requestAnimationFrame(() => els.search.focus());
}

async function loadHistoryViews(metrics) {
  try {
    const history = await chrome.history.search({
      text: "",
      startTime: Date.now() - 90 * 24 * 60 * 60 * 1000,
      maxResults: 500
    });
    const pages = history.filter(item => isWebUrl(item.url));
    state.recentSites = pages
      .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))
      .slice(0, 60)
      .map((item, index) => historyItem(item, "recent", index, metrics[item.url]?.durationMs || 0));

    const grouped = new Map();
    for (const item of pages) {
      let host;
      try { host = new URL(item.url).hostname.replace(/^www\./, ""); } catch { continue; }
      const current = grouped.get(host) || { host, visitCount: 0, typedCount: 0, durationMs: 0, lastVisitTime: 0, url: item.url, title: item.title };
      current.visitCount += item.visitCount || 0;
      current.typedCount += item.typedCount || 0;
      current.durationMs += metrics[item.url]?.durationMs || 0;
      if ((item.lastVisitTime || 0) >= current.lastVisitTime) {
        current.lastVisitTime = item.lastVisitTime || 0;
        current.url = item.url;
        current.title = item.title || host;
      }
      grouped.set(host, current);
    }

    state.commonSites = [...grouped.values()]
      .map(item => ({ ...item, score: commonSiteScore(item) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((item, index) => historyItem(item, "common", index, item.durationMs));
  } catch {
    state.commonSites = [];
    state.recentSites = [];
  }
}

async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/i.test(tab.url || "")) {
    els.title.value = I18n.language === "en" ? "This page cannot be bookmarked" : "当前页面不支持收藏";
    els.url.value = "";
    els.url.placeholder = I18n.language === "en" ? "Open a regular webpage and try again" : "请打开一个普通网页后再试";
    els.save.disabled = true;
    els.ai.disabled = true;
    els.summaryBtn.disabled = true;
    return;
  }
  state.currentTabId = tab.id;
  state.currentUrl = tab.url;
  els.title.value = tab.title || new URL(tab.url).hostname;
  els.url.value = tab.url;
  const existing = state.bookmarks.find(b => canonicalUrl(b.url) === canonicalUrl(tab.url));
  if (existing) {
    state.editingBookmarkId = existing.id;
    els.captureEyebrow.textContent = t("编辑收藏");
    els.captureTitle.textContent = t("修改收藏信息");
    els.save.textContent = t("更新这个收藏");
    els.category.value = existing.category || "稍后阅读";
    state.currentTags = existing.tags || [];
    state.currentSummary = existing.summary || "";
    els.summary.value = state.currentSummary;
    els.tags.value = state.currentTags.join("，");
    showAiResult();
  }
}

function resetCaptureForm() {
  state.editingBookmarkId = null;
  state.currentUrl = "";
  state.currentTabId = null;
  state.currentTags = [];
  state.currentSummary = "";
  els.captureEyebrow.textContent = t("新建收藏");
  els.captureTitle.textContent = t("收藏当前网页");
  els.title.value = "";
  els.url.value = "";
  els.url.placeholder = "https://example.com";
  els.summary.value = "";
  els.tags.value = "";
  els.aiResult.innerHTML = "";
  els.aiResult.classList.add("hidden");
  els.category.value = "稍后阅读";
  if (!els.category.value && els.category.options.length) els.category.value = els.category.options[0].value;
  els.save.disabled = false;
  els.ai.disabled = false;
  els.summaryBtn.disabled = false;
  els.save.textContent = t("确认收藏");
}

function updateModelStatus() {
  const ready = Boolean(state.settings.apiUrl && state.settings.apiKey && state.settings.model);
  els.status.classList.toggle("ready", ready);
  els.status.lastChild.textContent = ready ? (I18n.language === "en" ? `${state.settings.model} ready` : `${state.settings.model} 已就绪`) : t("未配置模型");
}

function render() {
  const activityViews = ["常用网址", "最近浏览"];
  const bookmarkCategories = ["全部", ...new Set([...(state.settings.categories || DEFAULT_CATEGORIES), ...state.bookmarks.map(b => b.category).filter(Boolean)])];
  updatePopupHeight(bookmarkCategories.length);
  const utilityViews = ["回收站"];
  const allViews = [...bookmarkCategories, ...activityViews, ...utilityViews];
  if (!allViews.includes(state.activeFilter)) state.activeFilter = "全部";
  const renderFilter = (c, index = 0) => {
    const count = c === "全部" ? state.bookmarks.length
      : c === "常用网址" ? state.commonSites.length
      : c === "最近浏览" ? state.recentSites.length
      : c === "回收站" ? state.recycleBin.length
      : state.bookmarks.filter(b => b.category === c).length;
    const icon = c === "全部" ? "⌂" : c === "常用网址" ? "★" : c === "最近浏览" ? "◷" : c === "回收站" ? "♲" : (c.trim().charAt(0) || "#");
    const kind = activityViews.includes(c) ? ` activity-icon activity-${index}` : "";
    const tone = getCategoryTone(c);
    return `<button class="filter-chip tone-${tone} ${c === state.activeFilter ? "active" : ""}" data-filter="${escapeAttr(c)}">
      <span class="filter-icon${kind}">${escapeHtml(icon)}</span><span class="filter-name">${escapeHtml(viewLabel(c))}</span><span class="filter-count">${count}</span>
    </button>`;
  };
  els.filters.innerHTML = `
    <section class="nav-group activity-group">
      <div class="nav-items">${activityViews.map(renderFilter).join("")}</div>
    </section>
    <section class="nav-group category-group">
      <div class="nav-group-title"><span>${escapeHtml(t("收藏分类"))}</span><i>${state.bookmarks.length}</i></div>
      <div class="nav-items">${bookmarkCategories.map(renderFilter).join("")}</div>
    </section>`;
  els.recycle.classList.toggle("active", state.activeFilter === "回收站");
  els.recycleCount.textContent = state.recycleBin.length > 99 ? "99+" : String(state.recycleBin.length);
  els.recycleCount.classList.toggle("hidden", state.recycleBin.length === 0);
  const keyword = state.search.trim().toLowerCase();
  const isBookmarkView = !activityViews.includes(state.activeFilter) && state.activeFilter !== "回收站";
  els.viewTitle.textContent = keyword && isBookmarkView ? t("搜索收藏") : state.activeFilter === "全部" ? t("全部网站") : viewLabel(state.activeFilter);
  els.searchScope.classList.toggle("hidden", !keyword || !isBookmarkView);
  els.searchClear.classList.toggle("hidden", !keyword);
  els.searchShortcut.classList.toggle("hidden", Boolean(keyword));
  els.search.classList.toggle("has-value", Boolean(keyword));
  let sourceItems;
  if (state.activeFilter === "常用网址") sourceItems = state.commonSites;
  else if (state.activeFilter === "最近浏览") sourceItems = state.recentSites;
  else if (state.activeFilter === "回收站") sourceItems = state.recycleBin.map(entry => ({ ...entry.bookmark, trashId: entry.id, deletedAt: entry.deletedAt, source: "trash" }));
  else sourceItems = keyword ? state.bookmarks : state.bookmarks.filter(item => state.activeFilter === "全部" || item.category === state.activeFilter);
  const filtered = sourceItems.filter(item => {
    const searchableText = item.source === "history"
      ? [item.title, item.url].join(" ")
      : [item.title, item.summary, item.url, item.category, categoryLabel(item.category), ...(item.tags || [])].filter(Boolean).join(" ");
    return !keyword || fuzzyMatch(searchableText, keyword);
  });
  if (keyword) filtered.sort((a, b) => searchResultScore(b, keyword) - searchResultScore(a, keyword));
  state.visibleItems = filtered;

  const unit = I18n.language === "en"
    ? state.activeFilter === "最近浏览" ? "records" : state.activeFilter === "常用网址" ? "frequent sites" : state.activeFilter === "回收站" ? "to restore" : "bookmarks"
    : state.activeFilter === "最近浏览" ? "条记录" : state.activeFilter === "常用网址" ? "个常用网站" : state.activeFilter === "回收站" ? "条待恢复" : "个收藏";
  els.count.textContent = keyword
    ? (I18n.language === "en" ? `${isBookmarkView ? "All bookmarks" : "Current view"}: ${filtered.length} results` : `${isBookmarkView ? "全库" : "当前视图"}找到 ${filtered.length} 个结果`)
    : `${filtered.length} ${unit}`;

  const bookmarkByUrl = new Map(state.bookmarks.map(bookmark => [canonicalUrl(bookmark.url), bookmark]));
  els.list.innerHTML = filtered.map(item => {
    let host = item.url;
    try { host = new URL(item.url).hostname.replace(/^www\./, ""); } catch {}
    const isHistory = item.source === "history";
    const isTrash = item.source === "trash";
    const summary = isHistory
      ? item.viewType === "common"
        ? (I18n.language === "en" ? `${item.visitCount || 0} visits${item.durationMs ? ` · active for ${formatDuration(item.durationMs)}` : ""}` : `访问 ${item.visitCount || 0} 次${item.durationMs ? ` · 活跃浏览 ${formatDuration(item.durationMs)}` : ""}`)
        : (I18n.language === "en" ? `Last visited: ${relativeTime(item.lastVisitTime)}` : `最近访问：${relativeTime(item.lastVisitTime)}`)
      : item.summary;
    const savedBookmark = isHistory ? bookmarkByUrl.get(canonicalUrl(item.url)) : null;
    const pill = savedBookmark?.category || (isHistory ? "" : (item.category || "未分类"));
    const pillTone = savedBookmark ? getCategoryTone(savedBookmark.category || "") : getCategoryTone(item.category || "");
    const pillTitle = savedBookmark ? (I18n.language === "en" ? `Saved to “${categoryLabel(pill)}”` : `已收藏到“${pill}”`) : categoryLabel(pill);
    const displayTags = (savedBookmark?.tags || item.tags || []).filter(Boolean).map(tag => String(tag).replace(/^#+\s*/, "")).slice(0, 3);
    const tagsMarkup = displayTags.map(tag => `<span class="content-tag">#${highlightSearchText(tag, keyword)}</span>`).join("");
    const editableId = isHistory ? savedBookmark?.id : item.id;
    const aiStatusMarkup = !isHistory && !isTrash ? renderAiStatus(item) : "";
    const actionsMarkup = isTrash
      ? `<div class="card-actions trash-actions"><button class="restore-btn" data-trash-id="${escapeAttr(item.trashId)}" title="${escapeAttr(t("恢复收藏"))}">${escapeHtml(t("恢复"))}</button><button class="purge-btn" data-trash-id="${escapeAttr(item.trashId)}" title="${escapeAttr(t("彻底删除"))}">×</button></div>`
      : isHistory
      ? `<div class="card-actions">${editableId ? `<button class="edit-btn" data-edit-id="${escapeAttr(editableId)}" title="${escapeAttr(t("编辑收藏"))}" aria-label="${escapeAttr(t("编辑收藏"))}">✎</button>` : ""}<span class="open-hint">↗</span></div>`
      : `<div class="card-actions">${item.aiStatus === "failed" || item.aiStatus === "pending" || !item.summary ? `<button class="retry-ai-btn" data-retry-id="${escapeAttr(item.id)}" title="${escapeAttr(t("重新进行 AI 整理"))}">↻</button>` : ""}<button class="edit-btn" data-edit-id="${escapeAttr(editableId)}" title="${escapeAttr(t("编辑收藏"))}" aria-label="${escapeAttr(t("编辑收藏"))}">✎</button><button class="delete-btn" title="${escapeAttr(t("删除"))}" aria-label="${escapeAttr(t("删除"))}">×</button></div>`;
    return `<article class="bookmark-card ${isHistory ? "history-card" : ""}" data-id="${escapeAttr(item.id)}">
      <div class="bookmark-main" title="${escapeAttr(summary || item.url)}">
        <div class="bookmark-title">${highlightSearchText(item.title || item.url, keyword)}</div>
        ${summary ? `<div class="bookmark-summary">${highlightSearchText(summary, keyword)}</div>` : ""}
        <div class="bookmark-meta">${pill ? `<span class="category-pill pill-${pillTone}" title="${escapeAttr(pillTitle)}">${highlightSearchText(categoryLabel(pill), keyword)}</span>` : ""}${tagsMarkup}${aiStatusMarkup}<span class="bookmark-host">${highlightSearchText(isTrash ? (I18n.language === "en" ? `Deleted ${relativeTime(item.deletedAt)}` : `删除于 ${relativeTime(item.deletedAt)}`) : host, keyword)}</span></div>
      </div>
      ${actionsMarkup}
    </article>`;
  }).join("");
  els.empty.classList.toggle("hidden", filtered.length !== 0);
  els.emptyTitle.textContent = keyword ? t("没有找到匹配的网址") : t("这里还没有网站");
  els.emptyDescription.textContent = keyword ? t("试试更短的关键词，或搜索摘要、标签和域名") : t("收藏当前网页，或切换其他分类看看");
}

function highlightSearchText(value, query) {
  const text = String(value || "");
  const terms = [...new Set(String(query || "").trim().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!terms.length) return escapeHtml(text);
  const pattern = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (!pattern) return escapeHtml(text);
  const regex = new RegExp(`(${pattern})`, "gi");
  return text.split(regex).map(part => terms.some(term => part.toLowerCase() === term.toLowerCase())
    ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join("");
}

function searchResultScore(item, query) {
  const phrase = normalizeSearchText(query);
  const title = normalizeSearchText(item.title || "");
  const summary = normalizeSearchText(item.summary || "");
  const url = normalizeSearchText(item.url || "");
  const category = normalizeSearchText(item.category || "");
  const tags = (item.tags || []).map(normalizeSearchText);
  let score = 0;
  if (title === phrase) score += 240;
  else if (title.startsWith(phrase)) score += 170;
  else if (title.includes(phrase)) score += 125;
  if (tags.some(tag => tag === phrase)) score += 115;
  else if (tags.some(tag => tag.includes(phrase))) score += 80;
  if (url.includes(phrase)) score += 70;
  if (category.includes(phrase)) score += 45;
  if (summary.includes(phrase)) score += 35;
  const updatedAt = new Date(item.updatedAt || item.createdAt || item.lastVisitTime || 0).getTime();
  if (updatedAt) score += Math.max(0, 12 - (Date.now() - updatedAt) / 2_592_000_000);
  return score;
}

function renderAiStatus(item) {
  const status = item.aiStatus || (item.summary ? "completed" : "idle");
  const labels = {
    pending: [t("等待整理"), "pending"], processing: [t("AI 整理中"), "processing"],
    completed: [t("AI 已整理"), "completed"], failed: [t("整理失败"), "failed"]
  };
  if (!labels[status]) return "";
  const [label, tone] = labels[status];
  const title = item.aiError ? `${label}：${item.aiError}` : label;
  return `<span class="ai-status ai-${tone}" title="${escapeAttr(title)}">${escapeHtml(label)}</span>`;
}

function purgeExpiredTrash(items) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return items.filter(item => Number(item.deletedAt || 0) >= cutoff && item.bookmark);
}

async function classifyWithAI(usageFeature = "classification") {
  if (!state.settings.apiUrl || !state.settings.apiKey || !state.settings.model) {
    showToast(I18n.language === "en" ? "Configure the model URL, key, and model name first" : "请先配置模型 URL、Key 和模型名");
    chrome.runtime.openOptionsPage();
    return;
  }
  if (!syncCurrentUrlFromForm()) return showToast(I18n.language === "en" ? "Enter a valid HTTP or HTTPS URL" : "请输入有效的 HTTP 或 HTTPS 网址");
  els.ai.disabled = true;
  els.summaryBtn.disabled = true;
  els.ai.querySelector("span").textContent = t("正在分析…");
  let usageRecorded = false;
  let requestStarted = false;
  try {
    const categories = state.settings.categories || DEFAULT_CATEGORIES;
    const endpoint = normalizeEndpoint(state.settings.apiUrl);
    const categoryCandidates = categories.map(category => `${category}${categoryLabel(category) !== category ? ` (${categoryLabel(category)})` : ""}`).join(", ");
    const pageContent = await extractPageContent();
    requestStarted = true;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${state.settings.apiKey}` },
      body: JSON.stringify({
        model: state.settings.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: I18n.language === "en"
            ? `You organize web bookmarks. Select exactly one category identifier from the candidates and generate 2-4 short English tags plus a concise 40-90 word English summary. Cover the core topic, key information, and intended use without inventing facts. Return JSON only: {"category":"exact identifier","tags":["tag"],"summary":"summary"}. Candidates: ${categoryCandidates}`
            : `你是网址收藏整理助手。请根据网页标题、网址和正文，从候选分类中选择最合适的一项，并生成2-4个简短中文标签和60-120字的中文内容摘要。摘要应概括核心主题、主要信息和网页用途，不能编造。只返回JSON：{"category":"分类","tags":["标签"],"summary":"摘要"}。候选分类：${categories.join("、")}` },
          { role: "user", content: I18n.language === "en"
            ? `Title: ${els.title.value}\nURL: ${state.currentUrl}\nPage content:\n${pageContent || "Page content is unavailable. Infer from the title and URL."}`
            : `标题：${els.title.value}\n网址：${state.currentUrl}\n网页正文：\n${pageContent || "正文暂时无法读取，请根据标题和网址判断。"}` }
        ]
      })
    });
    if (!response.ok) {
      usageRecorded = true;
      await reportModelUsage(usageFeature, null, false);
      const error = await response.text();
      throw new Error(I18n.language === "en" ? `Request failed (${response.status})${error ? `: ${error.slice(0, 80)}` : ""}` : `请求失败（${response.status}）${error ? `：${error.slice(0, 80)}` : ""}`);
    }
    const data = await response.json();
    usageRecorded = true;
    await reportModelUsage(usageFeature, data.usage, true);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(I18n.language === "en" ? "The model returned no classification" : "模型没有返回分类结果");
    const result = parseJson(content);
    const category = categories.includes(result.category) ? result.category : "稍后阅读";
    state.currentCategory = category;
    state.currentTags = Array.isArray(result.tags) ? result.tags.slice(0, 4).map(String) : [];
    state.currentSummary = String(result.summary || "").trim();
    els.category.value = category;
    showAiResult();
    showToast(I18n.language === "en" ? "AI classification complete" : "AI 分类完成");
  } catch (error) {
    if (requestStarted && !usageRecorded) await reportModelUsage(usageFeature, null, false);
    showToast(error.message || (I18n.language === "en" ? "Classification failed; check the model settings" : "分类失败，请检查模型配置"));
  } finally {
    els.ai.disabled = false;
    els.summaryBtn.disabled = false;
    els.ai.querySelector("span").textContent = t("AI 智能分类");
  }
}

function showAiResult() {
  els.summary.value = state.currentSummary;
  els.tags.value = state.currentTags.join("，");
  if (!state.currentTags.length) {
    els.aiResult.classList.add("hidden");
    return;
  }
  els.aiResult.classList.remove("hidden");
  els.aiResult.innerHTML = state.currentTags.map(t => `<span class="tag"># ${escapeHtml(t)}</span>`).join("");
}

async function generateSummary() {
  if (!state.settings.apiUrl || !state.settings.apiKey || !state.settings.model) {
    showToast(I18n.language === "en" ? "Configure the model URL, key, and model name first" : "请先配置模型 URL、Key 和模型名");
    chrome.runtime.openOptionsPage();
    return;
  }
  if (!syncCurrentUrlFromForm()) return showToast(I18n.language === "en" ? "Enter a valid HTTP or HTTPS URL" : "请输入有效的 HTTP 或 HTTPS 网址");
  els.summaryBtn.disabled = true;
  els.ai.disabled = true;
  els.summaryBtn.querySelector("span").textContent = t("正在读取…");
  let usageRecorded = false;
  let requestStarted = false;
  try {
    const pageContent = await extractPageContent();
    if (!pageContent) throw new Error(I18n.language === "en" ? "Could not read the current page" : "未能读取当前页面正文");
    els.summaryBtn.querySelector("span").textContent = t("正在总结…");
    requestStarted = true;
    const response = await fetch(normalizeEndpoint(state.settings.apiUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${state.settings.apiKey}` },
      body: JSON.stringify({
        model: state.settings.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: I18n.language === "en" ? "Write a concise, accurate 40-90 word English summary covering the page's core topic, key information, and intended use. Do not add a title, Markdown, or unsupported facts. Return only the summary." : "你是网页内容摘要助手。请用简洁、准确的中文写一段60-120字摘要，包含网页的核心主题、主要信息和用途。不要添加标题、Markdown或网页中没有的信息，只返回摘要正文。" },
          { role: "user", content: I18n.language === "en" ? `Page title: ${els.title.value}\nURL: ${state.currentUrl}\nPage content:\n${pageContent}` : `网页标题：${els.title.value}\n网页地址：${state.currentUrl}\n网页正文：\n${pageContent}` }
        ]
      })
    });
    if (!response.ok) {
      usageRecorded = true;
      await reportModelUsage("summary", null, false);
      throw new Error(I18n.language === "en" ? `Summary request failed (${response.status})` : `摘要请求失败（${response.status}）`);
    }
    const data = await response.json();
    usageRecorded = true;
    await reportModelUsage("summary", data.usage, true);
    const summary = String(data.choices?.[0]?.message?.content || "")
      .replace(/^```(?:text)?/i, "").replace(/```$/i, "").replace(/^摘要[：:]\s*/, "").trim();
    if (!summary) throw new Error(I18n.language === "en" ? "The model returned no summary" : "模型没有返回摘要");
    state.currentSummary = summary;
    els.summary.value = state.currentSummary;
    showToast(I18n.language === "en" ? "Summary generated" : "内容摘要已生成");
  } catch (error) {
    if (requestStarted && !usageRecorded) await reportModelUsage("summary", null, false);
    showToast(error.message || (I18n.language === "en" ? "Summary generation failed" : "摘要生成失败"));
  } finally {
    els.summaryBtn.disabled = false;
    els.ai.disabled = false;
    els.summaryBtn.querySelector("span").textContent = t("生成摘要");
  }
}

async function extractPageContent() {
  try {
    const tabs = await chrome.tabs.query({});
    const matchingTab = tabs.find(tab => tab.id && canonicalUrl(tab.url) === canonicalUrl(state.currentUrl));
    const tabId = matchingTab?.id;
    if (!tabId) return "";
    const [{ result = "" } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
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

function syncCurrentUrlFromForm() {
  const value = els.url.value.trim();
  if (!/^https?:\/\//i.test(value)) return false;
  state.currentUrl = value;
  return true;
}

async function saveBookmark() {
  const title = els.title.value.trim();
  if (!title || !syncCurrentUrlFromForm()) return showToast(I18n.language === "en" ? "Enter a valid title and URL" : "请填写有效的标题和网址");
  const existing = state.editingBookmarkId
    ? state.bookmarks.find(item => item.id === state.editingBookmarkId)
    : null;
  const duplicate = state.bookmarks.find(item => item.id !== existing?.id && canonicalUrl(item.url) === canonicalUrl(state.currentUrl));
  if (duplicate) return showDuplicateDialog(duplicate, existing);
  const autoClassify = state.settings.autoClassifyOnSave ?? true;
  const modelReady = state.settings.apiUrl && state.settings.apiKey && state.settings.model;
  if (!state.editingBookmarkId && autoClassify && modelReady && !els.summary.value.trim()) {
    els.save.disabled = true;
    els.save.textContent = I18n.language === "en" ? "Organizing…" : "正在智能整理…";
    await classifyWithAI("auto_classification");
    els.save.disabled = false;
  }
  state.currentSummary = els.summary.value.trim();
  state.currentTags = [...new Set(els.tags.value.split(/[,，、\n]+/).map(tag => tag.replace(/^#+\s*/, "").trim()).filter(Boolean))].slice(0, 8);
  const bookmark = {
    ...(existing || {}), id: existing?.id || crypto.randomUUID(), title, url: state.currentUrl,
    category: els.category.value, tags: state.currentTags, summary: state.currentSummary,
    aiStatus: state.currentSummary || state.currentTags.length ? "completed" : (modelReady && autoClassify ? "pending" : "idle"),
    aiError: "", createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  state.bookmarks = existing
    ? state.bookmarks.map(item => item.id === existing.id ? bookmark : item)
    : [bookmark, ...state.bookmarks];
  await chrome.storage.local.set({ bookmarks: state.bookmarks });
  els.save.textContent = t("已收藏 ✓");
  setTimeout(() => { els.save.textContent = t("更新这个收藏"); }, 1200);
  render();
  showToast(existing ? (I18n.language === "en" ? "Bookmark updated" : "收藏信息已更新") : (I18n.language === "en" ? "Bookmark saved" : "收藏成功"));
  setTimeout(closeCaptureModal, 520);
}

async function deleteBookmark(id) {
  const bookmark = state.bookmarks.find(item => item.id === id);
  if (!bookmark) return;
  const trashEntry = { id: crypto.randomUUID(), bookmark: { ...bookmark }, deletedAt: Date.now(), reason: "user" };
  state.bookmarks = state.bookmarks.filter(item => item.id !== id);
  state.recycleBin.unshift(trashEntry);
  await chrome.storage.local.set({ bookmarks: state.bookmarks, recycleBin: state.recycleBin });
  render();
  showToast(I18n.language === "en" ? "Moved to trash" : "已移至回收站", t("撤销"), () => restoreTrashItem(trashEntry.id));
}

function showDuplicateDialog(duplicate, editingExisting) {
  state.pendingDuplicate = { duplicate, editingExisting, draft: collectBookmarkDraft(editingExisting) };
  els.duplicateName.textContent = duplicate.title || duplicate.url;
  els.duplicateMeta.textContent = `${categoryLabel(duplicate.category || "未分类")} · ${duplicate.url}`;
  els.duplicateModal.classList.remove("hidden");
}

function collectBookmarkDraft(existing = null) {
  const tags = [...new Set(els.tags.value.split(/[,，、\n]+/).map(tag => tag.replace(/^#+\s*/, "").trim()).filter(Boolean))].slice(0, 8);
  return {
    ...(existing || {}), title: els.title.value.trim(), url: state.currentUrl,
    category: els.category.value, tags, summary: els.summary.value.trim(), updatedAt: new Date().toISOString()
  };
}

async function mergeDuplicateBookmark() {
  const pending = state.pendingDuplicate;
  if (!pending) return;
  const { duplicate, editingExisting, draft } = pending;
  const merged = {
    ...duplicate,
    title: draft.title || duplicate.title,
    category: draft.category || duplicate.category,
    summary: (draft.summary || "").length >= (duplicate.summary || "").length ? draft.summary : duplicate.summary,
    tags: [...new Set([...(duplicate.tags || []), ...(draft.tags || [])])].slice(0, 8),
    nativeBookmarkIds: [...new Set([...(duplicate.nativeBookmarkIds || []), ...(draft.nativeBookmarkIds || [])])],
    nativeBookmarkId: duplicate.nativeBookmarkId || draft.nativeBookmarkId || null,
    aiStatus: draft.summary || duplicate.summary ? "completed" : (duplicate.aiStatus || "idle"),
    updatedAt: new Date().toISOString()
  };
  state.bookmarks = state.bookmarks
    .filter(item => !editingExisting || item.id !== editingExisting.id)
    .map(item => item.id === duplicate.id ? merged : item);
  await chrome.storage.local.set({ bookmarks: state.bookmarks });
  closeDuplicateDialog();
  closeCaptureModal();
  render();
  showToast(I18n.language === "en" ? "Duplicate bookmarks merged" : "重复收藏已合并");
}

function closeDuplicateDialog() {
  state.pendingDuplicate = null;
  els.duplicateModal.classList.add("hidden");
}

async function restoreTrashItem(trashId) {
  const entry = state.recycleBin.find(item => item.id === trashId);
  if (!entry) return showToast(I18n.language === "en" ? "This bookmark is no longer in trash" : "这条收藏已不在回收站");
  const collision = state.bookmarks.find(item => canonicalUrl(item.url) === canonicalUrl(entry.bookmark.url));
  if (collision) return showToast(I18n.language === "en" ? "The same URL already exists; resolve the duplicate first" : "相同网址已存在，请先处理重复收藏");
  state.recycleBin = state.recycleBin.filter(item => item.id !== trashId);
  const restoredId = state.bookmarks.some(item => item.id === entry.bookmark.id) ? crypto.randomUUID() : entry.bookmark.id;
  state.bookmarks.unshift({ ...entry.bookmark, id: restoredId, updatedAt: new Date().toISOString() });
  await chrome.storage.local.set({ bookmarks: state.bookmarks, recycleBin: state.recycleBin });
  render();
  showToast(I18n.language === "en" ? "Bookmark restored" : "收藏已恢复");
}

async function permanentlyDeleteTrashItem(trashId) {
  if (!confirm(I18n.language === "en" ? "Delete this bookmark permanently? This cannot be undone." : "确定彻底删除这条收藏吗？此操作无法撤销。")) return;
  state.recycleBin = state.recycleBin.filter(item => item.id !== trashId);
  await chrome.storage.local.set({ recycleBin: state.recycleBin });
  render();
  showToast(I18n.language === "en" ? "Permanently deleted" : "已彻底删除");
}

async function retryAiProcessing(bookmarkId) {
  const bookmark = state.bookmarks.find(item => item.id === bookmarkId);
  if (!bookmark) return;
  bookmark.aiStatus = "pending";
  bookmark.aiError = "";
  await chrome.storage.local.set({ bookmarks: state.bookmarks });
  render();
  showToast(I18n.language === "en" ? "Added to the AI processing queue" : "已加入 AI 整理队列");
  try {
    const response = await chrome.runtime.sendMessage({ type: "retry-ai-bookmark", bookmarkId });
    if (response?.error) showToast(response.error);
  } catch {
    showToast(I18n.language === "en" ? "Could not start AI processing" : "无法启动 AI 整理任务");
  }
}

function normalizeEndpoint(url) {
  const clean = url.trim().replace(/\/$/, "");
  if (/\/chat\/completions$/i.test(clean)) return clean;
  if (/\/v1$/i.test(clean)) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
}

function parseJson(content) {
  const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("无法识别模型返回内容");
  return JSON.parse(match[0]);
}

async function reportModelUsage(feature, usage, success) {
  try {
    await chrome.runtime.sendMessage({
      type: "record-model-usage",
      payload: { feature, usage, success, model: state.settings.model }
    });
  } catch {}
}

function isWebUrl(url = "") {
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

function historyItem(item, viewType, index, durationMs = 0) {
  return {
    id: `history-${viewType}-${index}`,
    source: "history",
    viewType,
    title: item.title || item.host || item.url,
    url: item.url,
    visitCount: item.visitCount || 0,
    typedCount: item.typedCount || 0,
    lastVisitTime: item.lastVisitTime || 0,
    durationMs
  };
}

function commonSiteScore(item) {
  const ageDays = Math.max(0, (Date.now() - (item.lastVisitTime || 0)) / 86_400_000);
  const frequency = Math.log1p(item.visitCount || 0) * 28;
  const recency = Math.exp(-ageDays / 14) * 25;
  const activeTime = Math.log1p((item.durationMs || 0) / 60_000) * 12;
  const intentionalVisits = Math.log1p(item.typedCount || 0) * 10;
  return frequency + recency + activeTime + intentionalVisits;
}

function formatDuration(milliseconds) {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return I18n.language === "en" ? `${minutes} min` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return I18n.language === "en" ? (rest ? `${hours} hr ${rest} min` : `${hours} hr`) : (rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`);
}

function relativeTime(timestamp) {
  if (!timestamp) return I18n.language === "en" ? "unknown" : "未知";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return I18n.language === "en" ? "just now" : "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return I18n.language === "en" ? `${minutes} min ago` : `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return I18n.language === "en" ? `${hours} hr ago` : `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return I18n.language === "en" ? `${days} days ago` : `${days} 天前`;
  return new Date(timestamp).toLocaleDateString(locale());
}

function getCategoryTone(category) {
  const tones = {
    "全部": "all", "稍后阅读": "violet", "工作效率": "cyan", "技术开发": "blue",
    "设计灵感": "rose", "学习资料": "amber", "生活兴趣": "green", "新闻资讯": "orange",
    "工具服务": "red", "常用网址": "gold", "最近浏览": "purple"
  };
  return tones[category] || "slate";
}

function fuzzyMatch(text, query) {
  const normalizedText = normalizeSearchText(text);
  const terms = String(query).trim().split(/\s+/).map(normalizeSearchText).filter(Boolean);
  return terms.every(term => {
    if (normalizedText.includes(term)) return true;
    if (isCompactSubsequence(normalizedText, term)) return true;
    if (/^[a-z0-9]+$/i.test(term)) {
      const words = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
      return words.some(word => word.startsWith(term) || (term.length >= 3 && editDistance(word, term) <= Math.max(1, Math.floor(term.length / 4))));
    }
    return false;
  });
}

function clearSearch({ focus = true } = {}) {
  state.search = "";
  els.search.value = "";
  render();
  if (focus) requestAnimationFrame(() => els.search.focus());
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
}

function isCompactSubsequence(text, query) {
  if (query.length < 2) return false;
  let first = -1, last = -1, cursor = 0;
  for (const char of query) {
    const index = text.indexOf(char, cursor);
    if (index < 0) return false;
    if (first < 0) first = index;
    last = index;
    cursor = index + 1;
  }
  return last - first <= query.length * 2;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

function showToast(message, actionLabel = "", action = null) {
  els.toastMessage.textContent = t(message);
  state.undoAction = action;
  els.toastAction.textContent = actionLabel;
  els.toastAction.classList.toggle("hidden", !actionLabel || !action);
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.classList.remove("show");
    state.undoAction = null;
  }, action ? 5200 : 2200);
}

async function openCaptureModal() {
  resetCaptureForm();
  applyPopupHeight(Math.max(state.layoutHeight, 575));
  els.modal.classList.remove("hidden");
  await loadCurrentTab();
  requestAnimationFrame(() => {
    if (!els.title.disabled) els.title.focus();
  });
}

function openEditModal(bookmarkId) {
  const bookmark = state.bookmarks.find(item => item.id === bookmarkId);
  if (!bookmark) return showToast(I18n.language === "en" ? "Bookmark not found" : "未找到这条收藏");
  resetCaptureForm();
  state.editingBookmarkId = bookmark.id;
  state.currentUrl = bookmark.url;
  state.currentTags = [...(bookmark.tags || [])];
  state.currentSummary = bookmark.summary || "";
  els.captureEyebrow.textContent = t("编辑收藏");
  els.captureTitle.textContent = t("修改收藏信息");
  els.title.value = bookmark.title || bookmark.url;
  els.url.value = bookmark.url;
  els.category.value = bookmark.category || "稍后阅读";
  els.summary.value = state.currentSummary;
  els.tags.value = state.currentTags.join("，");
  els.save.textContent = t("保存修改");
  showAiResult();
  applyPopupHeight(Math.max(state.layoutHeight, 575));
  els.modal.classList.remove("hidden");
  requestAnimationFrame(() => els.title.focus());
}

function closeCaptureModal() {
  els.modal.classList.add("hidden");
  applyPopupHeight(state.layoutHeight);
  showNextNativeDeletion();
}

function updatePopupHeight(categoryCount) {
  const desiredHeight = Math.max(460, Math.min(620, 259 + categoryCount * 35));
  state.layoutHeight = desiredHeight;
  if (els.modal.classList.contains("hidden") && els.nativeDeleteModal.classList.contains("hidden")) applyPopupHeight(desiredHeight);
}

function applyPopupHeight(height) {
  document.documentElement.style.setProperty("--popup-height", `${height}px`);
}

async function reloadPendingNativeDeletions() {
  const data = await chrome.storage.local.get("pendingNativeDeletions");
  state.pendingNativeDeletions = Array.isArray(data.pendingNativeDeletions) ? data.pendingNativeDeletions : [];
  showNextNativeDeletion();
}

function showNextNativeDeletion() {
  if (!els.modal.classList.contains("hidden")) return;
  const pending = state.pendingNativeDeletions[0];
  if (!pending) {
    els.nativeDeleteModal.classList.add("hidden");
    applyPopupHeight(state.layoutHeight);
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  els.nativeDeleteName.textContent = pending.title || pending.url;
  els.nativeDeleteUrl.textContent = pending.url;
  applyPopupHeight(Math.max(state.layoutHeight, 500));
  els.nativeDeleteModal.classList.remove("hidden");
}

async function resolveNativeDeletion(deleteFromPlugin) {
  const pending = state.pendingNativeDeletions.shift();
  if (!pending) return;
  let deletedTrashId = null;
  if (deleteFromPlugin) {
    const bookmark = state.bookmarks.find(item => item.id === pending.pluginBookmarkId);
    if (bookmark) {
      deletedTrashId = crypto.randomUUID();
      state.recycleBin.unshift({ id: deletedTrashId, bookmark: { ...bookmark }, deletedAt: Date.now(), reason: "native-bookmark" });
    }
    state.bookmarks = state.bookmarks.filter(item => item.id !== pending.pluginBookmarkId);
  } else {
    const bookmark = state.bookmarks.find(item => item.id === pending.pluginBookmarkId);
    if (bookmark) {
      bookmark.nativeBookmarkId = null;
      bookmark.nativeBookmarkIds = [];
      bookmark.updatedAt = new Date().toISOString();
    }
  }
  await chrome.storage.local.set({
    bookmarks: state.bookmarks,
    recycleBin: state.recycleBin,
    pendingNativeDeletions: state.pendingNativeDeletions
  });
  const remaining = state.pendingNativeDeletions.length;
  await chrome.action.setBadgeText({ text: remaining ? (remaining > 9 ? "9+" : String(remaining)) : "" });
  render();
  if (deleteFromPlugin && deletedTrashId) showToast(I18n.language === "en" ? "Also moved to ShiYe trash" : "已同时移至拾页回收站", t("撤销"), () => restoreTrashItem(deletedTrashId));
  else showToast(I18n.language === "en" ? "Kept in ShiYe" : "已在拾页保留");
  if (remaining) showNextNativeDeletion();
  else {
    els.nativeDeleteModal.classList.add("hidden");
    applyPopupHeight(state.layoutHeight);
  }
}

function escapeHtml(value = "") { return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escapeAttr(value = "") { return escapeHtml(value); }

els.ai.addEventListener("click", () => classifyWithAI());
els.summaryBtn.addEventListener("click", generateSummary);
els.save.addEventListener("click", saveBookmark);
els.capture.addEventListener("click", openCaptureModal);
els.emptyCapture.addEventListener("click", openCaptureModal);
els.closeModal.addEventListener("click", closeCaptureModal);
els.backdrop.addEventListener("click", closeCaptureModal);
els.settings.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.recycle.addEventListener("click", () => { state.activeFilter = "回收站"; render(); });
els.keepSynced.addEventListener("click", () => resolveNativeDeletion(false));
els.deleteSynced.addEventListener("click", () => resolveNativeDeletion(true));
els.duplicateBackdrop.addEventListener("click", closeDuplicateDialog);
els.cancelDuplicate.addEventListener("click", closeDuplicateDialog);
els.openDuplicate.addEventListener("click", () => {
  const duplicate = state.pendingDuplicate?.duplicate;
  if (duplicate) chrome.tabs.create({ url: duplicate.url });
});
els.mergeDuplicate.addEventListener("click", mergeDuplicateBookmark);
els.toastAction.addEventListener("click", () => {
  const action = state.undoAction;
  state.undoAction = null;
  els.toast.classList.remove("show");
  if (action) action();
});
els.search.addEventListener("input", e => { state.search = e.target.value; render(); });
els.searchClear.addEventListener("click", () => clearSearch());
els.filters.addEventListener("click", e => {
  const button = e.target.closest("[data-filter]");
  if (!button) return;
  state.activeFilter = button.dataset.filter; render();
});
document.addEventListener("keydown", e => {
  const target = e.target;
  const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  const searchAvailable = els.modal.classList.contains("hidden") && els.duplicateModal.classList.contains("hidden") && els.nativeDeleteModal.classList.contains("hidden");
  if (searchAvailable && (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !isTyping))) {
    e.preventDefault();
    els.search.focus();
    els.search.select();
    return;
  }
  if (e.key !== "Escape") return;
  if (!els.duplicateModal.classList.contains("hidden")) closeDuplicateDialog();
  else if (!els.modal.classList.contains("hidden")) closeCaptureModal();
  else if (state.search) clearSearch();
});
els.list.addEventListener("click", e => {
  const card = e.target.closest(".bookmark-card");
  if (!card) return;
  const editButton = e.target.closest(".edit-btn");
  if (editButton) return openEditModal(editButton.dataset.editId);
  const restoreButton = e.target.closest(".restore-btn");
  if (restoreButton) return restoreTrashItem(restoreButton.dataset.trashId);
  const purgeButton = e.target.closest(".purge-btn");
  if (purgeButton) return permanentlyDeleteTrashItem(purgeButton.dataset.trashId);
  const retryButton = e.target.closest(".retry-ai-btn");
  if (retryButton) return retryAiProcessing(retryButton.dataset.retryId);
  if (e.target.closest(".delete-btn")) return deleteBookmark(card.dataset.id);
  const item = state.visibleItems.find(b => b.id === card.dataset.id);
  if (item) chrome.tabs.create({ url: item.url });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.bookmarks) {
    state.bookmarks = Array.isArray(changes.bookmarks.newValue) ? changes.bookmarks.newValue : [];
    render();
  }
  if (area === "local" && changes.recycleBin) {
    state.recycleBin = purgeExpiredTrash(Array.isArray(changes.recycleBin.newValue) ? changes.recycleBin.newValue : []);
    render();
  }
  if (area === "local" && changes.pendingNativeDeletions) {
    state.pendingNativeDeletions = Array.isArray(changes.pendingNativeDeletions.newValue) ? changes.pendingNativeDeletions.newValue : [];
    showNextNativeDeletion();
  }
  if (area === "local" && changes.settings) {
    state.settings = changes.settings.newValue || {};
    const selected = els.category.value;
    const categories = [...new Set([...(state.settings.categories || DEFAULT_CATEGORIES), ...state.bookmarks.map(b => b.category).filter(Boolean)])];
    els.category.innerHTML = categories.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
    if (categories.includes(selected)) els.category.value = selected;
    updateModelStatus();
    render();
  }
});
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "native-bookmark-deleted") reloadPendingNativeDeletions();
});

init();
