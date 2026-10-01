'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupBot, NOW } = require('./helpers/bot-fixture');

const inst = { id: '1001', name: 'vm-a' };

test('自动续期成功：带时长和新的到期时间（按 DISPLAY_TIME_ZONE），发给所有白名单用户', async () => {
  const t = setupBot();
  await t.bot.notify({ type: 'renewed', inst, hours: 24, expires: '2026-10-02T19:38:55.000Z' });
  const sent = t.tg.of('sendMessage');
  assert.deepEqual(sent.map((m) => m.chat_id).sort(), [42, 43]);
  assert.match(sent[0].text, /1001/);
  assert.match(sent[0].text, /24 小时/);
  assert.match(sent[0].text, /2026-10-03 03:38/);
});

test('自动续期成功：没有新的到期时间（或格式不对）时省略后半句', async () => {
  const t = setupBot();
  await t.bot.notify({ type: 'renewed', inst, hours: 24 });
  await t.bot.notify({ type: 'renewed', inst, hours: 24, expires: 'garbage' });
  for (const m of t.tg.of('sendMessage')) {
    assert.match(m.text, /已自动续期 24 小时/);
    assert.doesNotMatch(m.text, /到期时间|Invalid/);
  }
});

test('自动续期第 1 次失败：说明还会重试、间隔和次数，错误信息被转义，带续期按钮', async () => {
  const t = setupBot();
  await t.bot.notify({ type: 'renew_failed', inst, error: '余额不足 <credit>', attempt: 1, maxAttempts: 3, final: false });
  const m = t.tg.of('sendMessage')[0];
  assert.match(m.text, /余额不足 &lt;credit&gt;/);
  assert.match(m.text, /第 1\/3 次/);
  assert.match(m.text, /每隔 10 分钟重试/);
  assert.ok(t.findButton(m, /^rn:1001$/));
});

test('自动续期最后一次失败：说明不会再自动尝试，并提示怎么处理', async () => {
  const t = setupBot();
  await t.bot.notify({ type: 'renew_failed', inst, error: 'Alice 无响应', attempt: 3, maxAttempts: 3, final: true });
  const m = t.tg.of('sendMessage')[0];
  assert.match(m.text, /连续 3 次/);
  assert.match(m.text, /不会再自动尝试/);
  assert.match(m.text, /重新开启自动续期/);
  assert.ok(t.findButton(m, /^rn:1001$/));
});

test('即将到期提醒：带续期按钮和剩余时间', async () => {
  const t = setupBot();
  await t.bot.notify({ type: 'expiring', inst: { ...inst, expiresAt: NOW + 20 * 60e3 } });
  const m = t.tg.of('sendMessage')[0];
  assert.ok(t.findButton(m, /^rn:1001$/));
  assert.match(m.text, /剩余 20 分/);
  assert.match(m.text, /未开启自动续期/);
});

test('实例名里的 < & 被转义', async () => {
  const t = setupBot();
  await t.bot.notify({ type: 'renewed', inst: { id: '7', name: 'a<b>&c' }, hours: 1 });
  assert.match(t.tg.of('sendMessage')[0].text, /a&lt;b&gt;&amp;c/);
});

test('某个用户发送失败（比如还没对 bot 发过 /start）不影响其他用户', async () => {
  const t = setupBot();
  t.tg.handlers.sendMessage = (p) => {
    if (p.chat_id === 42) throw Object.assign(new Error("Forbidden: bot can't initiate conversation"), { code: 403 });
    return { message_id: 1 };
  };
  await t.bot.notify({ type: 'renewed', inst: { id: '1', name: 'x' }, hours: 1 });
  assert.deepEqual(t.tg.of('sendMessage').map((m) => m.chat_id), [42, 43]);
});

test('未知事件类型：不发送任何消息', async () => {
  const t = setupBot();
  await t.bot.notify({ type: 'whatever', inst });
  assert.equal(t.tg.of('sendMessage').length, 0);
});
