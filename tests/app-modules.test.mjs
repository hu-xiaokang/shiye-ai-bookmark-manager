import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadContext(fetchImpl = async () => { throw new Error("unexpected request"); }) {
  const context = { globalThis: null, URL, fetch: fetchImpl };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ["model-utils.js", "app-utils.js", "ai-client.js"]) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context);
  }
  return context;
}

test("shared URL and response helpers preserve canonical bookmark behavior", () => {
  const { AppUtils } = loadContext();
  assert.equal(
    AppUtils.canonicalUrl("http://www.Example.com:80/docs/?utm_source=test&b=2&a=1#section"),
    "https://example.com/docs?a=1&b=2"
  );
  assert.equal(AppUtils.normalizeEndpoint("https://api.example.com/v1/"), "https://api.example.com/v1/chat/completions");
  assert.deepEqual(
    JSON.parse(JSON.stringify(AppUtils.parseModelJson("```json\n{\"category\":\"Tools\"}\n```"))),
    { category: "Tools" }
  );
  assert.equal(AppUtils.parseModelJson("not json"), null);
});

test("AI client applies model budgets and normalizes compatible endpoints", async () => {
  let captured = null;
  const context = loadContext(async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      async json() { return { choices: [{ message: { content: "done" } }], usage: { total_tokens: 3 } }; }
    };
  });
  const messages = context.AiClient.classificationMessages({
    english: true,
    candidateText: "Tools, Learning",
    title: "Example",
    url: "https://example.com",
    pageContent: "Useful content"
  });
  const body = context.AiClient.buildRequest({ model: "gpt-5-mini", messages, maxOutputTokens: 320 });
  const result = await context.AiClient.request({ apiUrl: "https://api.example.com/v1", apiKey: "test", body });
  assert.equal(body.max_completion_tokens, 320);
  assert.equal(captured.url, "https://api.example.com/v1/chat/completions");
  assert.equal(JSON.parse(captured.options.body).messages.length, 2);
  assert.equal(result.content, "done");
});
