(function (global) {
  function readDocumentText() {
    const meta = document.querySelector('meta[name="description"], meta[property="og:description"]')?.content || "";
    const source = document.querySelector("article, main, [role='main']") || document.body;
    if (!source) return meta;
    const copy = source.cloneNode(true);
    copy.querySelectorAll("script, style, noscript, svg, canvas, iframe, nav, header, footer, aside, form, button").forEach(node => node.remove());
    const text = (copy.innerText || copy.textContent || "").replace(/\s+/g, " ").trim();
    return [meta, text].filter(Boolean).join("\n").slice(0, 10_000);
  }

  async function extractOpenPageContent(url) {
    try {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(item => item.id && global.AppUtils.canonicalUrl(item.url) === global.AppUtils.canonicalUrl(url));
      if (!tab) return "";
      const [{ result = "" } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: readDocumentText
      });
      return result;
    } catch { return ""; }
  }

  function isPublicPageUrl(value) {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) return false;
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1") return false;
      if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(host)) return false;
      const parts = host.split(".").map(Number);
      if (parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)) {
        if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return false;
        if (parts[0] === 169 && parts[1] === 254) return false;
        if (parts[0] === 192 && parts[1] === 168) return false;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
      }
      return true;
    } catch { return false; }
  }

  function htmlToPlainText(html = "") {
    const description = String(html).match(/<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']+)["']/i)?.[1] || "";
    const text = String(html)
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|canvas|iframe|nav|header|footer|aside|form|button)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Math.min(0x10ffff, Number(value) || 32)))
      .replace(/\s+/g, " ").trim();
    return [description, text].filter(Boolean).join("\n").slice(0, 10_000);
  }

  async function fetchPublicPageContent(url) {
    if (!isPublicPageUrl(url)) return "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      let currentUrl = url;
      let response = null;
      for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
        if (!isPublicPageUrl(currentUrl)) return "";
        response = await fetch(currentUrl, {
          method: "GET", credentials: "omit", redirect: "manual", signal: controller.signal,
          headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.8" }
        });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        if (!location || redirectCount === 3) return "";
        currentUrl = new URL(location, currentUrl).toString();
      }
      if (!response) return "";
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) return "";
      const html = (await response.text()).slice(0, 500_000);
      return contentType.includes("text/plain") ? html.replace(/\s+/g, " ").trim().slice(0, 10_000) : htmlToPlainText(html);
    } catch { return ""; }
    finally { clearTimeout(timeout); }
  }

  async function extractPageContext(url) {
    const openContent = await extractOpenPageContent(url);
    if (openContent) return { content: openContent, source: "open-tab" };
    const publicContent = await fetchPublicPageContent(url);
    return publicContent ? { content: publicContent, source: "public-fetch" } : { content: "", source: "title-url" };
  }

  global.PageContent = { extractOpenPageContent, extractPageContext, isPublicPageUrl, htmlToPlainText, fetchPublicPageContent };
})(globalThis);
