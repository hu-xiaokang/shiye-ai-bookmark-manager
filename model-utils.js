(function (global) {
  function estimateTokens(value = "") {
    const text = String(value);
    const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const remaining = Math.max(0, text.length - cjk);
    return Math.max(1, Math.ceil(cjk * 1.05 + remaining / 4));
  }

  function compactPageContent(value = "", maxTokens = 2600) {
    const text = String(value).replace(/\s+/g, " ").trim();
    const originalTokens = estimateTokens(text);
    if (!text || originalTokens <= maxTokens) {
      return { text, originalTokens, estimatedTokens: originalTokens, truncated: false };
    }

    function sample(targetChars) {
      const startLength = Math.floor(targetChars * 0.55);
      const middleLength = Math.floor(targetChars * 0.27);
      const endLength = Math.max(0, targetChars - startLength - middleLength);
      const middleStart = Math.max(startLength, Math.floor((text.length - middleLength) / 2));
      return [
        text.slice(0, startLength),
        text.slice(middleStart, middleStart + middleLength),
        text.slice(Math.max(middleStart + middleLength, text.length - endLength))
      ].filter(Boolean).join(" … ");
    }

    let targetChars = Math.max(300, Math.floor(text.length * maxTokens / originalTokens * 0.94));
    let compacted = sample(targetChars);
    let estimatedTokens = estimateTokens(compacted);
    for (let attempt = 0; estimatedTokens > maxTokens && attempt < 4; attempt += 1) {
      targetChars = Math.max(300, Math.floor(targetChars * maxTokens / estimatedTokens * 0.96));
      compacted = sample(targetChars);
      estimatedTokens = estimateTokens(compacted);
    }
    return {
      text: compacted,
      originalTokens,
      estimatedTokens,
      truncated: true
    };
  }

  function compactField(value = "", maxLength = 800) {
    const text = String(value).trim();
    if (text.length <= maxLength) return text;
    const side = Math.floor((maxLength - 3) / 2);
    return `${text.slice(0, side)}...${text.slice(-side)}`;
  }

  function fingerprint(value = "") {
    let hash = 2166136261;
    for (const char of String(value)) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function withOutputBudget(payload, model, maxTokens) {
    const next = { ...payload };
    const field = /^(o[134](?:-|$)|gpt-5(?:-|$))/i.test(String(model || "")) ? "max_completion_tokens" : "max_tokens";
    next[field] = maxTokens;
    return next;
  }

  global.ModelText = { estimateTokens, compactPageContent, compactField, fingerprint, withOutputBudget };
})(globalThis);
