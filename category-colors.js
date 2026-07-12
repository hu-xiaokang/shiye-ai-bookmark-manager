(function (global) {
  // Ordered as a broad candidate pool; assignment uses perceptual distance, not list order.
  const PALETTE = [
    "#6D28D9", "#007A6C", "#2563EB", "#D61F69", "#B7791F", "#16803D",
    "#E65300", "#475569", "#0891B2", "#A21CAF", "#65A30D", "#BE123C",
    "#4F46E5", "#0F766E", "#C2410C", "#0369A1", "#9333EA", "#3F6212",
    "#9F1239", "#0E7490", "#854D0E", "#1D4ED8", "#9D174D", "#166534"
  ];
  const BUILT_IN_COLORS = {
    "稍后阅读": "#7C3AED",
    "工作效率": "#007A6C",
    "技术开发": "#2563EB",
    "设计灵感": "#D61F69",
    "学习资料": "#A16207",
    "生活兴趣": "#16A34A",
    "新闻资讯": "#DC2626",
    "工具服务": "#475569"
  };

  function hslToHex(hue, saturation, lightness) {
    const s = saturation / 100, l = lightness / 100;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const section = hue / 60;
    const x = chroma * (1 - Math.abs(section % 2 - 1));
    const [r1, g1, b1] = section < 1 ? [chroma, x, 0] : section < 2 ? [x, chroma, 0]
      : section < 3 ? [0, chroma, x] : section < 4 ? [0, x, chroma]
      : section < 5 ? [x, 0, chroma] : [chroma, 0, x];
    const match = l - chroma / 2;
    return rgbToHex([(r1 + match) * 255, (g1 + match) * 255, (b1 + match) * 255]);
  }

  const GENERATED = Array.from({ length: 48 }, (_, index) =>
    hslToHex((index * 137.508 + 17) % 360, index % 2 ? 68 : 76, index % 3 === 0 ? 38 : index % 3 === 1 ? 48 : 58)
  );
  const CANDIDATES = [...new Set([...PALETTE, ...GENERATED])];

  function hash(value = "") {
    let result = 2166136261;
    for (const char of String(value)) {
      result ^= char.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function hexToRgb(hex) {
    const value = String(hex).replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(value)) return null;
    return [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
  }

  function rgbToHex(rgb) {
    return `#${rgb.map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }

  function mix(hex, target, amount) {
    const sourceRgb = hexToRgb(hex) || [71, 85, 105];
    const targetRgb = hexToRgb(target) || [255, 255, 255];
    return rgbToHex(sourceRgb.map((value, index) => value + (targetRgb[index] - value) * amount));
  }

  function toOklab(hex) {
    const rgb = (hexToRgb(hex) || [71, 85, 105]).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    const l = 0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2];
    const m = 0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2];
    const s = 0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2];
    const lRoot = Math.cbrt(l), mRoot = Math.cbrt(m), sRoot = Math.cbrt(s);
    return [
      0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
      1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
      0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot
    ];
  }

  function distance(first, second) {
    const a = toOklab(first), b = toOklab(second);
    return Math.hypot((a[0] - b[0]) * 1.35, a[1] - b[1], a[2] - b[2]);
  }

  function isColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || ""));
  }

  function ensure(categories = [], stored = {}) {
    const unique = [...new Set(categories.map(value => String(value || "").trim()).filter(Boolean))];
    const colors = {};
    const used = [];
    for (const category of unique) {
      if (!isColor(stored[category])) continue;
      const storedColor = String(stored[category]).toUpperCase();
      if (used.includes(storedColor)) continue;
      colors[category] = storedColor;
      used.push(colors[category]);
    }

    for (const category of unique) {
      const preferred = BUILT_IN_COLORS[category];
      if (colors[category] || !preferred || used.includes(preferred)) continue;
      colors[category] = preferred;
      used.push(preferred);
    }

    for (const category of unique) {
      if (colors[category]) continue;
      const unused = CANDIDATES.filter(color => !used.includes(color));
      const candidates = unused.length ? unused : CANDIDATES;
      const start = hash(category) % candidates.length;
      let best = candidates[start];
      let bestDistance = -1;
      for (let offset = 0; offset < candidates.length; offset += 1) {
        const candidate = candidates[(start + offset) % candidates.length];
        const nearest = used.length ? Math.min(...used.map(color => distance(candidate, color))) : 1;
        if (nearest > bestDistance) {
          best = candidate;
          bestDistance = nearest;
        }
      }
      colors[category] = best;
      used.push(best);
    }

    const changed = unique.some(category => colors[category] !== String(stored[category] || "").toUpperCase())
      || Object.keys(stored || {}).some(category => !unique.includes(category));
    return { colors, changed };
  }

  function cssVariables(color) {
    const base = isColor(color) ? String(color).toUpperCase() : "#475569";
    return [
      `--category-color:${base}`,
      `--category-text:${mix(base, "#111827", 0.52)}`,
      `--category-bg:${mix(base, "#FFFFFF", 0.9)}`,
      `--category-border:${mix(base, "#FFFFFF", 0.68)}`,
      `--category-ring:${mix(base, "#FFFFFF", 0.78)}`
    ].join(";");
  }

  global.CategoryColors = { VERSION: 1, PALETTE, ensure, cssVariables, distance };
})(globalThis);
