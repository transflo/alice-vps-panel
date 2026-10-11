'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { inlineScriptHashes, buildCsp, BASE_DIRECTIVES } = require('../csp');

const sha = (text) => `sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}`;

test('内联脚本：按标签之间的原文（含空白换行）计算 sha256', () => {
  const body = '\n  window.__x = 1;\n';
  assert.deepEqual(inlineScriptHashes(`<html><script>${body}</script></html>`), [sha(body)]);
});

test('带 src 的外部脚本不算；JSON 数据块（type=application/json）不算', () => {
  const html = [
    '<script src="/_next/static/a.js" async></script>',
    '<script id="d" type="application/json">{"a":1}</script>',
    '<script type="application/ld+json">{}</script>',
    '<script>run()</script>',
  ].join('');
  assert.deepEqual(inlineScriptHashes(html), [sha('run()')]);
});

test('属性顺序、大小写、type=module 都能识别；空脚本不算；相同内容去重', () => {
  const html = '<SCRIPT nonce="x">a()</SCRIPT><script type="module">b()</script><script></script><script>a()</script>';
  assert.deepEqual(inlineScriptHashes(html), [sha('a()'), sha('b()')]);
});

test('没有任何内联脚本时返回空数组', () => {
  assert.deepEqual(inlineScriptHashes('<p>hi</p><script src="x.js"></script>'), []);
});

test('buildCsp：没有哈希时 script-src 只有 self，且永远不含 unsafe-inline / unsafe-eval', () => {
  const csp = buildCsp([]);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe/);
});

test('buildCsp：把每个哈希加进 script-src，其余指令保持不变', () => {
  const csp = buildCsp([sha('a()'), sha('b()')]);
  const scriptSrc = csp.match(/script-src[^;]*/)[0];
  assert.equal(scriptSrc, `script-src 'self' '${sha('a()')}' '${sha('b()')}'`);
  for (const d of BASE_DIRECTIVES.filter((x) => !x.startsWith('script-src'))) assert.ok(csp.includes(d), d);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /default-src 'self'/);
});
