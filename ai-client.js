(function (global) {
  function classificationMessages({ english = false, candidateText = "", title = "", url = "", pageContent = "" } = {}) {
    const unavailable = english
      ? "Page content is unavailable. Infer from the title and URL."
      : "正文暂时无法读取，请根据标题和网址判断。";
    return [
      {
        role: "system",
        content: english
          ? `Classify the bookmark into exactly one candidate ID. Also write 2-4 short English tags, a factual 40-90 word summary covering topic, key information and use, confidence from 0 to 1, and a brief uncertainty reason. JSON only: {"category":"exact identifier","tags":["tag"],"summary":"summary","confidence":0.0,"confidenceReason":"reason"}. Candidates: ${candidateText}`
          : `将网址归入且仅归入一个候选分类，并生成2-4个简短中文标签、60-120字事实性摘要（包含主题、主要信息和用途）、0到1的置信度及简短的不确定原因。只返回JSON：{"category":"分类","tags":["标签"],"summary":"摘要","confidence":0.0,"confidenceReason":"原因"}。候选分类：${candidateText}`
      },
      {
        role: "user",
        content: english
          ? `Title: ${title}\nURL: ${url}\nPage content:\n${pageContent || unavailable}`
          : `标题：${title}\n网址：${url}\n网页正文：\n${pageContent || unavailable}`
      }
    ];
  }

  function summaryMessages({ english = false, title = "", url = "", pageContent = "" } = {}) {
    return [
      {
        role: "system",
        content: english
          ? "Write a factual 40-90 word English summary covering the page's topic, key information, and use. No title, Markdown, or unsupported facts. Return only the summary."
          : "写一段60-120字的事实性中文摘要，包含网页主题、主要信息和用途。不要标题、Markdown或编造内容，只返回摘要。"
      },
      {
        role: "user",
        content: english
          ? `Page title: ${title}\nURL: ${url}\nPage content:\n${pageContent}`
          : `网页标题：${title}\n网页地址：${url}\n网页正文：\n${pageContent}`
      }
    ];
  }

  function buildRequest({ model, messages, maxOutputTokens, temperature = 0.2 }) {
    return global.ModelText.withOutputBudget({ model, temperature, messages }, model, maxOutputTokens);
  }

  function calculateConfidence({ modelConfidence, source = "title-url", contentLength = 0, categoryRecognized = true, hasSummary = true, hasTags = true } = {}) {
    let score = Number(modelConfidence);
    if (score > 1 && score <= 100) score /= 100;
    if (!Number.isFinite(score)) score = source === "open-tab" ? 0.82 : source === "public-fetch" ? 0.72 : 0.52;
    score = Math.max(0, Math.min(1, score));

    const length = Math.max(0, Number(contentLength) || 0);
    if (source === "title-url") score = Math.min(score, 0.55);
    else if (source === "public-fetch") score -= 0.04;

    if (length === 0) score = Math.min(score, 0.55);
    else if (length < 200) score -= 0.08;
    else if (length < 500) score -= 0.03;
    else if (length > 1500) score += 0.03;

    if (!categoryRecognized) score = Math.min(score, 0.35);
    if (!hasSummary || !hasTags) score = Math.min(score, 0.55);
    score = Math.round(Math.max(0, Math.min(0.98, score)) * 100) / 100;
    return { score, level: score < 0.6 ? "low" : score < 0.8 ? "medium" : "high" };
  }

  async function request({ apiUrl, apiKey, body }) {
    const response = await fetch(global.AppUtils.normalizeEndpoint(apiUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      let errorText = "";
      try { errorText = (await response.text()).slice(0, 160); } catch {}
      return { ok: false, status: response.status, errorText, data: null, content: "" };
    }
    const data = await response.json();
    return { ok: true, status: response.status, errorText: "", data, content: data.choices?.[0]?.message?.content || "" };
  }

  global.AiClient = { classificationMessages, summaryMessages, buildRequest, calculateConfidence, request };
})(globalThis);
