'use strict';

// bot 测试的共用夹具：假 Telegram + 假 Alice + 真实的 store，以及构造 update 的小工具。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../../store');
const { createBot } = require('../../bot');
const { createFakeTelegram } = require('./fake-telegram');

const silent = { warn() {}, error() {}, log() {} };
const NOW = Date.parse('2026-10-01T12:00:00Z');

const INSTANCE = {
  id: 1001,
  hostname: 'vm-<a&b>',
  status: 'active',
  plan_id: 38,
  ipv4: '203.0.113.7',
  expiration_at: '2026-10-01T20:38:55+01:00',
  expiration_at_utc: '2026-10-01T19:38:55.000Z',
  creation_at_utc: '2026-09-30T19:38:55.000Z',
};

// 默认的假 Alice 方法；over 里的同名方法会替换默认实现（调用仍然被记录在 calls 里）。
function makeAlice(over = {}) {
  const calls = [];
  const defaults = {
    listInstances: () => [INSTANCE],
    state: () => ({ status: 'complete', state: { state: 'running' } }),
    power: () => null,
    renew: () => ({ expiration_at_utc: '2026-10-02T19:38:55.000Z' }),
    destroy: () => null,
    exec: () => ({ command_uid: 'u1' }),
    execResult: () => ({ status: 'complete', output: Buffer.from('hello <b>\n').toString('base64') }),
    permissions: () => ({ max_time: 48, allow_packages: '38' }),
    profile: () => ({ credit: 5000000 }),
    plans: () => [{ id: 38, name: 'Plan-A', cpu: 1, memory: 1, disk: 10, stock: 3 }, { id: 39, name: 'Plan-B', stock: 0 }],
    planImages: () => [{ group_id: 1, group_name: 'Ubuntu', os_list: [{ id: 101, name: 'Ubuntu 24.04' }] }],
    sshKeys: () => [{ id: 5, name: 'laptop' }],
    deploy: () => ({ id: 2002, hostname: 'new-vm', ipv4: '198.51.100.9', password: 'p@ss<word>', boot_script_uid: 'bs-uid-1' }),
    rebuild: () => ({ password: 'new-pass' }),
  };
  const alice = { calls, configured: () => true };
  for (const [name, impl] of Object.entries({ ...defaults, ...over })) {
    alice[name] = async (...args) => {
      calls.push([name, ...args]);
      return impl(...args);
    };
  }
  return alice;
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alice-bot-'));

function setupBot({ alice: aliceOver, store: storeOver, bot: botOver } = {}) {
  const clock = { now: NOW };
  const tg = createFakeTelegram();
  const alice = makeAlice(aliceOver);
  const store = storeOver || createStore({ dir: tmpDir(), now: () => clock.now, log: silent });
  const scheduled = [];
  const bot = createBot({
    token: 'TKN',
    allowedIds: ['42', '43'],
    apiBase: 'https://tg.test',
    alice,
    store,
    displayTimeZone: 'Asia/Shanghai',
    fetch: tg.fetch,
    log: silent,
    now: () => clock.now,
    sleep: async () => {},
    schedule: (fn, ms) => scheduled.push([fn, ms]),
    ...botOver,
  });

  let uid = 0;
  let mid = 0;
  const msg = (text, from = 42, chatType = 'private') => ({
    update_id: ++uid,
    message: { message_id: ++mid, from: { id: from }, chat: { id: from, type: chatType }, text },
  });
  const cb = (data, from = 42, chatType = 'private') => ({
    update_id: ++uid,
    callback_query: { id: `cb${uid}`, from: { id: from }, data, message: { message_id: 7, chat: { id: from, type: chatType } } },
  });
  const buttons = (params) => (params.reply_markup ? params.reply_markup.inline_keyboard.flat() : []);
  const findButton = (params, re) => buttons(params).find((b) => re.test(b.callback_data || b.text));
  const tokenOf = (params, prefix = 'c') => findButton(params, new RegExp(`^${prefix}:`)).callback_data;
  const callsOf = (name) => alice.calls.filter((c) => c[0] === name);

  return { clock, tg, alice, store, bot, scheduled, msg, cb, buttons, findButton, tokenOf, callsOf };
}

module.exports = { setupBot, makeAlice, createStore, silent, NOW, INSTANCE, tmpDir };
