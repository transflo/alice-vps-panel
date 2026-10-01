'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupBot, createStore, silent, tmpDir, INSTANCE } = require('./helpers/bot-fixture');

// ---------- 白名单与忽略 ----------

test('陌生用户私聊：没有任何回复，也不碰 Alice', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.msg('/list', 99));
  await t.bot.handleUpdate(t.cb('p:restart:1001', 99));
  assert.deepEqual(t.tg.calls, []);
  assert.deepEqual(t.alice.calls, []);
});

test('白名单用户在群聊里发消息：忽略', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.msg('/list', 42, 'supergroup'));
  await t.bot.handleUpdate(t.cb('i:1001', 42, 'group'));
  assert.deepEqual(t.tg.calls, []);
  assert.deepEqual(t.alice.calls, []);
});

test('/start 和 /help 返回帮助', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.msg('/start'));
  assert.match(t.tg.sent()[0].text, /\/list/);
  assert.equal(t.tg.sent()[0].parse_mode, 'HTML');
});

// ---------- /list ----------

test('/list：每台实例一条消息，名称里的 < & 被转义，callback_data ≤ 64 字节', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.msg('/list'));
  const m = t.tg.of('sendMessage').at(-1);
  assert.match(m.text, /vm-&lt;a&amp;b&gt;/);
  assert.doesNotMatch(m.text, /vm-<a&b>/);
  assert.match(m.text, /203\.0\.113\.7/);
  assert.match(m.text, /2026-10-02 03:38/); // 到期时间按 Asia/Shanghai 显示
  assert.equal(m.parse_mode, 'HTML');
  assert.ok(t.buttons(m).length >= 8);
  for (const b of t.buttons(m)) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
});

test('/list：超过 10 台只显示 10 台并提示', async () => {
  const t = setupBot({ alice: { listInstances: () => Array.from({ length: 12 }, (_, i) => ({ ...INSTANCE, id: 2000 + i })) } });
  await t.bot.handleUpdate(t.msg('/list'));
  const sent = t.tg.of('sendMessage');
  assert.equal(sent.length, 11);
  assert.match(sent.at(-1).text, /还有 2 台/);
});

test('/list：没有实例', async () => {
  const t = setupBot({ alice: { listInstances: () => [] } });
  await t.bot.handleUpdate(t.msg('/list'));
  assert.match(t.tg.sent().at(-1).text, /没有实例/);
});

test('刷新按钮 i:<id> 原地编辑消息，并应答回调', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('i:1001'));
  assert.equal(t.tg.of('editMessageText').length, 1);
  assert.equal(t.tg.of('answerCallbackQuery').length, 1);
});

// ---------- 电源与确认令牌 ----------

test('开机直接执行；关机 / 重启 / 强制关机要先确认', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('p:boot:1001'));
  assert.deepEqual(t.callsOf('power'), [['power', '1001', 'boot']]);

  for (const action of ['shutdown', 'restart', 'poweroff']) await t.bot.handleUpdate(t.cb(`p:${action}:1001`));
  assert.equal(t.callsOf('power').length, 1, '确认之前不执行');
});

test('确认令牌：点确认执行一次，重放无效', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('p:restart:1001'));
  const confirm = t.tokenOf(t.tg.sent().at(-1), 'c');
  assert.match(t.tg.sent().at(-1).text, /重启/);
  await t.bot.handleUpdate(t.cb(confirm));
  await t.bot.handleUpdate(t.cb(confirm));
  assert.deepEqual(t.callsOf('power'), [['power', '1001', 'restart']]);
  assert.match(t.tg.of('answerCallbackQuery').at(-1).text, /失效|过期/);
});

test('确认令牌绑定发起人：另一个白名单用户点不了', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('p:poweroff:1001', 42));
  const confirm = t.tokenOf(t.tg.sent().at(-1), 'c');
  await t.bot.handleUpdate(t.cb(confirm, 43));
  assert.equal(t.callsOf('power').length, 0);
  await t.bot.handleUpdate(t.cb(confirm, 42)); // 发起人自己仍然可以
  assert.equal(t.callsOf('power').length, 1);
});

test('确认令牌 60 秒后过期', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('p:restart:1001'));
  const confirm = t.tokenOf(t.tg.sent().at(-1), 'c');
  t.clock.now += 61e3;
  await t.bot.handleUpdate(t.cb(confirm));
  assert.equal(t.callsOf('power').length, 0);
});

test('取消按钮让令牌作废', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('p:restart:1001'));
  const sent = t.tg.sent().at(-1);
  await t.bot.handleUpdate(t.cb(t.tokenOf(sent, 'n')));
  await t.bot.handleUpdate(t.cb(t.tokenOf(sent, 'c')));
  assert.equal(t.callsOf('power').length, 0);
});

test('伪造的令牌、实例 ID 和电源动作：没有副作用', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('c:nonexistent'));
  await t.bot.handleUpdate(t.cb('p:restart:../etc'));
  await t.bot.handleUpdate(t.cb('p:format:1001'));
  assert.equal(t.callsOf('power').length, 0);
});

// ---------- 续期与自动续期 ----------

test('续期：先选时长（受 max_time 约束），点击即执行', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('rn:1001'));
  const hours = t.buttons(t.tg.sent().at(-1)).map((b) => b.callback_data).filter((d) => /^rn:1001:\d+$/.test(d));
  assert.ok(hours.includes('rn:1001:24'));
  assert.ok(hours.includes('rn:1001:48'));
  assert.ok(!hours.includes('rn:1001:72'), '超过账户上限的不提供');
  await t.bot.handleUpdate(t.cb('rn:1001:24'));
  assert.deepEqual(t.callsOf('renew'), [['renew', '1001', 24]]);
  assert.match(t.tg.sent().at(-1).text, /2026-10-03 03:38/); // 假 Alice 返回的新到期时间 2026-10-02T19:38Z
});

test('续期的时长参数超过账户上限：不调用 Alice', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('rn:1001:9999'));
  await t.bot.handleUpdate(t.cb('rn:1001:72'));
  assert.equal(t.callsOf('renew').length, 0);
});

test('自动续期：开启 / 关闭写入 store', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('ar:1001'));
  assert.ok(t.findButton(t.tg.sent().at(-1), /^ar:1001:0$/));
  await t.bot.handleUpdate(t.cb('ar:1001:24'));
  assert.deepEqual(t.store.getAutoRenew('1001'), { enabled: true, hours: 24 });
  await t.bot.handleUpdate(t.cb('ar:1001:0'));
  assert.deepEqual(t.store.getAutoRenew('1001'), { enabled: false, hours: 24 });
});

test('自动续期菜单与开启提示：说明开始时间、重试间隔和最多尝试次数', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('ar:1001'));
  const menu = t.tg.sent().at(-1).text;
  assert.match(menu, /到期前约 1 小时/);
  assert.match(menu, /每隔 10 分钟重试，最多尝试 3 次/);
  await t.bot.handleUpdate(t.cb('ar:1001:24'));
  assert.match(t.tg.sent().at(-1).text, /到期前约 1 小时起自动续 24 小时（失败最多试 3 次）/);

  const u = setupBot({ bot: { renewBeforeMinutes: 30, renewRetryMinutes: 5 } });
  await u.bot.handleUpdate(u.cb('ar:1001'));
  assert.match(u.tg.sent().at(-1).text, /到期前约 30 分钟/);
  assert.match(u.tg.sent().at(-1).text, /每隔 5 分钟重试/);
});

test('自动续期：数据目录不可写时给出提示，不崩溃', async () => {
  const file = path.join(tmpDir(), 'f');
  fs.writeFileSync(file, 'x');
  const store = createStore({ dir: path.join(file, 'sub'), log: silent });
  const t = setupBot({ store });
  await t.bot.handleUpdate(t.cb('ar:1001:24'));
  assert.match(t.tg.sent().at(-1).text, /DATA_DIR|数据目录/);
});

test('/account：显示余额', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.msg('/account'));
  assert.match(t.tg.sent().at(-1).text, /\$5\.00/);
});

// ---------- 长轮询 ----------

test('start：丢弃积压的 update、从其后开始轮询；stop 结束轮询', async () => {
  const t = setupBot();
  t.tg.handlers.getUpdates = (p) => (p.offset === -1
    ? [{ update_id: 5, message: { message_id: 1, from: { id: 42 }, chat: { id: 42, type: 'private' }, text: '/list' } }]
    : []);
  assert.equal(await t.bot.start(), true);
  await new Promise((r) => setTimeout(r, 30));
  const polls = t.tg.of('getUpdates');
  assert.equal(polls[0].offset, -1);
  assert.equal(polls[1].offset, 6);
  assert.equal(t.tg.of('sendMessage').length, 0, '积压的消息不会被处理');
  t.bot.stop();
});

test('start：token 无效（401）时 bot 停用并返回 false', async () => {
  const t = setupBot();
  t.tg.handlers.getMe = () => { throw Object.assign(new Error('Unauthorized'), { code: 401 }); };
  assert.equal(await t.bot.start(), false);
  assert.equal(t.tg.of('getUpdates').length, 0);
});

test('轮询到的 update 会被处理，下一次轮询从其后开始，重复投递的同一个 update 不会处理两次', async () => {
  const t = setupBot();
  const listUpdate = t.msg('/list'); // update_id = 1
  t.tg.pollQueue.push([listUpdate, listUpdate]);
  assert.equal(await t.bot.start(), true);
  await new Promise((r) => setTimeout(r, 50));
  t.bot.stop();
  assert.equal(t.tg.of('sendMessage').length, 1, '同一个 update 只处理一次');
  const polls = t.tg.of('getUpdates');
  assert.equal(polls.at(-1).offset, listUpdate.update_id + 1);
});

test('错误信息和日志不包含 token', async () => {
  const lines = [];
  const logger = { warn: (m) => lines.push(m), error: (m) => lines.push(m), log: (m) => lines.push(m) };
  const t = setupBot({ alice: { listInstances: () => { throw new Error('Alice 挂了'); } }, bot: { token: 'SECRET-TKN', log: logger } });
  await t.bot.handleUpdate(t.msg('/list'));
  assert.match(t.tg.sent().at(-1).text, /操作失败：Alice 挂了/);
  assert.ok(lines.every((l) => !String(l).includes('SECRET-TKN')));
});
