'use strict';

// GitHub 代码扫描（CodeQL）报的 5 条告警的回归测试。
// 每条都对应一处具体的行为改变，不是"读一遍代码确认没问题"。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inlineScriptHashes } = require('../csp');
const { loadConfig } = require('../config');
const { createTelegram } = require('../telegram');
const T = require('../telegram-config');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alice-alerts-'));

// ---------- csp.js：结束标签的正则 ----------

test('CSP：</script 后带空白/属性的结束标签也要认，否则两段脚本会被并成一段', () => {
  // 浏览器把 `</script\t\n bar>` 当成脚本结束（HTML 规范：标签名后跟空白、"/" 或 ">" 即结束标签）。
  // 老正则 `<\/script\s*>` 认不出来，会把这两段脚本当成一整段，算出的哈希和浏览器实际执行的对不上。
  const html = '<script>first()</script\t\n bar><script>second()</script>';
  const hashes = inlineScriptHashes(html);
  assert.equal(hashes.length, 2, '应该是两段脚本，两个哈希');
  assert.equal(new Set(hashes).size, 2, '两个哈希必须不同（说明没被并成一段）');

  // 正常的写法仍然只算一个
  assert.equal(inlineScriptHashes('<script>only()</script>').length, 1);
  // 带属性的结束标签
  assert.equal(inlineScriptHashes('<script>a()</script ><script>b()</script>').length, 2);
  // 自闭合的结束标签
  assert.equal(inlineScriptHashes('<script>a()</script/><script>b()</script>').length, 2);
  // 带 src 的、空 body 的、JSON 数据块的不算
  assert.equal(inlineScriptHashes('<script src="/a.js"></script><script></script><script type="application/json">{}</script>').length, 0);
});

// ---------- config.js：警告里不回显环境变量的原始值 ----------

test('配置警告不回显原始值：带账号口令的地址不会把口令抄进日志', () => {
  const warns = [];
  const cfg = loadConfig(
    { TELEGRAM_API_BASE: 'https://user:s3cr3t-pw@example.com', TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_ALLOWED_USER_IDS: '1' },
    (m) => warns.push(m),
  );
  const log = warns.join('\n');
  assert.ok(warns.length > 0, '应该给出警告');
  assert.ok(!log.includes('s3cr3t-pw'), `日志里泄露了口令：${log}`);
  assert.ok(!log.includes('user:'), `日志里泄露了用户名：${log}`);
  assert.match(log, /TELEGRAM_API_BASE/, '仍然要指出是哪个变量有问题');
  assert.equal(cfg.telegram.apiBase, 'https://api.telegram.org', '回退到默认地址');
});

test('配置警告不回显原始值：整数与时区变量也只报变量名和约束', () => {
  const warns = [];
  loadConfig(
    { AUTO_RENEW_BEFORE_MINUTES: 'not-a-number', DISPLAY_TIME_ZONE: 'Not/AZone' },
    (m) => warns.push(m),
  );
  const log = warns.join('\n');
  assert.match(log, /AUTO_RENEW_BEFORE_MINUTES/);
  assert.match(log, /DISPLAY_TIME_ZONE/);
  assert.ok(!log.includes('not-a-number'), `回显了原始值：${log}`);
  assert.ok(!log.includes('Not/AZone'), `回显了原始值：${log}`);
});

// ---------- telegram.js：请求地址不会离开配置的 apiBase ----------

const okFetch = (seen) => async (url) => {
  seen.push(String(url));
  return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
};

test('Telegram 客户端：token 里的 ":" 不会被当成 URL 协议名（真实 token 都带冒号）', async () => {
  const seen = [];
  const tg = createTelegram({ token: '123456:ABC-DEF_ghi', apiBase: 'https://api.telegram.org', fetch: okFetch(seen) });
  await tg.call('sendMessage', {});
  assert.deepEqual(seen, ['https://api.telegram.org/bot123456:ABC-DEF_ghi/sendMessage']);
});

test('Telegram 客户端：请求地址只可能落在官方 origin 上，配置写成什么都带不偏', async () => {
  const seen = [];
  const fetch = okFetch(seen);
  // 官方地址归一成常量：末尾斜杠、大小写怎么写都一样
  const tg = createTelegram({ token: '123:abc', apiBase: 'https://API.telegram.org/', fetch });
  await tg.call('getMe');
  assert.deepEqual(seen, ['https://api.telegram.org/bot123:abc/getMe']);

  // 别的主机（含云元数据地址）、带路径、带查询串、带账号口令、根本不是 URL：一律拒绝
  for (const apiBase of [
    'https://evil.example',
    'https://169.254.169.254',
    'https://api.telegram.org/api',
    'https://api.telegram.org/?x=1',
    'https://user:pw@api.telegram.org',
    '::::',
  ]) {
    assert.throws(
      () => createTelegram({ token: '123:abc', apiBase, fetch }),
      /Telegram API 地址/,
      `apiBase=${apiBase} 应被拒绝`,
    );
  }
  assert.deepEqual(seen, ['https://api.telegram.org/bot123:abc/getMe'], '被拒绝的配置不该发出任何请求');
});

test('Telegram 客户端：本机回环地址只在该开关打开时放行', async () => {
  const seen = [];
  const fetch = okFetch(seen);
  assert.throws(() => createTelegram({ token: '123:abc', apiBase: 'http://127.0.0.1:9999', fetch }), /Telegram API 地址/);
  process.env.TELEGRAM_API_BASE_ALLOW_LOOPBACK = '1';
  try {
    const tg = createTelegram({ token: '123:abc', apiBase: 'http://127.0.0.1:9999', fetch });
    await tg.call('getMe');
    assert.deepEqual(seen, ['http://127.0.0.1:9999/bot123:abc/getMe']);
  } finally {
    delete process.env.TELEGRAM_API_BASE_ALLOW_LOOPBACK;
  }
});

test('Telegram 客户端：token / method 里的越界字符被拒绝，一个请求都不发', async () => {
  const seen = [];
  const fetch = okFetch(seen);
  // 这些值在老代码里会被直接拼进 URL：`/bot../../x/`、`/bot@evil.example/` 之类
  for (const token of ['../../x', 'a@evil.example', 'a/b', 'a?x=1', 'a b', 'a#f']) {
    const tg = createTelegram({ token, apiBase: 'https://api.telegram.org', fetch });
    await assert.rejects(() => tg.call('sendMessage', {}), /非法字符/, `token=${token} 应被拒绝`);
  }
  for (const method of ['sendMessage/../evil', 'send Message', 'a?b', 'a@b', '']) {
    const tg = createTelegram({ token: '123:abc', apiBase: 'https://api.telegram.org', fetch });
    await assert.rejects(() => tg.call(method, {}), /方法名非法/, `method=${method} 应被拒绝`);
  }
  assert.deepEqual(seen, [], '被拒绝时不该发出任何请求');
});

// ---------- telegram-config.js：文件里的 apiBase 按不可信输入重新校验 ----------

test('telegram.json 里的 apiBase 被手改成内网地址：读取时退回默认地址（SSRF / token 外泄）', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'telegram.json');
  // 云元数据地址：拿到 bot token 就等于拿到实例凭据
  fs.writeFileSync(file, JSON.stringify({ token: '123:abc', allowedIds: ['42'], apiBase: 'http://169.254.169.254' }));
  const cfg = T.readTelegramConfig(dir, { warn() {} });
  assert.equal(cfg.apiBase, 'https://api.telegram.org', '非受支持的地址必须回退');

  // 合法的地址原样读回
  fs.writeFileSync(file, JSON.stringify({ token: '123:abc', allowedIds: ['42'], apiBase: 'https://api.telegram.org' }));
  assert.equal(T.readTelegramConfig(dir, { warn() {} }).apiBase, 'https://api.telegram.org');

  // 没写 apiBase 的旧文件
  fs.writeFileSync(file, JSON.stringify({ token: '123:abc', allowedIds: ['42'] }));
  assert.equal(T.readTelegramConfig(dir, { warn() {} }).apiBase, 'https://api.telegram.org');
});
