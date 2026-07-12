(function (global) {
  const READ_LATER_LABEL = "稍后阅读";
  const UNCLASSIFIED_CATEGORY = "未分类";
  const DEFAULT_CATEGORIES = ["工作效率", "技术开发", "设计灵感", "学习资料", "生活兴趣", "新闻资讯", "工具服务"];

  function normalizeCategories(values) {
    const categories = [...new Set((Array.isArray(values) ? values : []).map(String).map(value => value.trim()).filter(Boolean))]
      .filter(category => category !== READ_LATER_LABEL && category !== UNCLASSIFIED_CATEGORY);
    return categories.length ? categories : [...DEFAULT_CATEGORIES];
  }

  function expiryTime(value) {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function isReadLaterActive(bookmark, now = Date.now()) {
    if (!bookmark?.readLater) return false;
    const expiresAt = expiryTime(bookmark.readLaterUntil);
    return expiresAt == null || expiresAt > now;
  }

  function compareReadLaterExpiry(left, right) {
    const leftExpiry = expiryTime(left?.readLaterUntil) ?? Number.POSITIVE_INFINITY;
    const rightExpiry = expiryTime(right?.readLaterUntil) ?? Number.POSITIVE_INFINITY;
    return leftExpiry - rightExpiry;
  }

  global.BookmarkModel = {
    READ_LATER_LABEL, UNCLASSIFIED_CATEGORY, DEFAULT_CATEGORIES,
    normalizeCategories, expiryTime, isReadLaterActive, compareReadLaterExpiry
  };
})(globalThis);
