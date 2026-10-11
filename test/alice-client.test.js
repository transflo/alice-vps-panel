'use strict';

// alice.js 在启动时读环境变量，所以先起一个本地假 Alice，再 require。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server;
let reply = () => ({});

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 200, message: 'ok', data: reply(req) }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.ALICE_API_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.ALICE_CLIENT_ID = 'cli_test';
  process.env.ALICE_SECRET = 'secret';
  delete process.env.ALICE_CLOCK_OFFSET;
});

after(() => server.close());

const RAW = { id: 1, creation_at: '2026-10-01T03:38:55+01:00', expiration_at: '2026-10-01T20:38:55+01:00' };

test('listInstances：数组里的每个实例追加规范化时间，原始字段不变', async () => {
  reply = () => [RAW, { id: 2 }];
  const list = await require('../alice').listInstances();
  assert.equal(list[0].creation_at_utc, '2026-09-30T19:38:55.000Z');
  assert.equal(list[0].expiration_at_utc, '2026-10-01T19:38:55.000Z');
  assert.equal(list[0].creation_at, RAW.creation_at);
  assert.equal('creation_at_utc' in list[1], false);
});

test('listInstances：列表包在对象里时同样处理', async () => {
  reply = () => ({ total: 1, list: [RAW] });
  const data = await require('../alice').listInstances();
  assert.equal(data.total, 1);
  assert.equal(data.list[0].expiration_at_utc, '2026-10-01T19:38:55.000Z');
});

test('renew：返回对象里追加 expiration_at_utc', async () => {
  reply = () => ({ expiration_at: '2026-10-02T20:38:55+01:00' });
  const r = await require('../alice').renew('1', 24);
  assert.equal(r.expiration_at_utc, '2026-10-02T19:38:55.000Z');
});

test('renew：返回非对象（如 null）时原样返回', async () => {
  reply = () => null;
  assert.equal(await require('../alice').renew('1', 24), null);
});
