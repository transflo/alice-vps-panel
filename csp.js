'use strict';

// 内容安全策略（CSP）：脚本只允许同源文件，外加"这个页面里内联脚本"的 sha256 哈希。
// Next.js 静态导出的 HTML 带有内联脚本（主题初始化、数据载荷），所以不能只写 script-src 'self'；
// 但也不使用 'unsafe-inline'：哈希在启动时从要发送的 HTML 原文里算出，注入进页面的脚本哈希对不上，仍然会被浏览器拦截。

const crypto = require('node:crypto');

// 样式需要 'unsafe-inline'：Sonner 等组件会在运行时插入 <style>。
const BASE_DIRECTIVES = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
];

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
// 数据块（<script type="application/json">）不会被执行，不需要哈希。
const DATA_BLOCK_RE = /\btype\s*=\s*["']?application\/(?:ld\+)?json\b/i;

// 返回 HTML 里所有内联脚本的 CSP 哈希（'sha256-…' 里面的部分），按首次出现的顺序、去重。
function inlineScriptHashes(html) {
  const seen = new Set();
  for (const [, attrs, body] of String(html).matchAll(SCRIPT_RE)) {
    if (/\bsrc\s*=/i.test(attrs) || DATA_BLOCK_RE.test(attrs) || body.trim() === '') continue;
    seen.add(`sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}`);
  }
  return [...seen];
}

// hashes 来自 inlineScriptHashes；空数组表示这个响应不允许任何内联脚本。
function buildCsp(hashes = []) {
  return BASE_DIRECTIVES.map((d) => (d.startsWith('script-src') ? [d, ...hashes.map((h) => `'${h}'`)].join(' ') : d)).join('; ');
}

module.exports = { BASE_DIRECTIVES, inlineScriptHashes, buildCsp };
