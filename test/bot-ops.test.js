'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupBot } = require('./helpers/bot-fixture');

const tick = () => new Promise((r) => setImmediate(r)); // exec 的轮询在独立任务里进行

test('删除：先确认；确认后调用 Alice 并清理自动续期设置', async () => {
  const t = setupBot();
  t.store.setAutoRenew('1001', { enabled: true, hours: 24 });
  await t.bot.handleUpdate(t.cb('dx:1001'));
  assert.equal(t.callsOf('destroy').length, 0);
  assert.match(t.tg.sent().at(-1).text, /永久/);
  await t.bot.handleUpdate(t.cb(t.tokenOf(t.tg.sent().at(-1), 'c')));
  assert.deepEqual(t.callsOf('destroy'), [['destroy', '1001']]);
  assert.equal(t.store.getAutoRenew('1001'), undefined);
});

test('/exec：确认消息完整显示命令（已转义），确认后执行并轮询，输出解码并转义', async () => {
  let n = 0;
  const t = setupBot({
    alice: {
      execResult: () => (++n < 2 ? { status: 'running' } : { status: 'complete', output: Buffer.from('hello <b>\n').toString('base64') }),
    },
  });
  await t.bot.handleUpdate(t.msg('/exec 1001 echo "<hi>" && uptime'));
  assert.equal(t.callsOf('exec').length, 0);
  assert.match(t.tg.sent().at(-1).text, /<pre>echo &quot;&lt;hi&gt;&quot; &amp;&amp; uptime<\/pre>/);
  await t.bot.handleUpdate(t.cb(t.tokenOf(t.tg.sent().at(-1), 'c')));
  assert.deepEqual(t.callsOf('exec'), [['exec', '1001', 'echo "<hi>" && uptime']]);
  await tick();
  await tick();
  const out = t.tg.of('sendMessage').at(-1).text;
  assert.match(out, /hello &lt;b&gt;/);
  assert.doesNotMatch(out, /<b>/);
});

test('/exec 输出超过 3500 字符：只保留末尾并说明，整条消息不超过 4096', async () => {
  const big = `${'A'.repeat(5000)}END`;
  const t = setupBot({ alice: { execResult: () => ({ status: 'complete', output: Buffer.from(big).toString('base64') }) } });
  await t.bot.handleUpdate(t.msg('/exec 1001 cat big'));
  await t.bot.handleUpdate(t.cb(t.tokenOf(t.tg.sent().at(-1), 'c')));
  await tick();
  await tick();
  const out = t.tg.of('sendMessage').at(-1).text;
  assert.ok(out.length <= 4096);
  assert.match(out, /已截断/);
  assert.match(out, /END<\/pre>/);
});

test('/exec 长命令：完整分段显示（不藏中间部分），每条消息都不超 4096；输出仍按转义长度截断', async () => {
  const t = setupBot({ alice: { execResult: () => ({ status: 'complete', output: Buffer.from('&'.repeat(3000)).toString('base64') }) } });
  const command = '<'.repeat(4000);
  await t.bot.handleUpdate(t.msg(`/exec 1001 ${command}`));
  const sent = t.tg.of('sendMessage').map((m) => m.text);
  for (const text of sent) assert.ok(text.length <= 4096, `消息 ${text.length} 字符`);
  // 完整命令必须全部发出来：把各段 <pre> 里的正文拼起来应等于整条命令（没有省略任何一段）
  const body = sent
    .flatMap((text) => [...text.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map((m) => m[1]))
    .join('');
  assert.equal(body, '&lt;'.repeat(command.length), '命令正文完整显示，不能只显示开头和结尾');
  assert.match(sent.at(-1), /完整命令/);
  await t.bot.handleUpdate(t.cb(t.tokenOf(t.tg.sent().at(-1), 'c')));
  assert.equal(t.callsOf('exec')[0][2].length, 4000, '实际执行完整命令');
  await tick();
  await tick();
  const out = t.tg.of('sendMessage').at(-1).text;
  assert.ok(out.length <= 4096, `输出消息 ${out.length} 字符`);
  assert.match(out, /已截断/);
});

test('/exec 并发查询超限：提示发送失败也不能留下未处理的 Promise 拒绝（会带走整个面板进程）', async () => {
  const rejections = [];
  const onRejection = (err) => rejections.push(err);
  process.on('unhandledRejection', onRejection);
  try {
    // execResult 永不返回 → 前 3 个 watch 一直挂着，占满 MAX_WATCHES（3）
    const t = setupBot({ alice: { execResult: () => new Promise(() => {}) } });
    for (let i = 0; i < 3; i += 1) {
      await t.bot.handleUpdate(t.msg(`/exec 1001 echo ${i}`));
      await t.bot.handleUpdate(t.cb(t.tokenOf(t.tg.sent().at(-1), 'c')));
    }
    // 第 4 个走「同时查询的命令太多」分支，而这条提示的发送失败（Telegram 429）
    let mid = 500;
    t.tg.handlers.sendMessage = (params) => {
      if (/太多/.test(params.text)) {
        throw Object.assign(new Error('Too Many Requests: retry after 30'), { code: 429 });
      }
      return { message_id: (mid += 1), chat: { id: params.chat_id } };
    };
    await t.bot.handleUpdate(t.msg('/exec 1001 echo 4'));
    await t.bot.handleUpdate(t.cb(t.tokenOf(t.tg.sent().at(-1), 'c')));
    for (let i = 0; i < 5; i += 1) await tick();
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  assert.deepEqual(rejections, [], `出现了未处理的 Promise 拒绝：${rejections.map((e) => e.message).join('; ')}`);
});

test('转发来的消息：标出来源，内容仍按本人输入处理（只提示、不静默、不阻断）', async () => {
  const t = setupBot();
  const forwarded = t.msg('/exec 1001 id');
  forwarded.message.forward_origin = { type: 'user', sender_user: { id: 999, first_name: 'Mallory' } };
  await t.bot.handleUpdate(forwarded);
  const first = t.tg.of('sendMessage')[0].text;
  assert.match(first, /转发/);
  assert.match(first, /Mallory/);
  // 仍然照常进入确认流程
  assert.match(t.tg.sent().at(-1).text, /<pre>id<\/pre>/);
  assert.equal(t.callsOf('exec').length, 0, '确认前不执行');
});

test('/exec 参数不合法：不调用 Alice，各回复一条用法说明', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.msg('/exec'));
  await t.bot.handleUpdate(t.msg('/exec 1001'));
  await t.bot.handleUpdate(t.msg('/exec a/b ls'));
  assert.equal(t.callsOf('exec').length, 0);
  assert.equal(t.tg.of('sendMessage').length, 3);
  for (const m of t.tg.of('sendMessage')) assert.match(m.text, /用法/);
});

test('执行命令按钮：提示发送命令，下一条文字消息成为待确认的命令', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('ex:1001'));
  await t.bot.handleUpdate(t.msg('df -h'));
  assert.match(t.tg.sent().at(-1).text, /<pre>df -h<\/pre>/);
  assert.equal(t.callsOf('exec').length, 0);
});

test('新建向导：套餐 → 系统 → 时长 → SSH 密钥 → 启动脚本 → 确认；密码消息 10 分钟后删除', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.msg('/deploy'));
  const planKb = t.tg.sent().at(-1);
  assert.ok(t.findButton(planKb, /^w:plan:38$/));
  assert.ok(!t.findButton(planKb, /^w:plan:39$/), '无库存的套餐不可选');

  await t.bot.handleUpdate(t.cb('w:plan:38'));
  assert.deepEqual(t.callsOf('planImages'), [['planImages', '38']]);
  await t.bot.handleUpdate(t.cb('w:os:101'));
  await t.bot.handleUpdate(t.cb('w:h:24'));
  await t.bot.handleUpdate(t.cb('w:key:0'));
  await t.bot.handleUpdate(t.msg('#!/bin/bash\necho hi')); // 启动脚本
  const summary = t.tg.sent().at(-1);
  assert.match(summary.text, /Plan-A/);
  assert.equal(t.callsOf('deploy').length, 0, '确认之前不创建');

  await t.bot.handleUpdate(t.cb(t.tokenOf(summary, 'c')));
  assert.deepEqual(t.callsOf('deploy'), [['deploy', { planId: '38', osId: '101', hours: 24, sshKeyId: null, bootScript: '#!/bin/bash\necho hi' }]]);
  const result = t.tg.of('sendMessage').at(-1);
  assert.match(result.text, /<code>p@ss&lt;word&gt;<\/code>/);
  assert.ok(t.findButton(result, /^v:/), '有启动脚本时提供查看输出的按钮');

  assert.equal(t.scheduled.length, 1);
  assert.equal(t.scheduled[0][1], 10 * 60 * 1000);
  await t.scheduled[0][0]();
  assert.equal(t.tg.of('deleteMessage').length, 1);
});

test('新建向导：跳过启动脚本，选择 SSH 密钥', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.msg('/deploy'));
  await t.bot.handleUpdate(t.cb('w:plan:38'));
  await t.bot.handleUpdate(t.cb('w:os:101'));
  await t.bot.handleUpdate(t.cb('w:h:12'));
  await t.bot.handleUpdate(t.cb('w:key:5'));
  await t.bot.handleUpdate(t.cb('w:skip'));
  await t.bot.handleUpdate(t.cb(t.tokenOf(t.tg.sent().at(-1), 'c')));
  assert.deepEqual(t.callsOf('deploy'), [['deploy', { planId: '38', osId: '101', hours: 12, sshKeyId: '5', bootScript: undefined }]]);
});

test('向导：/cancel 取消；10 分钟无操作后再点按钮无效', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.msg('/deploy'));
  await t.bot.handleUpdate(t.msg('/cancel'));
  await t.bot.handleUpdate(t.cb('w:plan:38'));
  assert.equal(t.callsOf('planImages').length, 0);

  await t.bot.handleUpdate(t.msg('/deploy'));
  t.clock.now += 11 * 60e3;
  await t.bot.handleUpdate(t.cb('w:plan:38'));
  assert.equal(t.callsOf('planImages').length, 0);
});

test('向导按钮里的 ID 不合法：不调用 Alice', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.msg('/deploy'));
  await t.bot.handleUpdate(t.cb('w:plan:../x'));
  assert.equal(t.callsOf('planImages').length, 0);
});

test('重装向导：使用实例自己的套餐查系统，确认后调用 rebuild', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.cb('rb:1001'));
  assert.deepEqual(t.callsOf('planImages'), [['planImages', '38']]);
  await t.bot.handleUpdate(t.cb('w:os:101'));
  await t.bot.handleUpdate(t.cb('w:key:0'));
  await t.bot.handleUpdate(t.cb('w:skip'));
  const summary = t.tg.sent().at(-1);
  assert.match(summary.text, /重装|覆盖/);
  await t.bot.handleUpdate(t.cb(t.tokenOf(summary, 'c')));
  assert.deepEqual(t.callsOf('rebuild'), [['rebuild', '1001', { osId: '101', sshKeyId: null, bootScript: undefined }]]);
});

test('等待输入时来了命令：命令优先，不会把 /list 当成启动脚本', async () => {
  const t = setupBot();
  await t.bot.handleUpdate(t.msg('/deploy'));
  await t.bot.handleUpdate(t.cb('w:plan:38'));
  await t.bot.handleUpdate(t.cb('w:os:101'));
  await t.bot.handleUpdate(t.cb('w:h:24'));
  await t.bot.handleUpdate(t.cb('w:key:0'));
  await t.bot.handleUpdate(t.msg('/list'));
  assert.ok(t.callsOf('listInstances').length >= 1);
  await t.bot.handleUpdate(t.cb('w:skip')); // 向导仍然停在启动脚本这一步
  assert.match(t.tg.sent().at(-1).text, /确认/);
});
