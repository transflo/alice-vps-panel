'use strict';

// Alice 客户端的两处 fail-closed 行为：地址不安全就绝不发凭据、上游响应边读边数。

const { test } = require('node:test');
const assert = require('node:assert/strict');

// 用指定环境变量装载一份全新的 alice 模块（该模块在 require 时读 env）。
function freshAlice(env) {
  const id = require.resolve('../alice');
  delete require.cache[id];
  const saved = new Map();
  for (const [k, v] of Object.entries(env)) {
    saved.set(k, process.env[k]);
    process.env[k] = v;
  }
  try {
    return require('../alice');
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const CREDS = { ALICE_CLIENT_ID: 'cli_test', ALICE_SECRET: 'secret' };

test('baseError：明文 http 指向外部主机、带账号口令、非法 URL、不支持的协议都算不安全', () => {
  assert.match(freshAlice({ ...CREDS, ALICE_API_BASE: 'http://alice.example' }).baseError(), /明文/);
  assert.match(freshAlice({ ...CREDS, ALICE_API_BASE: 'https://user:pw@alice.example' }).baseError(), /账号口令/);
  assert.match(freshAlice({ ...CREDS, ALICE_API_BASE: 'ftp://alice.example' }).baseError(), /协议/);
  assert.match(freshAlice({ ...CREDS, ALICE_API_BASE: '::::' }).baseError(), /不是合法 URL/);
});

test('baseError：https 地址与回环 http（测试用）是安全的', () => {
  assert.equal(freshAlice({ ...CREDS, ALICE_API_BASE: 'https://app.alice.ws/cli/v1' }).baseError(), null);
  assert.equal(freshAlice({ ...CREDS, ALICE_API_BASE: 'http://127.0.0.1:8080' }).baseError(), null);
  assert.equal(freshAlice({ ...CREDS, ALICE_API_BASE: 'http://localhost:8080' }).baseError(), null);
});

test('ALICE_API_BASE 不安全时请求被拒绝，一个字节都不发出去', async () => {
  const alice = freshAlice({ ...CREDS, ALICE_API_BASE: 'http://alice.example' });
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return new Response('{}'); };
  try {
    await assert.rejects(() => alice.profile(), /已拒绝发送请求/);
    assert.equal(called, false, '不该发出任何请求');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('ALICE_TIMEOUT_MS 非法时回退默认值并警告，不会把每个请求变成 500', async () => {
  const warns = [];
  const realWarn = console.warn;
  console.warn = (m) => warns.push(String(m));
  let alice;
  try {
    alice = freshAlice({ ...CREDS, ALICE_API_BASE: 'http://127.0.0.1:9', ALICE_TIMEOUT_MS: '-1' });
  } finally {
    console.warn = realWarn;
  }
  assert.ok(warns.some((m) => /ALICE_TIMEOUT_MS/.test(m)), '非法值应给出警告');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    throw err;
  };
  try {
    // 修复前 AbortSignal.timeout(-1) 会抛 RangeError（delay out of range），每个请求都变 500
    await assert.rejects(() => alice.profile(), /无法连接 Alice API/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('上游响应超过 2 MiB：边读边数，超限即断开，不把整个 body 读进内存', async () => {
  const alice = freshAlice({ ...CREDS, ALICE_API_BASE: 'http://127.0.0.1:9' });
  const realFetch = globalThis.fetch;
  const chunk = new Uint8Array(64 * 1024).fill(0x41);
  const total = 8 * 1024 * 1024;
  let produced = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      if (produced >= total) {
        controller.close();
        return;
      }
      produced += chunk.length;
      controller.enqueue(chunk);
    },
    cancel() { cancelled = true; },
  });
  globalThis.fetch = async () => new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(() => alice.profile(), /内容过大/);
    assert.equal(cancelled, true, '超限后应取消上游读取');
    assert.ok(produced < total, `不应读完全部 ${total} 字节（实际读入 ${produced}）`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
