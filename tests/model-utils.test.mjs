import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: null };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL("../model-utils.js", import.meta.url), "utf8"), context);

test("long CJK content is compacted within budget while preserving page regions", () => {
  const start = "开头核心信息。".repeat(500);
  const middle = "中间关键内容。".repeat(500);
  const end = "结尾总结信息。".repeat(500);
  const result = context.ModelText.compactPageContent(start + middle + end, 2600);
  assert.equal(result.truncated, true);
  assert.ok(result.estimatedTokens <= 2600);
  assert.match(result.text, /开头核心信息/);
  assert.match(result.text, /中间关键内容/);
  assert.match(result.text, /结尾总结信息/);
  assert.ok(result.originalTokens > result.estimatedTokens * 2);
});

test("mixed-language sampling adapts when retained regions are token dense", () => {
  const denseStart = "中文高密度内容。".repeat(1200);
  const sparseRest = " lightweight-ascii-content".repeat(2000);
  const result = context.ModelText.compactPageContent(denseStart + sparseRest, 2600);
  assert.equal(result.truncated, true);
  assert.ok(result.estimatedTokens <= 2600);
  assert.match(result.text, /中文高密度内容/);
  assert.match(result.text, /lightweight-ascii-content/);
});

test("short content is unchanged and output budget matches model family", () => {
  const short = "A concise technical article about Redis data structures.";
  assert.equal(context.ModelText.compactPageContent(short, 2600).text, short);
  const standard = context.ModelText.withOutputBudget({ model: "gpt-4o-mini" }, "gpt-4o-mini", 320);
  const reasoning = context.ModelText.withOutputBudget({ model: "gpt-5-mini" }, "gpt-5-mini", 320);
  assert.equal(standard.max_tokens, 320);
  assert.equal(reasoning.max_completion_tokens, 320);
});
