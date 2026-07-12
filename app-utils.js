(function (global) {
  function canonicalUrl(value = "") {
    try {
      const url = new URL(value);
      url.protocol = "https:";
      url.port = "";
      url.hash = "";
      url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
      const tracking = /^(utm_[a-z]+|fbclid|gclid|yclid|mc_[a-z]+|ref|referrer|source)$/i;
      [...url.searchParams.keys()].forEach(key => { if (tracking.test(key)) url.searchParams.delete(key); });
      url.searchParams.sort();
      return url.toString();
    } catch { return String(value).replace(/#.*$/, "").replace(/\/+$/, ""); }
  }

  function normalizeEndpoint(value = "") {
    const clean = String(value).trim().replace(/\/$/, "");
    if (/\/chat\/completions$/i.test(clean)) return clean;
    return /\/v1$/i.test(clean) ? `${clean}/chat/completions` : `${clean}/v1/chat/completions`;
  }

  function parseModelJson(content = "") {
    const cleaned = String(content).replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }

  function isWebUrl(value = "") {
    return /^https?:\/\//i.test(String(value));
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  global.AppUtils = { canonicalUrl, normalizeEndpoint, parseModelJson, isWebUrl, escapeHtml };
})(globalThis);
