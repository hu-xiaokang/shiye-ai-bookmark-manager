import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: null };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL("../category-colors.js", import.meta.url), "utf8"), context);

test("category colors remain stable and unique as categories are added", () => {
  const defaults = ["稍后阅读", "工作效率", "技术开发", "设计灵感", "学习资料", "生活兴趣", "新闻资讯", "工具服务"];
  const initial = context.CategoryColors.ensure(defaults, {}).colors;
  const expandedCategories = [...defaults, ...Array.from({ length: 32 }, (_, index) => `custom-${index}`)];
  const expanded = context.CategoryColors.ensure(expandedCategories, initial).colors;

  assert.equal(new Set(Object.values(expanded)).size, expandedCategories.length);
  for (const category of defaults) assert.equal(expanded[category], initial[category]);
});
