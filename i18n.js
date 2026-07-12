(function (global) {
  const resources = {
    "zh-CN": {},
    en: {
      "拾页": "ShiYe",
      "AI 智能书签": "AI Bookmark Manager",
      "收藏当前页": "Save current page",
      "网站导航": "Website navigation",
      "回收站": "Trash",
      "查看最近 30 天删除的收藏": "View bookmarks deleted in the last 30 days",
      "设置": "Settings",
      "模型、分类与数据设置": "Model, category, and data settings",
      "全部网站": "All websites",
      "0 个收藏": "0 bookmarks",
      "全库搜索": "Search all",
      "搜索标题、摘要、标签或域名": "Search titles, summaries, tags, or domains",
      "搜索全部收藏": "Search all bookmarks",
      "清空搜索": "Clear search",
      "这里还没有网站": "No websites here yet",
      "收藏当前网页，或切换其他分类看看": "Save the current page or choose another category",
      "关闭": "Close",
      "新建收藏": "New bookmark",
      "编辑收藏": "Edit bookmark",
      "收藏当前网页": "Save current page",
      "修改收藏信息": "Edit bookmark details",
      "网页标题": "Page title",
      "保存到分类": "Save to category",
      "AI 分类": "AI classify",
      "AI 智能分类": "AI classification",
      "生成摘要": "Generate summary",
      "内容摘要": "Summary",
      "点击“生成摘要”，AI 将读取当前网页正文并提炼内容": "Click Generate summary and AI will summarize the page content",
      "内容标签": "Tags",
      "使用逗号分隔，例如：Redis，数据结构，后端开发": "Comma-separated, e.g. Redis, data structures, backend",
      "未配置模型": "Model not configured",
      "确认收藏": "Save bookmark",
      "浏览器书签联动": "Browser bookmark sync",
      "是否同时删除拾页收藏？": "Also delete the ShiYe bookmark?",
      "你刚刚从 Chrome 书签中删除了：": "You just removed this Chrome bookmark:",
      "选择保留后，它只会从浏览器书签中移除，拾页收藏不受影响。": "If kept, only the Chrome bookmark is removed; the ShiYe bookmark remains.",
      "在拾页保留": "Keep in ShiYe",
      "同时删除": "Delete both",
      "发现重复网址": "Duplicate URL found",
      "这个网页已经收藏过": "This page is already saved",
      "可以打开已有收藏，或将本次填写的分类、标签和摘要合并进去。": "Open the existing bookmark or merge the new category, tags, and summary.",
      "取消": "Cancel",
      "打开已有收藏": "Open existing",
      "合并信息": "Merge details",
      "拾页设置": "ShiYe Settings",
      "模型配置": "Model",
      "默认行为": "Defaults",
      "用量统计": "Usage",
      "分类管理": "Categories",
      "数据管理": "Data",
      "所有配置与收藏仅保存在本机浏览器中。": "All settings and bookmarks are stored only in this browser.",
      "让拾页更懂你": "Make ShiYe work your way",
      "连接你信任的大模型，用它自动整理每一个收藏。": "Connect a model you trust to organize every bookmark automatically.",
      "界面语言": "Interface language",
      "跟随浏览器": "Follow browser",
      "简体中文": "简体中文",
      "英文": "English",
      "选择界面语言，修改后立即生效": "Choose the interface language; changes apply immediately",
      "大模型配置": "AI model configuration",
      "支持 OpenAI Chat Completions 兼容接口": "Supports OpenAI Chat Completions-compatible APIs",
      "可填写服务根地址、/v1 地址或完整的 /chat/completions 地址": "Enter a service root, /v1 path, or full /chat/completions endpoint",
      "显示": "Show",
      "隐藏": "Hide",
      "模型名称": "Model name",
      "测试连接": "Test connection",
      "保存配置": "Save settings",
      "控制收藏与浏览器原生书签联动方式": "Control bookmark automation and Chrome bookmark synchronization",
      "自动智能分类和摘要": "Automatic AI classification and summaries",
      "收藏新网址时，自动调用已配置模型完成分类、标签和内容摘要": "Automatically classify, tag, and summarize newly saved pages",
      "原生书签删除时自动删除": "Delete automatically with Chrome bookmarks",
      "从 Chrome 书签删除后，同时删除对应的拾页收藏；关闭后改为弹窗确认": "When a Chrome bookmark is removed, also delete its ShiYe bookmark; turn off to ask first",
      "AI 整理队列": "AI processing queue",
      "正在统计待处理收藏…": "Checking pending bookmarks…",
      "重新处理失败与缺失内容": "Retry failed and incomplete items",
      "模型用量统计": "Model usage",
      "统计所有手动与自动模型调用，仅保存在本机": "Tracks manual and automatic model calls locally",
      "刷新": "Refresh",
      "请求次数": "Requests",
      "总 Token": "Total tokens",
      "输入 Token": "Input tokens",
      "输出 Token": "Output tokens",
      "今日": "Today",
      "估算节省": "Estimated saved",
      "成功/失败": "Success / failure",
      "最后调用": "Last used",
      "暂无": "None",
      "按功能统计": "By feature",
      "请求 / Token": "Requests / tokens",
      "部分兼容接口不返回 Token 用量，此时只统计请求次数。": "Some compatible APIs do not report token usage; only requests are counted in that case.",
      "清空统计": "Clear usage",
      "AI 会从这些分类中选择最合适的一项": "AI selects the best match from these categories",
      "新增一个分类": "Add a category",
      "添加": "Add",
      "备份或迁移你的收藏与设置": "Back up or migrate bookmarks and settings",
      "备份中包含 API Key": "Include API key in backup",
      "默认关闭。仅在备份文件由你安全保管时开启。": "Off by default. Enable only if you can store the backup securely.",
      "安全导出 JSON": "Export safe JSON",
      "选择备份文件": "Choose backup file",
      "恢复上次安全快照": "Restore latest safety snapshot",
      "清空收藏": "Clear bookmarks",
      "导入预检": "Import preview",
      "合并导入": "Merge import",
      "覆盖恢复": "Replace and restore",
      "全部": "All",
      "常用网址": "Frequently visited",
      "最近浏览": "Recently visited",
      "收藏分类": "Bookmark categories",
      "搜索收藏": "Search bookmarks",
      "稍后阅读": "Read later",
      "工作效率": "Productivity",
      "技术开发": "Development",
      "设计灵感": "Design",
      "学习资料": "Learning",
      "生活兴趣": "Lifestyle",
      "新闻资讯": "News",
      "工具服务": "Tools",
      "未分类": "Uncategorized",
      "恢复收藏": "Restore bookmark",
      "恢复": "Restore",
      "彻底删除": "Delete permanently",
      "删除": "Delete",
      "重新进行 AI 整理": "Retry AI processing",
      "没有找到匹配的网址": "No matching websites",
      "试试更短的关键词，或搜索摘要、标签和域名": "Try a shorter query or search summaries, tags, and domains",
      "等待整理": "Waiting for AI",
      "AI 整理中": "AI processing",
      "AI 已整理": "AI processed",
      "整理失败": "AI failed",
      "正在分析…": "Analyzing…",
      "正在读取…": "Reading…",
      "正在总结…": "Summarizing…",
      "更新这个收藏": "Update bookmark",
      "保存修改": "Save changes",
      "已收藏 ✓": "Saved ✓",
      "撤销": "Undo",
      "自动分类与摘要": "Automatic classification and summary",
      "手动 AI 分类": "Manual AI classification",
      "单独生成摘要": "Summary generation",
      "模型连接测试": "Model connection test"
      ,"默认行为已更新": "Default behavior updated"
      ,"请完整填写模型配置": "Complete the model configuration"
      ,"配置已保存": "Settings saved"
      ,"正在连接模型…": "Connecting to model…"
      ,"请先完整填写模型配置": "Complete the model configuration first"
      ,"模型用量统计已清空": "Model usage statistics cleared"
      ,"请先完成模型配置": "Complete the model configuration first"
      ,"正在批量处理…": "Processing…"
      ,"批量处理失败": "Batch processing failed"
      ,"这个分类已经存在": "This category already exists"
      ,"至少保留一个分类": "Keep at least one category"
      ,"请输入现有的目标分类": "Enter an existing target category"
      ,"分类已删除": "Category deleted"
      ,"备份已导出，请安全保管其中的 API Key": "Backup exported. Store the included API key securely."
      ,"安全备份已导出（不含 API Key）": "Safe backup exported without the API key"
      ,"备份文件格式不正确": "Invalid backup file format"
      ,"备份版本高于当前插件，请升级后再导入": "This backup requires a newer extension version"
      ,"此备份包含 API Key。导入后会保存到当前浏览器。": "This backup includes an API key, which will be stored in this browser."
      ,"此备份不包含 API Key，将保留当前浏览器中的模型密钥。": "This backup has no API key; the current browser key will be kept."
      ,"导入失败": "Import failed"
      ,"暂无可恢复的安全快照": "No safety snapshot is available"
      ,"安全快照已恢复": "Safety snapshot restored"
      ,"所有收藏已移入回收站": "All bookmarks moved to trash"
      ,"当前页面不支持收藏": "This page cannot be bookmarked"
      ,"请打开一个普通网页后再试": "Open a regular webpage and try again"
      ,"请先配置模型 URL、Key 和模型名": "Configure the model URL, key, and model name first"
      ,"请输入有效的 HTTP 或 HTTPS 网址": "Enter a valid HTTP or HTTPS URL"
      ,"AI 分类完成": "AI classification complete"
      ,"分类失败，请检查模型配置": "Classification failed; check the model settings"
      ,"未能读取当前页面正文": "Could not read the current page"
      ,"内容摘要已生成": "Summary generated"
      ,"摘要生成失败": "Summary generation failed"
      ,"请填写有效的标题和网址": "Enter a valid title and URL"
      ,"正在智能整理…": "Organizing…"
      ,"收藏信息已更新": "Bookmark updated"
      ,"收藏成功": "Bookmark saved"
      ,"已移至回收站": "Moved to trash"
      ,"重复收藏已合并": "Duplicate bookmarks merged"
      ,"这条收藏已不在回收站": "This bookmark is no longer in trash"
      ,"相同网址已存在，请先处理重复收藏": "The same URL already exists; resolve the duplicate first"
      ,"收藏已恢复": "Bookmark restored"
      ,"已彻底删除": "Permanently deleted"
      ,"已加入 AI 整理队列": "Added to the AI processing queue"
      ,"无法启动 AI 整理任务": "Could not start AI processing"
      ,"未找到这条收藏": "Bookmark not found"
      ,"已同时移至拾页回收站": "Also moved to ShiYe trash"
      ,"已在拾页保留": "Kept in ShiYe"
      ,"书签整理": "Bookmark organizer"
      ,"一键整理 Chrome 书签": "Organize Chrome bookmarks"
      ,"扫描现有原生书签，去重后批量生成分类、标签和摘要": "Scan existing Chrome bookmarks, remove duplicates, and generate categories, tags, and summaries"
      ,"开始扫描": "Start scan"
      ,"不会直接修改 Chrome 原生书签": "Chrome bookmarks will not be modified"
      ,"导入前会建立安全快照；重复网址只建立关联，不会生成重复收藏。": "A safety snapshot is created first. Duplicate URLs are linked instead of creating duplicate bookmarks."
      ,"原生书签": "Chrome bookmarks"
      ,"新增收藏": "New bookmarks"
      ,"已有收藏": "Existing bookmarks"
      ,"重复网址": "Duplicate URLs"
      ,"仅导入并关联": "Import and link only"
      ,"导入并使用 AI 整理": "Import and organize with AI"
      ,"正在整理 Chrome 书签": "Organizing Chrome bookmarks"
      ,"停止任务": "Stop task"
      ,"重新扫描": "Scan again"
      ,"正在扫描…": "Scanning…"
      ,"打开低置信度网页时自动重新整理": "Reorganize low-confidence bookmarks when opened"
      ,"当网页正文可读取时重新生成分类、标签和摘要；每条收藏最多自动复核一次": "Regenerate the category, tags, and summary when page content becomes available; each bookmark is reviewed automatically at most once"
      ,"低置信度阈值": "Low-confidence threshold"
      ,"低于 50%": "Below 50%"
      ,"低于 60%": "Below 60%"
      ,"低于 70%": "Below 70%"
    }
  };

  const supported = ["zh-CN", "en"];
  let language = "zh-CN";

  function normalizeLanguage(value) {
    if (value === "auto" || !value) value = navigator.language || "zh-CN";
    const lower = String(value).toLowerCase();
    return lower.startsWith("zh") ? "zh-CN" : lower.startsWith("en") ? "en" : "zh-CN";
  }

  function interpolate(text, params = {}) {
    return String(text).replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`);
  }

  function t(source, params) {
    const translated = resources[language]?.[source] || source;
    return interpolate(translated, params);
  }

  function translateDocument(root = document) {
    document.documentElement.lang = language;
    const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (["SCRIPT", "STYLE"].includes(node.parentElement?.tagName)) continue;
      const raw = node.nodeValue || "";
      const trimmed = raw.trim();
      if (!trimmed || !resources[language]?.[trimmed]) continue;
      node.nodeValue = raw.replace(trimmed, t(trimmed));
    }
    root.querySelectorAll?.("[placeholder], [title], [aria-label]").forEach(element => {
      for (const attr of ["placeholder", "title", "aria-label"]) {
        const value = element.getAttribute(attr);
        if (value) element.setAttribute(attr, t(value));
      }
    });
    if (document.title) document.title = t(document.title);
  }

  async function init(settings) {
    if (!settings) {
      const data = await chrome.storage.local.get("settings");
      settings = data.settings || {};
    }
    language = normalizeLanguage(settings.language || "auto");
    translateDocument();
    return language;
  }

  global.I18n = {
    resources, supported, t, init, translateDocument,
    get language() { return language; },
    normalizeLanguage,
    languageName(code) { return code === "en" ? "English" : "简体中文"; }
  };
})(globalThis);
