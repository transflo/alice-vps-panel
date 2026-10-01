# 时间修复、自动续期、Telegram bot 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复创建时间错位 7 小时；给实例加上默认关闭的自动续期；用 Telegram bot 提供与网页等价的全部控制能力。

**Architecture:** 后端新增若干小模块（时间规范化、状态存储、调度器、Telegram bot），全部只用 Node 标准库。Alice 的时间在 `alice.js` 统一规范化后追加 `*_at_utc` 字段，网页、调度器、bot 都只读规范化后的字段。自动续期状态存放在 `DATA_DIR/state.json`，由后端每 60 秒轮询的调度器执行；bot 用长轮询对接 Telegram，复用同一个 `alice.js`、`store.js` 和调度器的通知。

**Tech Stack:** Node.js（CommonJS，零依赖，测试用 `node --test`）；前端 React 19 + MUI 9 + Vite 8（ESM）；Docker。

**Spec:** `docs/superpowers/specs/2026-10-01-time-autorenew-telegram-design.md`

## Global Constraints

- 后端不引入任何第三方依赖，只用 Node 标准库（`engines`: `^20.19.0 || >=22.12.0`；本机 Node v26.8.2）。
- 后端 CommonJS + `'use strict'`，前端 ESM；注释、用户可见文案用中文，风格与现有代码一致。
- 测试用 `node --test`（`npm test`）；单个测试文件在独立进程里运行。
- 默认值：`ALICE_CLOCK_OFFSET=+08:00`、`AUTO_RENEW_BEFORE_MINUTES=10`、`EXPIRY_WARN_MINUTES=30`（0 关闭）、`AUTO_RENEW_INTERVAL_SECONDS=60`（1~600）、`DISPLAY_TIME_ZONE=Asia/Shanghai`、`DATA_DIR=./data`（Docker 内 `/data`）、`TELEGRAM_API_BASE=https://api.telegram.org`；自动续期默认关闭，开启时默认 24 小时。
- bot：确认令牌 60 秒过期、一次性、绑定用户；root 密码消息 10 分钟后删除；`exec` 每 2 秒轮询、最长 5 分钟、输出保留末尾 3500 字符；`/list` 最多 10 台；`callback_data` ≤ 64 字节；向导 10 分钟无操作过期；长轮询 `timeout=50`，出错退避 1 秒起、最长 30 秒；回复用 HTML 解析模式且所有动态文本转义。
- 容器除 `/data` 外保持只读，`cap_drop: ALL`、`no-new-privileges` 不变。
- 修改类 HTTP 请求沿用 `X-Panel: 1` 头校验；新接口都在登录会话之后。
- 提交信息用中文，格式 `类型: 说明`，末尾加：`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。

## Review Focus

spec 没有逐条写、但最可能在实际使用中出问题的情况（每条都在对应任务里有测试）：

1. **时间字段是 `null` / 空串 / 乱码 / 月份越界**（Task 1）：返回 `null`、不抛错，网页卡片显示"—"，调度器跳过该实例。
2. **`state.json` 损坏或数据目录不可写**（Task 3、5）：面板仍能启动；损坏文件改名为 `.bak`；开启自动续期返回 503 和明确提示，其余功能正常。
3. **续期成功后列表仍返回旧到期时间、两轮调度重叠、请求超时结果不明**（Task 4）：同一个到期点不会重复续期。
4. **实例名、命令输出里含 `<` `&`，或输出超过 4096 字符**（Task 7、8）：转义并截断，Telegram 不会因格式错误或超长拒收。
5. **陌生用户 / 群聊消息、别人的 / 过期的 / 已用过的确认令牌、重启后积压的旧指令**（Task 7、8）：没有任何回复和副作用。

---

## 文件结构

| 文件 | 职责 | 任务 |
| --- | --- | --- |
| `alice-time.js`（新） | `parseAliceTime`、`parseClockOffset`、`withUtcTimes`：时间规范化 | 1 |
| `alice.js`（改） | `listInstances` / `renew` 返回里追加 `*_at_utc` | 1 |
| `validate.js`（新） | `HttpError`、`ID_RE`、`reqId`、`optId`、`hours`、`optText`、`POWER_ACTIONS`（从 `server.js` 抽出） | 2 |
| `normalize.js`（新） | 后端用的 Alice 数据整理（移植自 `web/src/utils.js`） | 2 |
| `store.js`（新） | `${DATA_DIR}/state.json` 的原子读写：自动续期设置与去重周期 | 3 |
| `config.js`（新） | 环境变量解析与校验 | 4 |
| `scheduler.js`（新） | `decide()`（纯函数）和 `createScheduler()`：每轮拉列表、续期、提醒 | 4 |
| `server.js`（改） | 新接口、删除时清理、启动调度器 | 5 |
| `telegram.js`（新） | Bot API 的最小 `fetch` 客户端 | 7 |
| `bot-views.js`（新） | bot 的纯渲染函数：转义、时间格式、实例卡片、键盘 | 7 |
| `bot.js`（新） | 白名单、路由、一次性令牌、向导、长轮询、推送 | 7、8、9 |
| `web/src/…`（改） | 读 `*_at_utc`；自动续期弹窗、卡片标签、菜单 | 1、6 |
| `Dockerfile`、`docker-compose.yml`、`.env.example`、`README.md`（改） | 部署与文档 | 10 |
| `test/helpers/mock-alice.js`、`test/helpers/fake-telegram.js`（新） | 测试替身 | 5、7 |

---

### Task 0: 初始化 git 并提交基线

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 初始化仓库、设置本仓库的提交身份、补充忽略项**

```bash
cd /c/Users/cia/Documents/coding/alice-vps-panel
git init -b main
git config user.name "ubitlin"
git config user.email "ubitlin@gmail.com"
printf 'data/\n' >> .gitignore
```

- [ ] **Step 2: 提交现有项目、设计文档和本计划**

```bash
git add -A
git status --short   # 确认没有 .env、node_modules、public
git commit -m "chore: 导入现有面板代码、设计文档与实施计划

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: 后台安装前端依赖（Task 6 要打包前端）**

```bash
npm --prefix web ci   # 后台运行，不等待
```

---

### Task 1: 时间规范化（修复创建时间错位）

**Files:**
- Create: `alice-time.js`, `test/alice-time.test.js`, `test/alice-client.test.js`
- Modify: `alice.js`, `web/src/utils.js`（`normInstance`）, `web/src/dialogs/MiscDialogs.jsx`（`RenewDialog`）

**Interfaces:**
- Produces: `parseAliceTime(value, { ignoreOffset = false, clockOffset = '+08:00' } = {}) → string | null`（ISO UTC，如 `'2026-09-30T19:38:55.000Z'`）；`parseClockOffset(text, warn = console.warn) → string`；`withUtcTimes(record, clockOffset) → object`（浅拷贝，仅在解析成功时追加 `creation_at_utc` / `expiration_at_utc`，非对象原样返回）。
- Produces: `alice.listInstances()` 返回的每个实例对象、`alice.renew()` 返回的对象，都带规范化字段。

- [ ] **Step 1: 写失败的测试 `test/alice-time.test.js`**

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAliceTime, parseClockOffset, withUtcTimes } = require('../alice-time');

// 真实数据（2026-10-01，部署时选了 24 小时）：creation_at 的钟面是 UTC+8 但标签写成 +01:00，expiration_at 自洽。
const CREATION = '2026-10-01T03:38:55+01:00';
const EXPIRATION = '2026-10-01T20:38:55+01:00';

test('creation_at：忽略错误的 +01:00 标签，钟面数字按 +08:00 解释', () => {
  assert.equal(parseAliceTime(CREATION, { ignoreOffset: true }), '2026-09-30T19:38:55.000Z');
});

test('expiration_at：按标签解析', () => {
  assert.equal(parseAliceTime(EXPIRATION), '2026-10-01T19:38:55.000Z');
});

test('回归：规范化后到期时间减创建时间恰好 24 小时', () => {
  const rec = withUtcTimes({ creation_at: CREATION, expiration_at: EXPIRATION }, '+08:00');
  assert.equal(Date.parse(rec.expiration_at_utc) - Date.parse(rec.creation_at_utc), 24 * 3600 * 1000);
});

test('规范化后的创建时间在 UTC+8 显示为 2026-10-01 03:38，到期时间为 2026-10-02 03:38', () => {
  const rec = withUtcTimes({ creation_at: CREATION, expiration_at: EXPIRATION }, '+08:00');
  const show = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16);
  assert.equal(show(rec.creation_at_utc), '2026-10-01 03:38');
  assert.equal(show(rec.expiration_at_utc), '2026-10-02 03:38');
});

test('withUtcTimes 保留原始字段，不改动输入对象', () => {
  const input = { id: 1, creation_at: CREATION, expiration_at: EXPIRATION };
  const out = withUtcTimes(input, '+08:00');
  assert.equal(out.creation_at, CREATION);
  assert.equal(out.expiration_at, EXPIRATION);
  assert.equal(out.id, 1);
  assert.equal(input.creation_at_utc, undefined);
});

test('各种写法：Z、空格分隔、不带标签（到期按 UTC，创建按 clockOffset）', () => {
  assert.equal(parseAliceTime('2026-10-01T19:38:55Z'), '2026-10-01T19:38:55.000Z');
  assert.equal(parseAliceTime('2026-10-01 19:38:55'), '2026-10-01T19:38:55.000Z');
  assert.equal(parseAliceTime('2026-10-01 03:38:55', { ignoreOffset: true }), '2026-09-30T19:38:55.000Z');
  assert.equal(parseAliceTime('2026-10-01 03:38', { ignoreOffset: true, clockOffset: '+09:00' }), '2026-09-30T18:38:00.000Z');
  assert.equal(parseAliceTime('2026-10-01T03:38:55.5+0800'), '2026-09-30T19:38:55.500Z');
});

test('纯数字按 epoch 解析（小于 1e12 视为秒）', () => {
  assert.equal(parseAliceTime(1790000000), new Date(1790000000 * 1000).toISOString());
  assert.equal(parseAliceTime('1790000000000'), new Date(1790000000000).toISOString());
});

test('无法解析的值返回 null 而不是抛错', () => {
  for (const v of [null, undefined, '', 'abc', '2026-13-01T00:00:00Z', '2026-02-30 10:00:00', '2026-10-01T25:00:00Z', {}, [], NaN]) {
    assert.equal(parseAliceTime(v), null, String(JSON.stringify(v)));
  }
});

test('withUtcTimes：解析不了的字段不追加；非对象原样返回', () => {
  const out = withUtcTimes({ creation_at: 'garbage', expiration_at: null }, '+08:00');
  assert.equal('creation_at_utc' in out, false);
  assert.equal('expiration_at_utc' in out, false);
  assert.equal(withUtcTimes(null, '+08:00'), null);
  assert.equal(withUtcTimes('x', '+08:00'), 'x');
  assert.deepEqual(withUtcTimes([1], '+08:00'), [1]);
});

test('parseClockOffset：合法值原样返回，非法值回退默认并警告', () => {
  const warnings = [];
  assert.equal(parseClockOffset(undefined, (m) => warnings.push(m)), '+08:00');
  assert.equal(parseClockOffset('-05:30', (m) => warnings.push(m)), '-05:30');
  assert.equal(warnings.length, 0);
  assert.equal(parseClockOffset('Shanghai', (m) => warnings.push(m)), '+08:00');
  assert.equal(parseClockOffset('+25:00', (m) => warnings.push(m)), '+08:00');
  assert.equal(warnings.length, 2);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test test/alice-time.test.js`
Expected: FAIL，`Cannot find module '../alice-time'`

- [ ] **Step 3: 实现 `alice-time.js`**

```js
'use strict';

// Alice 返回的时间在这里统一规范化成 ISO 8601 UTC 字符串（设计文档 §1）。
// 已知：creation_at 的偏移标签是错的（钟面数字是 Alice 服务器本地时间 UTC+8，标签却写成 +01:00），
// 所以忽略标签、按 clockOffset 解释钟面；expiration_at 的数字和标签自洽，按标签解析。
// 不带标签的时间目前没有真实数据印证，沿用原来的约定：到期时间按 UTC。

const DEFAULT_CLOCK_OFFSET = '+08:00';
const CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

// 'Z' / '+08:00' / '-0530' → 分钟数；无法识别返回 null。
function offsetMinutes(text) {
  const s = String(text).trim();
  if (/^z$/i.test(s)) return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(s);
  if (!m || Number(m[2]) > 14 || Number(m[3]) > 59) return null;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -mins : mins;
}

function parseAliceTime(value, { ignoreOffset = false, clockOffset = DEFAULT_CLOCK_OFFSET } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const n = Number(value);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value !== 'string') return null;
  const m = CLOCK_RE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', frac = '0', label] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +s > 59) return null;
  // Date.UTC 会把 2 月 30 日这类日期顺延到下个月，这里要拒绝。
  if (new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDate() !== +d) return null;
  let offset;
  if (ignoreOffset) offset = offsetMinutes(clockOffset);
  else if (!label) offset = 0;
  else offset = offsetMinutes(label);
  if (offset === null) return null;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, Math.round(Number(`0.${frac}`) * 1000)) - offset * 60000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// 环境变量 ALICE_CLOCK_OFFSET 的校验：非法值回退到默认并给出警告。
function parseClockOffset(text, warn = console.warn) {
  if (text === undefined || text === null || String(text).trim() === '') return DEFAULT_CLOCK_OFFSET;
  const s = String(text).trim();
  if (/^[+-]\d{2}:?\d{2}$/.test(s) && offsetMinutes(s) !== null) return s;
  warn(`ALICE_CLOCK_OFFSET=${s} 不是合法的偏移（应形如 +08:00），已使用默认值 ${DEFAULT_CLOCK_OFFSET}`);
  return DEFAULT_CLOCK_OFFSET;
}

// 返回浅拷贝：原始字段原样保留，解析成功时追加 creation_at_utc / expiration_at_utc。
function withUtcTimes(record, clockOffset = DEFAULT_CLOCK_OFFSET) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const out = { ...record };
  const created = parseAliceTime(record.creation_at, { ignoreOffset: true, clockOffset });
  const expires = parseAliceTime(record.expiration_at);
  if (created) out.creation_at_utc = created;
  if (expires) out.expiration_at_utc = expires;
  return out;
}

module.exports = { DEFAULT_CLOCK_OFFSET, parseAliceTime, parseClockOffset, withUtcTimes };
```

- [ ] **Step 4: 运行，确认通过**

Run: `node --test test/alice-time.test.js`
Expected: PASS（9 个测试）

- [ ] **Step 5: 写失败的测试 `test/alice-client.test.js`（alice.js 接入）**

```js
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
```

- [ ] **Step 6: 运行，确认失败**

Run: `node --test test/alice-client.test.js`
Expected: FAIL，`creation_at_utc` 为 `undefined`

- [ ] **Step 7: 修改 `alice.js`**

在文件顶部常量之后加入：

```js
const { parseClockOffset, withUtcTimes } = require('./alice-time');

const CLOCK_OFFSET = parseClockOffset(process.env.ALICE_CLOCK_OFFSET, (msg) => console.warn(`[panel] ${msg}`));

// 列表可能直接是数组，也可能包在 { list: [...] } 之类的对象里：给每个数组里的对象追加规范化后的时间。
function withTimesInList(data) {
  if (Array.isArray(data)) return data.map((r) => withUtcTimes(r, CLOCK_OFFSET));
  if (data && typeof data === 'object') {
    const out = { ...data };
    for (const k of Object.keys(out)) {
      if (Array.isArray(out[k])) out[k] = out[k].map((r) => withUtcTimes(r, CLOCK_OFFSET));
    }
    return out;
  }
  return data;
}
```

并把 `module.exports` 里的两项改为：

```js
  listInstances: async () => withTimesInList(await request('GET', '/evo/instances')),
```

```js
  renew: async (id, hours) =>
    withUtcTimes(await request('POST', `/evo/instances/${seg(id)}/renewals`, { time: hours }), CLOCK_OFFSET),
```

- [ ] **Step 8: 运行，确认通过**

Run: `node --test test/alice-client.test.js test/alice-time.test.js`
Expected: PASS

- [ ] **Step 9: 前端读取规范化字段**

`web/src/utils.js` 的 `normInstance` 里，把 `created` / `expires` 两行改为优先读 `*_at_utc`：

```js
    created: toDate(pick(raw, 'creation_at_utc', 'creation_at', 'created_at', 'create_at', 'created', 'create_time')),
    expires: toDate(pick(raw, 'expiration_at_utc', 'expiration_at', 'expired_at', 'expire_at', 'expires_at', 'expiration', 'expire_time', 'due_at')),
```

同时把 `toDate` 上方注释里关于"按 UTC 解析"的说明补一句：`后端已经把 creation_at / expiration_at 规范化成带 Z 的 *_at_utc，这里只是其他字段和旧后端的兜底。`

`web/src/dialogs/MiscDialogs.jsx` 的 `RenewDialog.submit` 里：

```js
    const next = toDate(pick(r.data, 'expiration_at_utc', 'expiration_at'));
```

- [ ] **Step 10: 提交**

```bash
git add alice-time.js alice.js test/alice-time.test.js test/alice-client.test.js web/src/utils.js web/src/dialogs/MiscDialogs.jsx
git commit -m "fix: 修正创建时间错位 7 小时（Alice 的 creation_at 偏移标签有误）

后端把 creation_at 的钟面按 ALICE_CLOCK_OFFSET 解释、expiration_at 按标签解析，
追加 creation_at_utc / expiration_at_utc，原始字段保持不变；前端优先读规范化字段。

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 抽出校验函数，新增后端数据整理

**Files:**
- Create: `validate.js`, `normalize.js`, `test/validate.test.js`, `test/normalize.test.js`
- Modify: `server.js`（改为从 `validate.js` 导入）

**Interfaces:**
- Produces（`validate.js`）：`HttpError(status, message)`；`ID_RE`；`POWER_ACTIONS`；`reqId(v, name) → string`；`optId(v, name) → string | null`；`hours(v) → int`；`optText(v, name, max) → string | undefined`。行为与现有 `server.js` 完全一致。
- Produces（`normalize.js`）：`pick`、`firstValue`、`asList`、`ipText`、`statusLabel(s)`、`normInstance(raw) → { raw, id, name, status, ipv4, ipv6, plan, planId, os, region, expiresAt: number|null, createdAt: number|null }`、`powerState(data) → string|undefined`、`cardStatus(inst, power)`、`normPlans(data) → [{id, name, specs, stock}]`、`normSshKeys(data) → [{id, name}]`、`flattenImages(data) → [{id, name, group}]`、`allowedPlanIds(perm)`、`maxHours(perm)`、`planOptions(plans, perm) → [{id, label, disabled}]`、`durationOptions(max)`、`durationLabel(n)`、`decodeOutput(text)`、`RUNNING_RE`。

- [ ] **Step 1: 写失败的测试 `test/validate.test.js`**

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HttpError, reqId, optId, hours, optText, POWER_ACTIONS } = require('../validate');

const bad = (fn) => assert.throws(fn, (e) => e instanceof HttpError && e.status === 400);

test('reqId：接受合法 ID（含数字），拒绝空值、空格和特殊字符', () => {
  assert.equal(reqId('abc-1_2', '实例'), 'abc-1_2');
  assert.equal(reqId(1001, '实例'), '1001');
  for (const v of [undefined, null, '', 'a b', 'a/b', '../x', 'x'.repeat(65)]) bad(() => reqId(v, '实例'));
});

test('optId：空值返回 null，其他同 reqId', () => {
  assert.equal(optId(undefined, '密钥'), null);
  assert.equal(optId('', '密钥'), null);
  assert.equal(optId('7', '密钥'), '7');
  bad(() => optId('a b', '密钥'));
});

test('hours：1 ~ 8760 的整数', () => {
  assert.equal(hours('24'), 24);
  assert.equal(hours(8760), 8760);
  for (const v of [0, -1, 1.5, 8761, 'x', undefined, null]) bad(() => hours(v));
});

test('optText：空值返回 undefined，非字符串或过长报错', () => {
  assert.equal(optText('', '命令', 10), undefined);
  assert.equal(optText('ls', '命令', 10), 'ls');
  bad(() => optText('x'.repeat(11), '命令', 10));
  bad(() => optText(123, '命令', 10));
});

test('POWER_ACTIONS', () => {
  assert.deepEqual(POWER_ACTIONS, ['boot', 'shutdown', 'restart', 'poweroff']);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test test/validate.test.js`
Expected: FAIL，`Cannot find module '../validate'`

- [ ] **Step 3: 实现 `validate.js`（从 `server.js` 原样搬出）**

```js
'use strict';

// 参数校验：网页接口和 Telegram bot 共用。

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const POWER_ACTIONS = ['boot', 'shutdown', 'restart', 'poweroff'];

function reqId(v, name) {
  const s = v === undefined || v === null ? '' : String(v);
  if (!ID_RE.test(s)) throw new HttpError(400, `缺少或无效的 ${name}`);
  return s;
}

function optId(v, name) {
  return v === undefined || v === null || v === '' ? null : reqId(v, name);
}

function hours(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 24 * 365) throw new HttpError(400, '时长需为 1 以上的整数（小时）');
  return n;
}

function optText(v, name, max) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `${name} 无效或过长`);
  return v;
}

module.exports = { HttpError, ID_RE, POWER_ACTIONS, reqId, optId, hours, optText };
```

- [ ] **Step 4: `server.js` 改为导入**

删除 `server.js` 里 `class HttpError`、`ID_RE`、`POWER_ACTIONS`、`reqId`、`optId`、`hours`、`optText` 的定义（"参数校验"一节中除注释外的全部内容，以及 `HttpError` 类），在 `const alice = require('./alice');` 下面加：

```js
const { HttpError, ID_RE, POWER_ACTIONS, reqId, optId, hours, optText } = require('./validate');
```

（`ID_RE` 仍被 `INST` 常量旁的路由正则外使用与否以实际为准；未使用则不导入。）

- [ ] **Step 5: 运行，确认通过（含原有登录限流测试）**

Run: `node --test`
Expected: PASS

- [ ] **Step 6: 写失败的测试 `test/normalize.test.js`**

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const n = require('../normalize');

test('normInstance：取常见字段，到期 / 创建时间只读 *_at_utc', () => {
  const raw = {
    id: 1001,
    hostname: 'vm-a',
    status: 'active',
    ipv4: [{ address: '203.0.113.7' }],
    plan_id: 38,
    expiration_at: '2026-10-01T20:38:55+01:00',
    expiration_at_utc: '2026-10-01T19:38:55.000Z',
    creation_at_utc: '2026-09-30T19:38:55.000Z',
  };
  const i = n.normInstance(raw);
  assert.equal(i.id, '1001');
  assert.equal(i.name, 'vm-a');
  assert.equal(i.status, 'active');
  assert.equal(i.ipv4, '203.0.113.7');
  assert.equal(i.planId, '38');
  assert.equal(i.expiresAt, Date.parse('2026-10-01T19:38:55.000Z'));
  assert.equal(i.createdAt, Date.parse('2026-09-30T19:38:55.000Z'));
});

test('normInstance：没有规范化时间 / 乱码时间 → null', () => {
  assert.equal(n.normInstance({ id: 1, expiration_at: '2026-10-01T20:38:55+01:00' }).expiresAt, null);
  assert.equal(n.normInstance({ id: 1, expiration_at_utc: 'garbage' }).expiresAt, null);
  assert.equal(n.normInstance({}).id, '');
});

test('asList：数组、{list}、其他对象里的第一个数组', () => {
  assert.deepEqual(n.asList([1]), [1]);
  assert.deepEqual(n.asList({ list: [2] }), [2]);
  assert.deepEqual(n.asList({ foo: [3] }), [3]);
  assert.deepEqual(n.asList(null), []);
});

test('powerState / cardStatus', () => {
  assert.equal(n.powerState({ status: 'complete', state: { state: 'running' } }), 'running');
  assert.equal(n.powerState({}), undefined);
  assert.equal(n.cardStatus({ status: 'active' }, 'running'), 'running');
  assert.equal(n.cardStatus({ status: 'expired' }, 'running'), 'expired');
});

test('statusLabel：中文标签，未知值原样返回', () => {
  assert.equal(n.statusLabel('running'), '运行中');
  assert.equal(n.statusLabel('stopped'), '已关机');
  assert.equal(n.statusLabel('weird'), 'weird');
  assert.equal(n.statusLabel(undefined), '未知');
});

test('套餐：按 allow_packages 过滤，无库存的不可选，max_time 限制时长', () => {
  const plans = n.normPlans([
    { id: 38, name: 'A', cpu: 1, memory: 1, disk: 10, stock: 3 },
    { id: 39, name: 'B', stock: 0 },
    { id: 40, name: 'C', stock: 5 },
  ]);
  const opts = n.planOptions(plans, { allow_packages: '38|39' });
  assert.deepEqual(opts.map((o) => [o.id, o.disabled]), [['38', false], ['39', true]]);
  assert.match(opts[0].label, /A（1 核 · 1 GB 内存 · 10 GB 磁盘，库存 3）/);
  assert.equal(n.maxHours({ max_time: '48' }), 48);
  assert.equal(n.maxHours({}), null);
  assert.deepEqual(n.durationOptions(48), [1, 2, 4, 8, 12, 24, 48]);
  assert.deepEqual(n.durationOptions(null).at(-1), 168);
  assert.equal(n.durationLabel(24), '24 小时（1 天）');
});

test('权限格式不认识时不要把套餐全部藏掉', () => {
  const plans = n.normPlans([{ id: 38, name: 'A' }]);
  assert.equal(n.planOptions(plans, { allow_packages: '99' }).length, 1);
});

test('flattenImages：分组嵌套展开，按 group_id 排序', () => {
  const data = [
    { group_id: 2, group_name: 'Debian', os_list: [{ id: 201, name: 'Debian 12' }] },
    { group_id: 1, group_name: 'Ubuntu', os_list: [{ id: 101, name: 'Ubuntu 24.04' }, { id: 102, name: 'Ubuntu 22.04' }] },
  ];
  assert.deepEqual(n.flattenImages(data), [
    { id: '101', name: 'Ubuntu 24.04', group: 'Ubuntu' },
    { id: '102', name: 'Ubuntu 22.04', group: 'Ubuntu' },
    { id: '201', name: 'Debian 12', group: 'Debian' },
  ]);
});

test('normSshKeys', () => {
  assert.deepEqual(n.normSshKeys([{ id: 5, name: 'laptop' }, { name: 'no-id' }]), [{ id: '5', name: 'laptop' }]);
});

test('decodeOutput：Base64 解码、去掉 ANSI 颜色；不是 Base64 就原样显示', () => {
  const b64 = Buffer.from('\x1b[32mhello\x1b[0m 世界\n').toString('base64');
  assert.equal(n.decodeOutput(b64), 'hello 世界\n');
  assert.equal(n.decodeOutput('plain text'), 'plain text');
});

test('RUNNING_RE', () => {
  assert.ok(n.RUNNING_RE.test('running'));
  assert.ok(n.RUNNING_RE.test('pending'));
  assert.ok(!n.RUNNING_RE.test('complete'));
});
```

- [ ] **Step 7: 运行，确认失败**

Run: `node --test test/normalize.test.js`
Expected: FAIL，`Cannot find module '../normalize'`

- [ ] **Step 8: 实现 `normalize.js`**

从 `web/src/utils.js` 逐个移植（行为一致，改成 CommonJS；`atob` / `TextDecoder` 在 Node 里是全局的）：`pick`、`firstValue`、`asList`、`ipText`、`STATUS_LABELS` + `statusLabel`、`pickName`、`powerState`、`cardStatus`、`specText`（含内部的 `fmtMemory`）、`flattenImages`、`allowedPlanIds`、`maxHours`、`durationOptions`、`durationLabel`、`decodeOutput`、`RUNNING_RE`。与网页版不同的只有三处：

```js
function normInstance(raw) {
  const id = pick(raw, 'id', 'instance_id', 'server_id');
  const time = (key) => {
    const t = Date.parse(raw && raw[key]);
    return Number.isNaN(t) ? null : t;
  };
  const planId = pick(raw, 'plan_id', 'product_id', 'plan.id', 'product.id');
  return {
    raw,
    id: id === undefined ? '' : String(id),
    name: pick(raw, 'hostname', 'name', 'label'),
    status: pick(raw, 'status', 'state', 'power_status', 'power_state'),
    ipv4: ipText(firstValue(raw, 'ipv4', 'ip', 'main_ip', 'ip_address', 'ipv4_address')),
    ipv6: ipText(firstValue(raw, 'ipv6', 'ipv6_address')),
    plan: pick(raw, 'plan.name', 'product.name', 'plan_name', 'product_name', 'plan', 'product'),
    planId: planId === undefined ? undefined : String(planId),
    os: pick(raw, 'os.name', 'os_name', 'os', 'system', 'image', 'template'),
    region: pickName(raw, 'region.name', 'region', 'location', 'datacenter', 'area'),
    // 只读后端规范化后的字段（alice.js 追加）；缺失或乱码时为 null，调度器会跳过该实例。
    expiresAt: time('expiration_at_utc'),
    createdAt: time('creation_at_utc'),
  };
}

// 对应网页 data.js 的 getPlans。
function normPlans(data) {
  return asList(data)
    .map((p) => {
      const id = pick(p, 'id', 'product_id', 'plan_id');
      if (id === undefined) return null;
      return { id: String(id), name: pick(p, 'name', 'title', 'plan_name') || `套餐 #${id}`, specs: specText(p), stock: pick(p, 'stock') };
    })
    .filter(Boolean);
}

// 对应网页 data.js 的 getSshKeys。
function normSshKeys(data) {
  return asList(data)
    .map((k) => {
      const id = pick(k, 'id', 'key_id', 'ssh_key_id');
      return id === undefined ? null : { id: String(id), name: pick(k, 'name', 'title', 'label', 'comment') || `密钥 #${id}` };
    })
    .filter(Boolean);
}
```

`planOptions(plans, perm)` 照搬网页版（`label` 形如 `名称（规格，库存 N）`，无库存为 `无库存`，权限过滤后为空则不过滤）。文件头注释写明："移植自 web/src/utils.js 与 data.js（运行镜像里没有 web/，两边无法共用）；改行为时请对照网页版同名函数。"

- [ ] **Step 9: 运行，确认通过**

Run: `node --test`
Expected: PASS（全部）

- [ ] **Step 10: 提交**

```bash
git add validate.js normalize.js server.js test/validate.test.js test/normalize.test.js
git commit -m "refactor: 抽出校验函数 validate.js，新增后端数据整理 normalize.js

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 状态存储 `store.js`

**Files:**
- Create: `store.js`, `test/store.test.js`

**Interfaces:**
- Consumes: `HttpError` from `validate.js`。
- Produces: `createStore({ dir, now = Date.now, log = console }) → store`；`StoreUnavailableError`（`status === 503`）。`store` 的成员：
  - `available: boolean`（只读属性）
  - `listAutoRenew() → { [id]: { enabled: boolean, hours: number } }`
  - `getAutoRenew(id) → { enabled, hours } | undefined`
  - `setAutoRenew(id, { enabled, hours })`：不可用时抛 `StoreUnavailableError`；写盘失败时回滚内存并抛原错误
  - `removeInstance(id)`：同时清理自动续期设置和周期记录（不可用时只清内存）
  - `getCycle(id) → { renewedFrom?, failedFor?, warnedFor? }`（副本，无记录返回 `{}`）
  - `updateCycle(id, patch)`：先改内存，尽力写盘（失败只记日志，不抛错）
  - `touch(ids: string[])`：给存在的条目刷新 `lastSeen`（距上次超过 1 小时才更新，减少写盘），清理 `lastSeen` 超过 7 天的条目

- [ ] **Step 1: 写失败的测试 `test/store.test.js`**

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../store');

const silent = { warn() {}, error() {}, log() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alice-store-'));

test('设置自动续期并持久化：重新打开后仍然存在，且不留临时文件', () => {
  const dir = tmp();
  const a = createStore({ dir, log: silent });
  assert.equal(a.available, true);
  a.setAutoRenew('1001', { enabled: true, hours: 24 });
  assert.deepEqual(a.getAutoRenew('1001'), { enabled: true, hours: 24 });
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);

  const b = createStore({ dir, log: silent });
  assert.deepEqual(b.listAutoRenew(), { 1001: { enabled: true, hours: 24 } });
});

test('关闭后保留 hours；removeInstance 同时清理设置和周期记录', () => {
  const s = createStore({ dir: tmp(), log: silent });
  s.setAutoRenew('1', { enabled: true, hours: 12 });
  s.setAutoRenew('1', { enabled: false, hours: 12 });
  assert.deepEqual(s.getAutoRenew('1'), { enabled: false, hours: 12 });
  s.updateCycle('1', { renewedFrom: 'x' });
  s.removeInstance('1');
  assert.equal(s.getAutoRenew('1'), undefined);
  assert.deepEqual(s.getCycle('1'), {});
});

test('周期记录：合并更新，返回副本', () => {
  const s = createStore({ dir: tmp(), log: silent });
  s.updateCycle('1', { renewedFrom: 'a' });
  s.updateCycle('1', { failedFor: 'b' });
  const c = s.getCycle('1');
  assert.deepEqual(c, { renewedFrom: 'a', failedFor: 'b' });
  c.renewedFrom = 'changed';
  assert.equal(s.getCycle('1').renewedFrom, 'a');
});

test('状态文件损坏：改名为 .bak，从空状态启动，不抛错', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'state.json'), '{ not json');
  const warnings = [];
  const s = createStore({ dir, log: { ...silent, warn: (m) => warnings.push(m) } });
  assert.deepEqual(s.listAutoRenew(), {});
  assert.ok(fs.existsSync(path.join(dir, 'state.json.bak')));
  assert.equal(warnings.length > 0, true);
  s.setAutoRenew('1', { enabled: true, hours: 1 }); // 之后仍可正常写入
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).autoRenew['1'].enabled, true);
});

test('数据目录不可写：available=false，设置自动续期返回 503，周期记录仍可在内存里使用', () => {
  const file = path.join(tmp(), 'iam-a-file');
  fs.writeFileSync(file, 'x');
  const s = createStore({ dir: path.join(file, 'sub'), log: silent }); // 目录建在文件下面，必然失败
  assert.equal(s.available, false);
  assert.throws(() => s.setAutoRenew('1', { enabled: true, hours: 24 }), (e) => e.status === 503);
  s.updateCycle('1', { warnedFor: 'x' });
  assert.equal(s.getCycle('1').warnedFor, 'x');
  assert.deepEqual(s.listAutoRenew(), {});
});

test('touch：存在的条目保持，超过 7 天没出现的条目被清理', () => {
  let now = Date.parse('2026-10-01T00:00:00Z');
  const s = createStore({ dir: tmp(), now: () => now, log: silent });
  s.setAutoRenew('1', { enabled: true, hours: 24 });
  s.setAutoRenew('2', { enabled: true, hours: 24 });
  s.updateCycle('2', { warnedFor: 'x' });
  now += 6 * 24 * 3600e3;
  s.touch(['1']);
  assert.ok(s.getAutoRenew('1') && s.getAutoRenew('2'));
  now += 2 * 24 * 3600e3; // 实例 2 已经 8 天没出现
  s.touch(['1']);
  assert.ok(s.getAutoRenew('1'));
  assert.equal(s.getAutoRenew('2'), undefined);
  assert.deepEqual(s.getCycle('2'), {});
});

test('touch：1 小时内不重复写盘', () => {
  const dir = tmp();
  let now = Date.parse('2026-10-01T00:00:00Z');
  const s = createStore({ dir, now: () => now, log: silent });
  s.setAutoRenew('1', { enabled: true, hours: 24 });
  s.touch(['1']);
  const before = fs.statSync(path.join(dir, 'state.json')).mtimeMs;
  now += 60e3;
  s.touch(['1']);
  assert.equal(fs.statSync(path.join(dir, 'state.json')).mtimeMs, before);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test test/store.test.js`
Expected: FAIL，`Cannot find module '../store'`

- [ ] **Step 3: 实现 `store.js`**

```js
'use strict';

// 持久化：${DATA_DIR}/state.json，保存每个实例的自动续期设置和"这个到期点已处理过"的去重记录。
// 写入是"写临时文件 → rename"的同步操作，进程异常退出也不会留下半个文件。

const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./validate');

const STALE_MS = 7 * 24 * 3600 * 1000;
const TOUCH_MS = 3600 * 1000;

class StoreUnavailableError extends HttpError {
  constructor() {
    super(503, '自动续期需要可写的数据目录（DATA_DIR），当前不可用，请查看 README 的部署说明');
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function createStore({ dir, now = Date.now, log = console }) {
  const file = path.join(dir, 'state.json');
  let state = { version: 1, autoRenew: {}, cycle: {} };
  let available = false;

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    available = true;
  } catch (err) {
    log.warn(`[store] 数据目录 ${dir} 不可写（${err.message}），自动续期不可用`);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isObj(parsed) || !isObj(parsed.autoRenew)) throw new Error('结构不正确');
    state = { version: 1, autoRenew: parsed.autoRenew, cycle: isObj(parsed.cycle) ? parsed.cycle : {} };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.warn(`[store] 状态文件无法读取（${err.message}），已忽略并从空状态开始`);
      if (available) {
        try {
          fs.renameSync(file, `${file}.bak`);
        } catch {
          /* 备份失败不影响启动 */
        }
      }
    }
  }

  function save() {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }

  // 先改内存再写盘；写盘失败时回滚内存并把原错误抛出。
  function commit(change) {
    const before = JSON.stringify(state);
    change();
    try {
      save();
    } catch (err) {
      state = JSON.parse(before);
      throw err;
    }
  }

  const view = (e) => ({ enabled: Boolean(e.enabled), hours: e.hours });

  return {
    get available() {
      return available;
    },
    listAutoRenew() {
      return Object.fromEntries(Object.entries(state.autoRenew).map(([id, e]) => [id, view(e)]));
    },
    getAutoRenew(id) {
      const e = state.autoRenew[id];
      return e ? view(e) : undefined;
    },
    setAutoRenew(id, { enabled, hours }) {
      if (!available) throw new StoreUnavailableError();
      commit(() => {
        const t = new Date(now()).toISOString();
        state.autoRenew[id] = { enabled: Boolean(enabled), hours, updatedAt: t, lastSeen: t };
      });
    },
    removeInstance(id) {
      if (!(id in state.autoRenew) && !(id in state.cycle)) return;
      const change = () => {
        delete state.autoRenew[id];
        delete state.cycle[id];
      };
      if (available) commit(change);
      else change();
    },
    getCycle(id) {
      const { renewedFrom, failedFor, warnedFor } = state.cycle[id] || {};
      return Object.fromEntries(Object.entries({ renewedFrom, failedFor, warnedFor }).filter(([, v]) => v !== undefined));
    },
    updateCycle(id, patch) {
      const change = () => {
        state.cycle[id] = { ...state.cycle[id], ...patch };
      };
      if (!available) return change();
      try {
        commit(change);
      } catch (err) {
        log.error(`[store] 保存状态失败：${err.message}`);
        change(); // 去重记录至少保留在内存里，避免重复续期 / 重复提醒
      }
      return undefined;
    },
    touch(ids) {
      const present = new Set(ids);
      const t = now();
      let changed = false;
      for (const map of [state.autoRenew, state.cycle]) {
        for (const [id, rec] of Object.entries(map)) {
          const seen = rec.lastSeen ? Date.parse(rec.lastSeen) : NaN;
          if (present.has(id)) {
            if (Number.isNaN(seen) || t - seen > TOUCH_MS) {
              rec.lastSeen = new Date(t).toISOString();
              changed = true;
            }
          } else if (Number.isNaN(seen)) {
            rec.lastSeen = new Date(t).toISOString(); // 从现在开始计时
            changed = true;
          } else if (t - seen > STALE_MS) {
            delete map[id];
            changed = true;
          }
        }
      }
      if (changed && available) {
        try {
          save();
        } catch (err) {
          log.error(`[store] 保存状态失败：${err.message}`);
        }
      }
    },
  };
}

module.exports = { createStore, StoreUnavailableError };
```

- [ ] **Step 4: 运行，确认通过**

Run: `node --test test/store.test.js`
Expected: PASS（7 个测试）

- [ ] **Step 5: 提交**

```bash
git add store.js test/store.test.js
git commit -m "feat: 新增状态存储 store.js（自动续期设置与去重记录，原子写入）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 配置解析与调度器

**Files:**
- Create: `config.js`, `scheduler.js`, `test/config.test.js`, `test/scheduler.test.js`

**Interfaces:**
- Consumes: `store`（Task 3）、`normalize.asList` / `normInstance`（Task 2）、`alice.listInstances` / `alice.renew` / `alice.configured`。
- Produces（`config.js`）：`loadConfig(env = process.env, warn = console.warn) → { dataDir, renewBeforeMinutes, warnMinutes, intervalSeconds, displayTimeZone, telegram: { enabled, token, allowedIds: string[], apiBase, error? } }`。
- Produces（`scheduler.js`）：`decide({ entry, inst, cycle, now, cfg }) → 'renew' | 'warn' | 'none'`，`cfg = { renewBeforeMs, warnBeforeMs, botEnabled }`；`createScheduler({ alice, store, notify, cfg, now = Date.now, log = console }) → { tick(): Promise<void>, start(), stop() }`，`cfg` 另含 `intervalMs`。`notify(event)` 的 `event` 是 `{ type: 'renewed', inst, hours, expires } | { type: 'renew_failed', inst, error } | { type: 'expiring', inst }`（`inst` 为 `normInstance` 的结果，`expires` 为 ISO 字符串或 `undefined`）。

- [ ] **Step 1: 写失败的测试 `test/config.test.js`**

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../config');

const load = (env) => {
  const warnings = [];
  return { cfg: loadConfig(env, (m) => warnings.push(m)), warnings };
};

test('默认值', () => {
  const { cfg, warnings } = load({});
  assert.equal(cfg.renewBeforeMinutes, 10);
  assert.equal(cfg.warnMinutes, 30);
  assert.equal(cfg.intervalSeconds, 60);
  assert.equal(cfg.displayTimeZone, 'Asia/Shanghai');
  assert.equal(cfg.dataDir, path.join(__dirname, '..', 'data'));
  assert.equal(cfg.telegram.enabled, false);
  assert.equal(cfg.telegram.apiBase, 'https://api.telegram.org');
  assert.deepEqual(warnings, []);
});

test('非法数值回退默认并警告；EXPIRY_WARN_MINUTES=0 合法（关闭提醒）', () => {
  const { cfg, warnings } = load({ AUTO_RENEW_BEFORE_MINUTES: 'abc', AUTO_RENEW_INTERVAL_SECONDS: '0', EXPIRY_WARN_MINUTES: '0' });
  assert.equal(cfg.renewBeforeMinutes, 10);
  assert.equal(cfg.intervalSeconds, 60);
  assert.equal(cfg.warnMinutes, 0);
  assert.equal(warnings.length, 2);
});

test('DATA_DIR 和 DISPLAY_TIME_ZONE；非法时区回退并警告', () => {
  assert.equal(load({ DATA_DIR: '/data' }).cfg.dataDir, '/data');
  assert.equal(load({ DISPLAY_TIME_ZONE: 'America/New_York' }).cfg.displayTimeZone, 'America/New_York');
  const { cfg, warnings } = load({ DISPLAY_TIME_ZONE: 'Mars/Base' });
  assert.equal(cfg.displayTimeZone, 'Asia/Shanghai');
  assert.equal(warnings.length, 1);
});

test('Telegram：token + 数字 ID 才启用；ID 里混入非数字会被忽略并警告', () => {
  const ok = load({ TELEGRAM_BOT_TOKEN: ' 123:abc ', TELEGRAM_ALLOWED_USER_IDS: '42, 43 @someone' }).cfg.telegram;
  assert.equal(ok.enabled, true);
  assert.equal(ok.token, '123:abc');
  assert.deepEqual(ok.allowedIds, ['42', '43']);
});

test('Telegram：设置了 token 但没有有效的用户 ID → 不启用并给出错误（失败默认关闭）', () => {
  for (const ids of [undefined, '', '@someone']) {
    const t = load({ TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_ALLOWED_USER_IDS: ids }).cfg.telegram;
    assert.equal(t.enabled, false);
    assert.match(t.error, /TELEGRAM_ALLOWED_USER_IDS/);
  }
});

test('TELEGRAM_API_BASE 去掉末尾斜杠', () => {
  assert.equal(load({ TELEGRAM_API_BASE: 'https://tg.example.com//' }).cfg.telegram.apiBase, 'https://tg.example.com');
});
```

- [ ] **Step 2: 运行，确认失败，然后实现 `config.js`**

Run: `node --test test/config.test.js` → FAIL（找不到模块）

```js
'use strict';

const path = require('node:path');

function intInRange(raw, name, def, min, max, warn) {
  if (raw === undefined || String(raw).trim() === '') return def;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= min && n <= max) return n;
  warn(`${name}=${raw} 无效（需为 ${min} ~ ${max} 的整数），已使用默认值 ${def}`);
  return def;
}

function timeZone(raw, def, warn) {
  if (raw === undefined || String(raw).trim() === '') return def;
  try {
    new Intl.DateTimeFormat('en', { timeZone: String(raw).trim() });
    return String(raw).trim();
  } catch {
    warn(`DISPLAY_TIME_ZONE=${raw} 不是有效的 IANA 时区，已使用默认值 ${def}`);
    return def;
  }
}

function loadConfig(env = process.env, warn = (msg) => console.warn(`[panel] ${msg}`)) {
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  const rawIds = String(env.TELEGRAM_ALLOWED_USER_IDS || '').split(/[,\s]+/).filter(Boolean);
  const allowedIds = rawIds.filter((s) => /^\d{1,15}$/.test(s));
  for (const bad of rawIds.filter((s) => !allowedIds.includes(s))) {
    warn(`TELEGRAM_ALLOWED_USER_IDS 里的 "${bad}" 不是数字用户 ID，已忽略`);
  }

  const telegram = {
    enabled: false,
    token,
    allowedIds,
    apiBase: String(env.TELEGRAM_API_BASE || 'https://api.telegram.org').trim().replace(/\/+$/, ''),
  };
  if (token && allowedIds.length) telegram.enabled = true;
  else if (token) telegram.error = '设置了 TELEGRAM_BOT_TOKEN，但 TELEGRAM_ALLOWED_USER_IDS 没有有效的数字用户 ID，bot 不会启动';

  return {
    dataDir: env.DATA_DIR || path.join(__dirname, 'data'),
    renewBeforeMinutes: intInRange(env.AUTO_RENEW_BEFORE_MINUTES, 'AUTO_RENEW_BEFORE_MINUTES', 10, 1, 120, warn),
    warnMinutes: intInRange(env.EXPIRY_WARN_MINUTES, 'EXPIRY_WARN_MINUTES', 30, 0, 1440, warn),
    intervalSeconds: intInRange(env.AUTO_RENEW_INTERVAL_SECONDS, 'AUTO_RENEW_INTERVAL_SECONDS', 60, 1, 600, warn),
    displayTimeZone: timeZone(env.DISPLAY_TIME_ZONE, 'Asia/Shanghai', warn),
    telegram,
  };
}

module.exports = { loadConfig };
```

Run: `node --test test/config.test.js` → PASS

- [ ] **Step 3: 写失败的测试 `test/scheduler.test.js`**

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../store');
const { createScheduler, decide } = require('../scheduler');

const silent = { warn() {}, error() {}, log() {} };
const NOW = Date.parse('2026-10-01T12:00:00Z');
const MIN = 60e3;
const cfg = { renewBeforeMs: 10 * MIN, warnBeforeMs: 30 * MIN, botEnabled: true, intervalMs: 60e3 };
const inst = (minLeft, status = 'active') => ({ id: '1', status, expiresAt: NOW + minLeft * MIN });
const on = { enabled: true, hours: 24 };
const off = { enabled: false, hours: 24 };
const D = (args) => decide({ now: NOW, cfg, cycle: {}, ...args });

test('decide：已开启自动续期，剩余时间进入窗口才续期', () => {
  assert.equal(D({ entry: on, inst: inst(11) }), 'none');
  assert.equal(D({ entry: on, inst: inst(10) }), 'renew');
  assert.equal(D({ entry: on, inst: inst(1) }), 'renew');
});

test('decide：已到期、实例状态为 expired、没有到期时间 → 不处理', () => {
  assert.equal(D({ entry: on, inst: inst(0) }), 'none');
  assert.equal(D({ entry: on, inst: inst(-5) }), 'none');
  assert.equal(D({ entry: on, inst: inst(5, 'expired') }), 'none');
  assert.equal(D({ entry: on, inst: { id: '1', status: 'active', expiresAt: null } }), 'none');
});

test('decide：这个到期点已经续过 → 不重复续', () => {
  const i = inst(5);
  const cycle = { renewedFrom: new Date(i.expiresAt).toISOString() };
  assert.equal(D({ entry: on, inst: i, cycle }), 'none');
  // 到期时间变了（续期成功后），又是新的周期
  assert.equal(D({ entry: on, inst: inst(5), cycle: { renewedFrom: '2020-01-01T00:00:00.000Z' } }), 'renew');
});

test('decide：未开启自动续期 → 只在 bot 启用且进入提醒窗口时 warn，每个到期点一次', () => {
  for (const entry of [undefined, off]) {
    assert.equal(D({ entry, inst: inst(31) }), 'none');
    assert.equal(D({ entry, inst: inst(30) }), 'warn');
    assert.equal(D({ entry, inst: inst(5) }), 'warn');
  }
  const i = inst(20);
  assert.equal(D({ inst: i, cycle: { warnedFor: new Date(i.expiresAt).toISOString() } }), 'none');
  assert.equal(decide({ now: NOW, inst: inst(20), cfg: { ...cfg, botEnabled: false } }), 'none');
  assert.equal(decide({ now: NOW, inst: inst(20), cfg: { ...cfg, warnBeforeMs: 0 } }), 'none');
});

// ---------- tick ----------

function setup({ instances, renew, autoRenew = { 1: on }, botEnabled = true, listInstances } = {}) {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'alice-sched-')), now: () => clock.now, log: silent });
  for (const [id, e] of Object.entries(autoRenew)) store.setAutoRenew(id, e);
  const calls = { list: 0, renew: [] };
  const events = [];
  const alice = {
    configured: () => true,
    listInstances: listInstances || (async () => { calls.list += 1; return instances(); }),
    renew: async (id, hours) => {
      calls.renew.push([id, hours]);
      return renew ? renew(id, hours) : { expiration_at_utc: new Date(clock.now + hours * 3600e3).toISOString() };
    },
  };
  const scheduler = createScheduler({
    alice, store, notify: async (e) => { events.push(e); }, cfg: { ...cfg, botEnabled }, now: () => clock.now, log: silent,
  });
  return { scheduler, calls, events, store };
}
const clock = { now: NOW };
const raw = (minLeft, extra = {}) => ({ id: 1, hostname: 'vm', status: 'active', expiration_at_utc: new Date(NOW + minLeft * MIN).toISOString(), ...extra });

test('tick：进入窗口时续期并通知；列表仍是旧到期时间的下一轮不会重复续期', async () => {
  clock.now = NOW;
  const { scheduler, calls, events } = setup({ instances: () => [raw(5)] });
  await scheduler.tick();
  await scheduler.tick(); // 列表还是旧到期时间（比如 Alice 侧有延迟）
  assert.deepEqual(calls.renew, [['1', 24]]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'renewed');
  assert.equal(events[0].hours, 24);
  assert.equal(events[0].inst.id, '1');
});

test('tick：续期成功后到期时间变长，不再续期', async () => {
  clock.now = NOW;
  let left = 5;
  const { scheduler, calls } = setup({ instances: () => [raw(left)] });
  await scheduler.tick();
  left = 24 * 60 + 5;
  await scheduler.tick();
  assert.equal(calls.renew.length, 1);
});

test('tick：续期失败只通知一次，但每轮都会重试', async () => {
  clock.now = NOW;
  const { scheduler, calls, events } = setup({
    instances: () => [raw(5)],
    renew: () => { throw new Error('余额不足'); },
  });
  await scheduler.tick();
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(calls.renew.length, 3);
  assert.deepEqual(events.map((e) => e.type), ['renew_failed']);
  assert.equal(events[0].error, '余额不足');
});

test('tick：两轮重叠时只执行一轮', async () => {
  clock.now = NOW;
  let release;
  const gate = new Promise((r) => { release = r; });
  const { scheduler, calls } = setup({
    listInstances: async () => { calls.list += 1; await gate; return [raw(5)]; },
  });
  const first = scheduler.tick();
  await scheduler.tick(); // 第一轮还没结束，直接跳过
  release();
  await first;
  assert.equal(calls.list, 1);
  assert.equal(calls.renew.length, 1);
});

test('tick：没有开启的自动续期且 bot 未启用时，不调用 Alice', async () => {
  clock.now = NOW;
  const { scheduler, calls } = setup({ instances: () => [raw(5)], autoRenew: { 1: off }, botEnabled: false });
  await scheduler.tick();
  assert.equal(calls.list, 0);
});

test('tick：bot 启用且未开自动续期的实例进入窗口时提醒一次', async () => {
  clock.now = NOW;
  const { scheduler, events, calls } = setup({ instances: () => [raw(20)], autoRenew: {} });
  await scheduler.tick();
  await scheduler.tick();
  assert.deepEqual(events.map((e) => e.type), ['expiring']);
  assert.equal(calls.renew.length, 0);
});

test('tick：拉取列表失败、时间字段是乱码，都不抛错也不通知', async () => {
  clock.now = NOW;
  const a = setup({ listInstances: async () => { throw new Error('网络错误'); } });
  await a.scheduler.tick();
  assert.equal(a.events.length, 0);
  const b = setup({ instances: () => [raw(5, { expiration_at_utc: 'garbage' })] });
  await b.scheduler.tick();
  assert.equal(b.calls.renew.length, 0);
});

test('tick：Alice 未配置凭据时不调用', async () => {
  clock.now = NOW;
  const { scheduler, calls } = setup({ instances: () => [raw(5)] });
  // 重新建一个 alice.configured() === false 的调度器
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'alice-sched-')), log: silent });
  store.setAutoRenew('1', on);
  let listed = 0;
  const s = createScheduler({ alice: { configured: () => false, listInstances: async () => { listed += 1; return []; } }, store, notify: async () => {}, cfg, now: () => NOW, log: silent });
  await s.tick();
  assert.equal(listed, 0);
  assert.equal(calls.list, 0);
  void scheduler;
});
```

- [ ] **Step 4: 运行，确认失败**

Run: `node --test test/scheduler.test.js`
Expected: FAIL，`Cannot find module '../scheduler'`

- [ ] **Step 5: 实现 `scheduler.js`**

```js
'use strict';

// 调度器：每轮拉一次实例列表，对已开启自动续期的实例在到期前续期，
// 对没开自动续期的实例（bot 启用时）在到期前提醒一次。
// "要不要做"的判断是纯函数 decide()，不碰网络。

const { asList, normInstance } = require('./normalize');

const isoOf = (ms) => new Date(ms).toISOString();

function decide({ entry, inst, cycle = {}, now, cfg }) {
  if (!inst.expiresAt || /expire/i.test(String(inst.status ?? ''))) return 'none';
  const remaining = inst.expiresAt - now;
  if (remaining <= 0) return 'none'; // 已到期，实例可能已被回收
  const key = isoOf(inst.expiresAt);
  if (entry && entry.enabled) {
    return remaining <= cfg.renewBeforeMs && cycle.renewedFrom !== key ? 'renew' : 'none';
  }
  if (cfg.botEnabled && cfg.warnBeforeMs > 0 && remaining <= cfg.warnBeforeMs && cycle.warnedFor !== key) return 'warn';
  return 'none';
}

function createScheduler({ alice, store, notify, cfg, now = Date.now, log = console }) {
  let running = false;
  let timer = null;

  const send = async (event) => {
    try {
      await notify(event);
    } catch (err) {
      log.warn(`[auto-renew] 发送通知失败：${err.message}`);
    }
  };

  async function renew(inst, entry) {
    const key = isoOf(inst.expiresAt);
    try {
      const res = await alice.renew(inst.id, entry.hours);
      store.updateCycle(inst.id, { renewedFrom: key });
      const expires = res && typeof res === 'object' ? res.expiration_at_utc : undefined;
      log.log(`[auto-renew] 实例 ${inst.id} 已自动续期 ${entry.hours} 小时`);
      await send({ type: 'renewed', inst, hours: entry.hours, expires });
    } catch (err) {
      log.warn(`[auto-renew] 实例 ${inst.id} 自动续期失败：${err.message}`);
      if (store.getCycle(inst.id).failedFor !== key) {
        store.updateCycle(inst.id, { failedFor: key });
        await send({ type: 'renew_failed', inst, error: err.message });
      }
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      if (alice.configured && !alice.configured()) return;
      const anyEnabled = Object.values(store.listAutoRenew()).some((e) => e.enabled);
      if (!anyEnabled && !cfg.botEnabled) return;

      let list;
      try {
        list = asList(await alice.listInstances()).map(normInstance);
      } catch (err) {
        log.warn(`[auto-renew] 获取实例列表失败：${err.message}`);
        return;
      }
      store.touch(list.map((i) => i.id));

      for (const inst of list) {
        if (!inst.id) continue;
        const entry = store.getAutoRenew(inst.id);
        const action = decide({ entry, inst, cycle: store.getCycle(inst.id), now: now(), cfg });
        if (action === 'renew') {
          await renew(inst, entry);
        } else if (action === 'warn') {
          store.updateCycle(inst.id, { warnedFor: isoOf(inst.expiresAt) });
          await send({ type: 'expiring', inst });
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      const run = () => tick().catch((err) => log.error(`[auto-renew] 调度出错：${err.message}`));
      // 启动后很快跑第一轮，之后按间隔轮询。
      const first = setTimeout(run, Math.min(5000, cfg.intervalMs));
      first.unref();
      timer = setInterval(run, cfg.intervalMs);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { decide, createScheduler };
```

- [ ] **Step 6: 运行，确认通过**

Run: `node --test`
Expected: PASS（全部）

- [ ] **Step 7: 提交**

```bash
git add config.js scheduler.js test/config.test.js test/scheduler.test.js
git commit -m "feat: 新增配置解析与自动续期调度器

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 接入服务端（接口、清理、启动调度器）与集成测试

**Files:**
- Create: `test/helpers/mock-alice.js`, `test/server-auto-renew.test.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `loadConfig`（Task 4）、`createStore`（Task 3）、`createScheduler`（Task 4）、`HttpError`、`hours`、`reqId`（Task 2）。
- Produces（HTTP）：`GET /api/auto-renew` → `{ data: { available, items: { [id]: { enabled, hours } } } }`；`POST /api/instances/:id/auto-renew`，body `{ enabled: boolean, hours?: int }` → `{ data: { enabled, hours } }`；`DELETE /api/instances/:id` 成功后清理该实例的自动续期设置。
- Produces（`mock-alice.js`）：`startMockAlice() → Promise<{ base, instances, calls, close() }>`，`instances` 是可修改的数组（元素是 Alice 风格的原始记录），`calls` 记录 `{ method, path, body }`。

- [ ] **Step 1: 写测试替身 `test/helpers/mock-alice.js`**

```js
'use strict';

// 本地假 Alice API：用于集成测试和手动验收（ALICE_API_BASE 指向它）。
// 复刻真实数据的怪癖：creation_at 的钟面是 UTC+8 但标签写成 +01:00，expiration_at 用 +01:00 自洽表示。

const http = require('node:http');

const HOUR = 3600e3;
const pad = (n) => String(n).padStart(2, '0');
// 与 Alice 一致：创建时间 = UTC+8 的钟面 + 错误的 +01:00 标签
const creationAt = (ms) => `${new Date(ms + 8 * HOUR).toISOString().slice(0, 19)}+01:00`;
// 到期时间 = 真实的 +01:00 钟面
const expirationAt = (ms) => `${new Date(ms + HOUR).toISOString().slice(0, 19)}+01:00`;

function makeInstance(id, { createdMs, expiresMs, hostname = `vm-${id}` }) {
  return {
    id,
    hostname,
    status: 'active',
    plan_id: 38,
    ipv4: '203.0.113.7',
    creation_at: creationAt(createdMs),
    expiration_at: expirationAt(expiresMs),
  };
}

function startMockAlice() {
  const instances = [];
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text ? JSON.parse(text) : undefined;
      const url = req.url.split('?')[0];
      calls.push({ method: req.method, path: url, body });
      const ok = (data) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 200, message: 'ok', data }));
      };
      let m;
      if (req.method === 'GET' && url === '/evo/instances') return ok(instances);
      if (req.method === 'GET' && (m = url.match(/^\/evo\/instances\/([^/]+)\/state$/))) {
        return ok({ status: 'complete', state: { state: 'running', cpu: 1.5 } });
      }
      if (req.method === 'POST' && (m = url.match(/^\/evo\/instances\/([^/]+)\/renewals$/))) {
        const inst = instances.find((i) => String(i.id) === m[1]);
        if (!inst) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ code: 404, message: 'not found' }));
        }
        const current = Date.parse(inst.expiration_at);
        inst.expiration_at = expirationAt(current + body.time * HOUR);
        return ok({ expiration_at: inst.expiration_at });
      }
      if (req.method === 'DELETE' && (m = url.match(/^\/evo\/instances\/([^/]+)$/))) {
        const i = instances.findIndex((x) => String(x.id) === m[1]);
        if (i >= 0) instances.splice(i, 1);
        return ok(null);
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ code: 404, message: 'not found' }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        instances,
        calls,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { startMockAlice, makeInstance, pad };
```

- [ ] **Step 2: 写失败的集成测试 `test/server-auto-renew.test.js`**

```js
'use strict';

// 启动真实的 server.js + 假 Alice，只通过 HTTP 验证：时间规范化、自动续期接口、持久化、调度器续期、删除清理。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { startMockAlice, makeInstance } = require('./helpers/mock-alice');

const SERVER = path.join(__dirname, '..', 'server.js');
const HOUR = 3600e3;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startPanel(t, { alice, dataDir, env = {} }) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PANEL_PASSWORD: 'correct-password',
      HOST: '127.0.0.1',
      PORT: String(port),
      ALICE_API_BASE: alice.base,
      ALICE_CLIENT_ID: 'cli_test',
      ALICE_SECRET: 'secret',
      DATA_DIR: dataDir,
      AUTO_RENEW_INTERVAL_SECONDS: '1',
      AUTO_RENEW_BEFORE_MINUTES: '10',
      ...env,
    },
    stdio: 'ignore',
  });
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {
      /* 还没启动完 */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Panel': '1' },
    body: JSON.stringify({ password: 'correct-password' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Panel': '1', Cookie: cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { base, call };
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alice-int-'));
const waitFor = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

test('GET /api/instances：追加规范化时间，原始字段保持不变', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const created = Date.parse('2026-09-30T19:38:55Z');
  alice.instances.push(makeInstance(1001, { createdMs: created, expiresMs: created + 24 * HOUR }));
  const { call } = await startPanel(t, { alice, dataDir: tmpDir() });

  const r = await call('GET', '/api/instances');
  const inst = r.json.data[0];
  assert.equal(inst.creation_at, '2026-10-01T03:38:55+01:00'); // 原始值（偏移标签有误）原样保留
  assert.equal(inst.creation_at_utc, '2026-09-30T19:38:55.000Z');
  assert.equal(inst.expiration_at_utc, '2026-10-01T19:38:55.000Z');
});

test('自动续期接口：默认关闭、校验参数、持久化', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const dir = tmpDir();
  const { call } = await startPanel(t, { alice, dataDir: dir });

  assert.deepEqual((await call('GET', '/api/auto-renew')).json.data, { available: true, items: {} });

  assert.equal((await call('POST', '/api/instances/1001/auto-renew', { enabled: true, hours: 0 })).status, 400);
  assert.equal((await call('POST', '/api/instances/1001/auto-renew', { enabled: 'yes', hours: 24 })).status, 400);
  assert.equal((await call('POST', '/api/instances/1001/auto-renew', { enabled: true })).status, 400);
  assert.equal((await call('POST', '/api/instances/a%20b/auto-renew', { enabled: true, hours: 24 })).status, 404);
  // 缺少 X-Panel 头（CSRF 防护）
  assert.equal((await call('POST', '/api/instances/1001/auto-renew', { enabled: true, hours: 24 }, { 'X-Panel': '' })).status, 403);

  const on = await call('POST', '/api/instances/1001/auto-renew', { enabled: true, hours: 24 });
  assert.deepEqual(on.json.data, { enabled: true, hours: 24 });
  assert.deepEqual((await call('GET', '/api/auto-renew')).json.data.items, { 1001: { enabled: true, hours: 24 } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).autoRenew['1001'].enabled, true);

  const off = await call('POST', '/api/instances/1001/auto-renew', { enabled: false });
  assert.deepEqual(off.json.data, { enabled: false, hours: 24 }); // 关闭时保留之前的时长
});

test('数据目录不可写：available=false，开启自动续期返回 503，面板其余功能正常', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const file = path.join(tmpDir(), 'iam-a-file');
  fs.writeFileSync(file, 'x');
  const { call } = await startPanel(t, { alice, dataDir: path.join(file, 'sub') });

  assert.equal((await call('GET', '/api/auto-renew')).json.data.available, false);
  const r = await call('POST', '/api/instances/1001/auto-renew', { enabled: true, hours: 24 });
  assert.equal(r.status, 503);
  assert.match(r.json.error, /DATA_DIR/);
  assert.equal((await call('GET', '/api/instances')).status, 200);
});

test('调度器：开启自动续期的实例进入窗口后被续期一次，之后不会重复续期', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const now = Date.now();
  alice.instances.push(makeInstance(1001, { createdMs: now - 23 * HOUR, expiresMs: now + 5 * 60e3 })); // 5 分钟后到期
  alice.instances.push(makeInstance(1002, { createdMs: now - 23 * HOUR, expiresMs: now + 5 * 60e3 })); // 没开自动续期
  const { call } = await startPanel(t, { alice, dataDir: tmpDir() });

  await call('POST', '/api/instances/1001/auto-renew', { enabled: true, hours: 24 });
  const renewals = () => alice.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/renewals'));
  assert.equal(await waitFor(() => renewals().length >= 1), true, '应该发起续期');
  await new Promise((r) => setTimeout(r, 3500)); // 再跑几轮
  assert.deepEqual(renewals().map((c) => [c.path, c.body]), [['/evo/instances/1001/renewals', { time: 24 }]]);
});

test('删除实例后清理它的自动续期设置', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const now = Date.now();
  alice.instances.push(makeInstance(1001, { createdMs: now, expiresMs: now + 24 * HOUR }));
  const { call } = await startPanel(t, { alice, dataDir: tmpDir() });

  await call('POST', '/api/instances/1001/auto-renew', { enabled: true, hours: 24 });
  assert.equal((await call('DELETE', '/api/instances/1001')).status, 200);
  assert.deepEqual((await call('GET', '/api/auto-renew')).json.data.items, {});
});
```

- [ ] **Step 3: 运行，确认失败**

Run: `node --test test/server-auto-renew.test.js`
Expected: FAIL（接口 404、`creation_at_utc` 已通过 Task 1 但自动续期接口不存在）

- [ ] **Step 4: 修改 `server.js`**

在 `require('./validate')` 之后加入：

```js
const { loadConfig } = require('./config');
const { createStore } = require('./store');
const { createScheduler } = require('./scheduler');
```

在启动检查（`PASSWORD.length < 8` 之前）之后加入：

```js
const config = loadConfig();
const store = createStore({ dir: config.dataDir });
```

在 `routes` 数组里，`'GET', /^\/api\/plans\$/` 之前加一条，并在实例相关路由里加上自动续期与删除清理：

```js
  ['GET', /^\/api\/auto-renew$/, () => ({ available: store.available, items: store.listAutoRenew() })],
```

```js
  ['POST', new RegExp(`^${INST}/auto-renew$`), (m, b) => {
    if (typeof b.enabled !== 'boolean') throw new HttpError(400, 'enabled 需为 true 或 false');
    const prev = store.getAutoRenew(m[1]);
    // 关闭时可以不带 hours，沿用之前的设置（没有则 24）。
    const h = b.enabled || b.hours !== undefined ? hours(b.hours) : (prev ? prev.hours : 24);
    store.setAutoRenew(m[1], { enabled: b.enabled, hours: h });
    return { enabled: b.enabled, hours: h };
  }],
```

把删除路由改为：

```js
  ['DELETE', new RegExp(`^${INST}$`), async (m) => {
    const result = await alice.destroy(m[1]);
    store.removeInstance(m[1]);
    return result;
  }],
```

在 `server.listen(...)` 之后、`process.on` 信号处理之前加入：

```js
const scheduler = createScheduler({
  alice,
  store,
  notify: async () => {}, // Task 9 接入 Telegram 推送
  cfg: {
    renewBeforeMs: config.renewBeforeMinutes * 60e3,
    warnBeforeMs: config.warnMinutes * 60e3,
    botEnabled: false,
    intervalMs: config.intervalSeconds * 1000,
  },
});
scheduler.start();
```

- [ ] **Step 5: 运行，确认通过**

Run: `node --test`
Expected: PASS（全部，含原有登录限流测试）

- [ ] **Step 6: 提交**

```bash
git add server.js test/helpers/mock-alice.js test/server-auto-renew.test.js
git commit -m "feat: 自动续期接口与调度器接入服务端，删除实例时清理设置

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 网页端自动续期界面

**Files:**
- Create: `web/src/dialogs/AutoRenewDialog.jsx`
- Modify: `web/src/InstanceCard.jsx`, `web/src/Dashboard.jsx`

**Interfaces:**
- Consumes: `GET /api/auto-renew`、`POST /api/instances/:id/auto-renew`（Task 5）；`FormDialog`、`DurationField`（`components.jsx`）；`useMaxHours`、`useClampedHours`（`DeployDialog.jsx`）。
- Produces: `AutoRenewDialog({ open, onClose, onExited, inst, state, withBusy, onChanged })`，`state` 为 `{ available, items }`；`InstanceCard` 新增 prop `autoRenew`（`{ enabled, hours } | undefined`）；菜单动作 `'autorenew'`。

（前端没有测试框架：用打包 + 假 Alice 运行面板后在浏览器里手动检查来验证。）

- [ ] **Step 1: 新建 `web/src/dialogs/AutoRenewDialog.jsx`**

```jsx
import { useState } from 'react';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { api, enc } from '../api.js';
import { DurationField, FormDialog } from '../components.jsx';
import { useNotify } from '../notify.jsx';
import { useClampedHours, useMaxHours } from './DeployDialog.jsx';

export default function AutoRenewDialog({ open, onClose, onExited, inst, state, withBusy, onChanged }) {
  const notify = useNotify();
  const max = useMaxHours();
  const current = state.items[inst.id];
  const [enabled, setEnabled] = useState(Boolean(current && current.enabled));
  const [time, setTime] = useClampedHours(String((current && current.hours) || 24), max);

  const submit = async () => {
    await withBusy(inst, () => api('POST', `/api/instances/${enc(inst.id)}/auto-renew`, enabled ? { enabled: true, hours: Number(time) } : { enabled: false }));
    notify(enabled ? `已开启自动续期：到期前自动续 ${time} 小时` : '已关闭自动续期', 'success');
    onChanged();
  };

  return (
    <FormDialog open={open} onClose={onClose} onExited={onExited} title={`自动续期 · ${inst.name || `#${inst.id}`}`} submitText="保存" maxWidth="xs" onSubmit={submit}>
      {!state.available && (
        <Alert severity="warning">服务器没有可写的数据目录（DATA_DIR），暂时无法保存自动续期设置。请按 README 挂载数据卷后重试。</Alert>
      )}
      <Typography variant="body2" color="text.secondary">
        开启后，面板会在实例到期前约 10 分钟自动续期，不需要保持页面打开。每次续期会扣费，余额不足时续期会失败。
      </Typography>
      <FormControlLabel control={<Switch checked={enabled} disabled={!state.available} onChange={(e) => setEnabled(e.target.checked)} />} label="启用自动续期" />
      {enabled && <DurationField label="每次续期时长" value={time} onChange={setTime} max={max} />}
    </FormDialog>
  );
}
```

- [ ] **Step 2: 修改 `web/src/InstanceCard.jsx`**

加图标导入：

```jsx
import AutorenewIcon from '@mui/icons-material/Autorenew';
```

`MENU` 里在"续期"之后加：

```jsx
  { action: 'autorenew', label: '自动续期', icon: <AutorenewIcon fontSize="small" /> },
```

组件签名改为 `InstanceCard({ inst, power, autoRenew, busy, onAction })`，并在"到期"那一行的倒计时 `Chip` 之后加标签：

```jsx
            {inst.expires && <Countdown to={inst.expires} />}
            {autoRenew && autoRenew.enabled && (
              <Chip size="small" color="info" variant="outlined" icon={<AutorenewIcon sx={{ fontSize: '14px !important' }} />} label={`自动续期 ${autoRenew.hours}h`} sx={{ ml: 1, height: 22 }} />
            )}
```

- [ ] **Step 3: 修改 `web/src/Dashboard.jsx`**

导入：`import AutoRenewDialog from './dialogs/AutoRenewDialog.jsx';`。

状态：`const [autoRenew, setAutoRenew] = useState({ available: true, items: {} });`

`load()` 里，`setInstances(list)` 之后加（失败不影响实例列表）：

```js
      api('GET', '/api/auto-renew')
        .then((a) => mounted.current && setAutoRenew(a.data))
        .catch(() => {
          /* 自动续期设置读取失败不影响实例列表 */
        });
```

`renderDialog` 的 `switch` 里加：

```jsx
      case 'autorenew':
        return (
          <AutoRenewDialog
            key={d.key}
            {...common}
            inst={inst}
            state={autoRenew}
            withBusy={withBusy}
            onChanged={() => {
              closeDialog(d.key);
              load();
            }}
          />
        );
```

实例卡片渲染处加 prop：`autoRenew={autoRenew.items[inst.id]}`。

- [ ] **Step 4: 打包并检查**

```bash
npm --prefix web run build     # 依赖已在 Task 0 后台安装
```
Expected: 构建成功，生成 `public/`。

用假 Alice 跑起面板并在浏览器里检查：

```bash
node -e "
const { startMockAlice, makeInstance } = require('./test/helpers/mock-alice');
(async () => {
  const m = await startMockAlice();
  const now = Date.now();
  m.instances.push(makeInstance(1001, { createdMs: Date.parse('2026-09-30T19:38:55Z'), expiresMs: Date.parse('2026-10-01T19:38:55Z') }));
  console.log('MOCK', m.base);
  setInterval(() => {}, 1e9);
})();" &
# 记下 MOCK 地址后：
PANEL_PASSWORD=correct-password ALICE_CLIENT_ID=x ALICE_SECRET=y ALICE_API_BASE=<MOCK 地址> DATA_DIR=/tmp/alice-data PORT=8080 node server.js
```

浏览器打开 `http://127.0.0.1:8080` 登录，检查：创建时间显示 `2026-10-01 03:38`、到期显示 `2026-10-02 03:38`；菜单里有"自动续期"；开启后卡片出现"自动续期 24h"标签；关闭后标签消失。

- [ ] **Step 5: 提交**

```bash
git add web/src
git commit -m "feat: 网页端增加自动续期开关与卡片标签

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Telegram bot 核心（客户端、白名单、一次性令牌、/list、电源 / 续期 / 自动续期、长轮询）

**Files:**
- Create: `telegram.js`, `bot-views.js`, `bot.js`, `test/helpers/fake-telegram.js`, `test/bot-core.test.js`

**Interfaces:**
- Consumes: `alice`（`listInstances`/`state`/`power`/`renew`/`permissions`/`profile`）、`store`（`getAutoRenew`/`setAutoRenew`/`listAutoRenew`）、`normalize`、`validate`。
- Produces（`telegram.js`）：`createTelegram({ token, apiBase, fetch = globalThis.fetch }) → { call(method, params = {}, { timeoutMs = 15000, signal } = {}) → Promise<result> }`；失败时抛 `Error`，带 `.code`（Bot API 的 `error_code`）。错误信息里不包含 token。
- Produces（`bot-views.js`）：`esc(text)`；`fmtTime(ms, tz) → 'YYYY-MM-DD HH:mm'`；`fmtRemaining(ms)`；`tail(text, max) → { text, truncated }`；`instanceCard({ inst, power, auto, tz, now }) → { text, keyboard }`；`hoursKeyboard(prefix, options, backData) → inline_keyboard`；常量 `MAX_TEXT = 4096`。
- Produces（`bot.js`）：`createBot(deps) → { start(): Promise<boolean>, stop(), handleUpdate(update): Promise<void>, notify(event): Promise<void> }`，`deps = { token, allowedIds, apiBase, alice, store, displayTimeZone, fetch, log, now, sleep, schedule }`（后四项可注入，默认 `Date.now`、`setTimeout` 版 `sleep`、`setTimeout` 版 `schedule(fn, ms)`）。
- `callback_data` 约定（≤ 64 字节）：`i:<id>` 打开 / 刷新卡片；`p:<action>:<id>` 电源（`boot` 直接执行，其余走确认）；`rn:<id>` 选续期时长，`rn:<id>:<h>` 执行续期；`ar:<id>` 自动续期菜单，`ar:<id>:0` 关闭，`ar:<id>:<h>` 开启；`c:<token>` 确认，`n:<token>` 取消。其余在 Task 8。

- [ ] **Step 1: 写测试替身 `test/helpers/fake-telegram.js`**

```js
'use strict';

// 假 Telegram Bot API：作为 fetch 注入给 bot，记录所有调用。
function createFakeTelegram() {
  const calls = [];
  const handlers = {}; // method → (params) => result
  let messageId = 100;

  async function fetch(url, init = {}) {
    const m = /\/bot[^/]+\/([A-Za-z]+)$/.exec(String(url));
    const method = m[1];
    const params = init.body ? JSON.parse(init.body) : {};
    calls.push({ method, params });
    if (method === 'getUpdates' && params.offset !== -1) {
      // 长轮询：一直挂起直到被取消（bot.stop()）
      return new Promise((resolve, reject) => {
        if (init.signal) init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    let result;
    if (handlers[method]) {
      try {
        result = await handlers[method](params);
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error_code: err.code || 400, description: err.message }), { status: 200 });
      }
    } else if (method === 'sendMessage') result = { message_id: ++messageId, chat: { id: params.chat_id } };
    else if (method === 'getMe') result = { id: 1, username: 'alice_test_bot' };
    else result = true;
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }

  return {
    fetch,
    calls,
    handlers,
    of: (method) => calls.filter((c) => c.method === method).map((c) => c.params),
    sent: () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').map((c) => c.params),
    clear: () => { calls.length = 0; },
  };
}

module.exports = { createFakeTelegram };
```

- [ ] **Step 2: 写失败的测试 `test/bot-core.test.js`**

```js
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../store');
const { createBot } = require('../bot');
const { createFakeTelegram } = require('./helpers/fake-telegram');

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

let clock;
let tg;
let alice;
let store;
let bot;
let uid;
let mid;

function makeAlice(over = {}) {
  const calls = [];
  const rec = (name, impl) => async (...args) => { calls.push([name, ...args]); return impl(...args); };
  return {
    calls,
    configured: () => true,
    listInstances: rec('listInstances', () => [INSTANCE]),
    state: rec('state', () => ({ status: 'complete', state: { state: 'running' } })),
    power: rec('power', () => null),
    renew: rec('renew', () => ({ expiration_at_utc: '2026-10-02T19:38:55.000Z' })),
    permissions: rec('permissions', () => ({ max_time: 48, allow_packages: '38' })),
    profile: rec('profile', () => ({ credit: 5000000 })),
    ...over,
  };
}

beforeEach(() => {
  clock = { now: NOW };
  tg = createFakeTelegram();
  alice = makeAlice();
  store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'alice-bot-')), now: () => clock.now, log: silent });
  uid = 0;
  mid = 0;
  bot = createBot({
    token: 'TKN', allowedIds: ['42', '43'], apiBase: 'https://tg.test', alice, store,
    displayTimeZone: 'Asia/Shanghai', fetch: tg.fetch, log: silent, now: () => clock.now,
    sleep: async () => {}, schedule: () => {},
  });
});

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

// ---------- 白名单与忽略 ----------

test('陌生用户私聊：没有任何回复，也不碰 Alice', async () => {
  await bot.handleUpdate(msg('/list', 99));
  await bot.handleUpdate(cb('p:restart:1001', 99));
  assert.deepEqual(tg.calls, []);
  assert.deepEqual(alice.calls, []);
});

test('白名单用户在群聊里发消息：忽略', async () => {
  await bot.handleUpdate(msg('/list', 42, 'supergroup'));
  await bot.handleUpdate(cb('i:1001', 42, 'group'));
  assert.deepEqual(tg.calls, []);
});

test('/start 和 /help 返回帮助', async () => {
  await bot.handleUpdate(msg('/start'));
  assert.match(tg.sent()[0].text, /\/list/);
});

// ---------- /list ----------

test('/list：每台实例一条消息，名称里的 < & 被转义，callback_data ≤ 64 字节', async () => {
  await bot.handleUpdate(msg('/list'));
  const m = tg.of('sendMessage').at(-1);
  assert.match(m.text, /vm-&lt;a&amp;b&gt;/);
  assert.doesNotMatch(m.text, /vm-<a&b>/);
  assert.match(m.text, /203\.0\.113\.7/);
  assert.match(m.text, /2026-10-02 03:38/); // 到期时间按 Asia/Shanghai 显示
  assert.equal(m.parse_mode, 'HTML');
  assert.ok(buttons(m).length >= 8);
  for (const b of buttons(m)) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
});

test('/list：超过 10 台只显示 10 台并提示', async () => {
  alice = makeAlice({ listInstances: async () => Array.from({ length: 12 }, (_, i) => ({ ...INSTANCE, id: 2000 + i })) });
  bot = createBot({ token: 'TKN', allowedIds: ['42'], apiBase: 'https://tg.test', alice, store, displayTimeZone: 'Asia/Shanghai', fetch: tg.fetch, log: silent, now: () => clock.now, sleep: async () => {}, schedule: () => {} });
  await bot.handleUpdate(msg('/list'));
  const sent = tg.of('sendMessage');
  assert.equal(sent.length, 11);
  assert.match(sent.at(-1).text, /还有 2 台/);
});

test('/list：没有实例', async () => {
  alice = makeAlice({ listInstances: async () => [] });
  bot = createBot({ token: 'TKN', allowedIds: ['42'], apiBase: 'https://tg.test', alice, store, displayTimeZone: 'Asia/Shanghai', fetch: tg.fetch, log: silent, now: () => clock.now, sleep: async () => {}, schedule: () => {} });
  await bot.handleUpdate(msg('/list'));
  assert.match(tg.sent().at(-1).text, /没有实例/);
});

test('刷新按钮 i:<id> 原地编辑消息，并应答回调', async () => {
  await bot.handleUpdate(cb('i:1001'));
  assert.equal(tg.of('editMessageText').length, 1);
  assert.equal(tg.of('answerCallbackQuery').length, 1);
});

// ---------- 电源与确认令牌 ----------

test('开机直接执行；关机 / 重启 / 强制关机要先确认', async () => {
  await bot.handleUpdate(cb('p:boot:1001'));
  assert.deepEqual(alice.calls.filter((c) => c[0] === 'power'), [['power', '1001', 'boot']]);

  for (const action of ['shutdown', 'restart', 'poweroff']) {
    await bot.handleUpdate(cb(`p:${action}:1001`));
  }
  assert.equal(alice.calls.filter((c) => c[0] === 'power').length, 1, '确认之前不执行');
});

test('确认令牌：点确认执行一次，重放无效', async () => {
  await bot.handleUpdate(cb('p:restart:1001'));
  const confirm = tokenOf(tg.sent().at(-1), 'c');
  assert.match(tg.sent().at(-1).text, /重启/);
  await bot.handleUpdate(cb(confirm));
  await bot.handleUpdate(cb(confirm));
  assert.deepEqual(alice.calls.filter((c) => c[0] === 'power'), [['power', '1001', 'restart']]);
  assert.match(tg.of('answerCallbackQuery').at(-1).text, /失效|过期/);
});

test('确认令牌绑定发起人：另一个白名单用户点不了', async () => {
  await bot.handleUpdate(cb('p:poweroff:1001', 42));
  const confirm = tokenOf(tg.sent().at(-1), 'c');
  await bot.handleUpdate(cb(confirm, 43));
  assert.equal(alice.calls.filter((c) => c[0] === 'power').length, 0);
  await bot.handleUpdate(cb(confirm, 42)); // 发起人自己仍然可以
  assert.equal(alice.calls.filter((c) => c[0] === 'power').length, 1);
});

test('确认令牌 60 秒后过期', async () => {
  await bot.handleUpdate(cb('p:restart:1001'));
  const confirm = tokenOf(tg.sent().at(-1), 'c');
  clock.now += 61e3;
  await bot.handleUpdate(cb(confirm));
  assert.equal(alice.calls.filter((c) => c[0] === 'power').length, 0);
});

test('取消按钮让令牌作废', async () => {
  await bot.handleUpdate(cb('p:restart:1001'));
  const sent = tg.sent().at(-1);
  await bot.handleUpdate(cb(tokenOf(sent, 'n')));
  await bot.handleUpdate(cb(tokenOf(sent, 'c')));
  assert.equal(alice.calls.filter((c) => c[0] === 'power').length, 0);
});

test('伪造的令牌和实例 ID：没有副作用', async () => {
  await bot.handleUpdate(cb('c:nonexistent'));
  await bot.handleUpdate(cb('p:restart:../etc'));
  await bot.handleUpdate(cb('p:format:1001'));
  assert.equal(alice.calls.filter((c) => c[0] === 'power').length, 0);
});

// ---------- 续期与自动续期 ----------

test('续期：先选时长（受 max_time 约束），点击即执行', async () => {
  await bot.handleUpdate(cb('rn:1001'));
  const hours = buttons(tg.sent().at(-1)).map((b) => b.callback_data).filter((d) => /^rn:1001:\d+$/.test(d));
  assert.ok(hours.includes('rn:1001:24'));
  assert.ok(hours.includes('rn:1001:48'));
  assert.ok(!hours.includes('rn:1001:72'), '超过账户上限的不提供');
  await bot.handleUpdate(cb('rn:1001:24'));
  assert.deepEqual(alice.calls.filter((c) => c[0] === 'renew'), [['renew', '1001', 24]]);
  assert.match(tg.sent().at(-1).text, /2026-10-02 03:38/);
});

test('续期的时长参数不合法（超过上限）：不调用 Alice', async () => {
  await bot.handleUpdate(cb('rn:1001:9999'));
  assert.equal(alice.calls.filter((c) => c[0] === 'renew').length, 0);
});

test('自动续期：开启 / 关闭写入 store', async () => {
  await bot.handleUpdate(cb('ar:1001'));
  assert.ok(findButton(tg.sent().at(-1), /^ar:1001:0$/));
  await bot.handleUpdate(cb('ar:1001:24'));
  assert.deepEqual(store.getAutoRenew('1001'), { enabled: true, hours: 24 });
  await bot.handleUpdate(cb('ar:1001:0'));
  assert.deepEqual(store.getAutoRenew('1001'), { enabled: false, hours: 24 });
});

test('自动续期：数据目录不可写时给出提示，不崩溃', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'alice-bot-')), 'f');
  fs.writeFileSync(file, 'x');
  store = createStore({ dir: path.join(file, 'sub'), log: silent });
  bot = createBot({ token: 'TKN', allowedIds: ['42'], apiBase: 'https://tg.test', alice, store, displayTimeZone: 'Asia/Shanghai', fetch: tg.fetch, log: silent, now: () => clock.now, sleep: async () => {}, schedule: () => {} });
  await bot.handleUpdate(cb('ar:1001:24'));
  assert.match(tg.sent().at(-1).text + (tg.of('answerCallbackQuery').at(-1).text || ''), /DATA_DIR|数据目录/);
});

test('/account：显示余额', async () => {
  await bot.handleUpdate(msg('/account'));
  assert.match(tg.sent().at(-1).text, /\$5\.00/);
});

// ---------- 长轮询 ----------

test('start：丢弃积压的 update、从其后开始轮询；stop 结束轮询', async () => {
  tg.handlers.getUpdates = (p) => (p.offset === -1 ? [{ update_id: 5, message: { message_id: 1, from: { id: 42 }, chat: { id: 42, type: 'private' }, text: '/destroy-everything' } }] : []);
  assert.equal(await bot.start(), true);
  await new Promise((r) => setTimeout(r, 20));
  const polls = tg.of('getUpdates');
  assert.equal(polls[0].offset, -1);
  assert.equal(polls[1].offset, 6);
  assert.equal(tg.of('sendMessage').length, 0, '积压的消息不会被处理');
  bot.stop();
});

test('start：token 无效（401）时 bot 停用并返回 false', async () => {
  tg.handlers.getMe = () => { throw Object.assign(new Error('Unauthorized'), { code: 401 }); };
  assert.equal(await bot.start(), false);
  assert.equal(tg.of('getUpdates').length, 0);
});

test('错误信息和日志不包含 token', async () => {
  const lines = [];
  const logger = { warn: (m) => lines.push(m), error: (m) => lines.push(m), log: (m) => lines.push(m) };
  alice = makeAlice({ listInstances: async () => { throw new Error('Alice 挂了'); } });
  bot = createBot({ token: 'SECRET-TKN', allowedIds: ['42'], apiBase: 'https://tg.test', alice, store, displayTimeZone: 'Asia/Shanghai', fetch: tg.fetch, log: logger, now: () => clock.now, sleep: async () => {}, schedule: () => {} });
  await bot.handleUpdate(msg('/list'));
  assert.match(tg.sent().at(-1).text, /操作失败：Alice 挂了/);
  assert.ok(lines.every((l) => !String(l).includes('SECRET-TKN')));
});
```

- [ ] **Step 3: 运行，确认失败**

Run: `node --test test/bot-core.test.js`
Expected: FAIL，`Cannot find module '../bot'`

- [ ] **Step 4: 实现 `telegram.js`**

```js
'use strict';

// Telegram Bot API 的最小客户端：POST JSON，只返回 result。错误信息里不带 token（也不带带 token 的 URL）。

function createTelegram({ token, apiBase, fetch = globalThis.fetch }) {
  async function call(method, params = {}, { timeoutMs = 15000, signal } = {}) {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (signal) signals.push(signal);
    let res;
    try {
      res = await fetch(`${apiBase}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? '请求超时' : err.name === 'AbortError' ? '已取消' : (err.cause && err.cause.code) || err.message;
      throw Object.assign(new Error(`无法连接 Telegram（${method}）：${reason}`), { code: 0, aborted: err.name === 'AbortError' });
    }
    let payload;
    try {
      payload = await res.json();
    } catch {
      throw Object.assign(new Error(`Telegram 返回了非 JSON 内容（${method}，HTTP ${res.status}）`), { code: res.status });
    }
    if (!payload.ok) {
      throw Object.assign(new Error(payload.description || `Telegram 错误（${method}）`), { code: payload.error_code || res.status });
    }
    return payload.result;
  }
  return { call };
}

module.exports = { createTelegram };
```

- [ ] **Step 5: 实现 `bot-views.js`**

要点（完整代码在实现时写出，行为由测试固定）：

```js
'use strict';

const { statusLabel, cardStatus } = require('./normalize');

const MAX_TEXT = 4096;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 'YYYY-MM-DD HH:mm'，按指定时区（IANA 名称）显示。
function fmtTime(ms, tz) {
  return new Date(ms).toLocaleString('sv-SE', { timeZone: tz, hourCycle: 'h23' }).slice(0, 16);
}

// 与网页 fmtRemaining 一致的中文剩余时间。
function fmtRemaining(ms) {
  if (ms <= 0) return '已到期';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  if (d > 0) return `剩余 ${d} 天 ${hh} 小时`;
  if (hh > 0) return `剩余 ${hh} 小时 ${mm} 分`;
  return `剩余 ${mm} 分`;
}

// 保留末尾 max 个字符，用于命令输出。
function tail(text, max) {
  const t = String(text);
  return t.length <= max ? { text: t, truncated: false } : { text: t.slice(t.length - max), truncated: true };
}

function instanceCard({ inst, power, auto, tz, now }) {
  // 返回 { text, keyboard }：文字用 HTML，动态内容全部 esc()；
  // 键盘：
  //   [开机 p:boot:ID][关机 p:shutdown:ID][重启 p:restart:ID]
  //   [强制关机 p:poweroff:ID][续期 rn:ID][自动续期 ar:ID]
  //   [重装 rb:ID][执行命令 ex:ID][删除 dx:ID]
  //   [刷新 i:ID]
}

// 时长选择键盘：每行 3 个，callback_data = `${prefix}:${h}`，最后一行是"返回"（backData）。
function hoursKeyboard(prefix, options, backData) {}

module.exports = { MAX_TEXT, esc, fmtTime, fmtRemaining, tail, instanceCard, hoursKeyboard };
```

`instanceCard` 的文字格式：

```
<b>{名称}</b>  <code>#{id}</code>
状态：{statusLabel(cardStatus(inst, power))}
套餐：{plan} · 系统：{os}            （缺的项省略）
IPv4：<code>{ipv4}</code>
IPv6：<code>{ipv6}</code>
到期：{fmtTime(expiresAt, tz)}（{fmtRemaining(expiresAt - now)}）
自动续期：开（每次 {hours} 小时）/ 关
```

- [ ] **Step 6: 实现 `bot.js`（核心部分）**

结构（`createBot(deps)`）：

- 内部：`tg = createTelegram(...)`；`allowed = new Set(allowedIds.map(String))`；`pending = new Map()`（令牌 → `{ userId, op, expires }`，`op = { kind, ...params, summary }`）；`sessions = new Map()`（Task 8 的向导与等待输入状态）。
- `authorized(update)`：`message` 取 `message.from.id` 且 `chat.type === 'private'`；`callback_query` 取 `from.id` 且 `message.chat.type === 'private'`；不满足则只记一行日志 `[bot] 忽略未授权 id=…`，不回复任何内容。
- `handleUpdate(update)`：授权后分发到 `onMessage` / `onCallback`，整体包 `try/catch`：异常时回复 `操作失败：${err.message}`（`onCallback` 里同时 `answerCallbackQuery`）。`onCallback` 的 `finally` 里总是 `answerCallbackQuery`（除非已带文字应答），避免按钮一直转圈。
- 令牌：`createToken(userId, op)` 返回 `randomBytes(6).toString('base64url')`，TTL 60 秒；`takeToken(token, userId)`：不存在 / 过期 / 用户不符 → `null`，成功则删除（一次性）。回调 `c:<t>` 取出后执行 `runOp(op)`；`n:<t>` 直接作废。失效时应答 `该操作已失效或已过期，请重新发起`。
- 路由表见"callback_data 约定"。实例 ID 一律经 `reqId`，时长经 `hours` 且必须 ≤ `maxHours(permissions)`，电源动作必须在 `POWER_ACTIONS` 里。
- `/list`：`alice.listInstances()` → `asList().map(normInstance)`，取前 10 台，并行 `alice.state(id)`（失败当作未知）→ 每台一条 `sendMessage`；多于 10 台追加一条"还有 N 台未显示，请在网页查看"。无实例回复"目前没有实例"。
- 卡片刷新 `i:<id>`：重新 `listInstances` 找到该实例，`editMessageText`；"message is not modified" 错误忽略；找不到实例时编辑为"实例已不存在"。
- `/account`：`alice.profile()` + `alice.permissions()`，显示余额（`credit / 1e6`，`$x.xx`）和单次最长时长。
- `start()`：`getMe`（失败 → 日志错误并返回 `false`；401 / 404 视为 token 无效）→ `getUpdates {offset:-1, limit:1, timeout:0}` 取最新 update 并把 `offset` 设为其 `update_id + 1`（丢弃积压）→ 后台启动 `loop()` → 返回 `true`。
- `loop()`：`getUpdates { offset, timeout: 50, allowed_updates: ['message','callback_query'] }`（超时 65 秒，带 `AbortController` 信号）；逐条 `await handleUpdate`，先更新 `offset`；出错指数退避（`sleep(backoff)`，1 秒起、最长 30 秒）；`stop()` 后退出；错误码 401 时停止轮询。
- `stop()`：置 `stopped`，`abort()` 当前长轮询。

- [ ] **Step 7: 运行，确认通过**

Run: `node --test`
Expected: PASS（全部）

- [ ] **Step 8: 提交**

```bash
git add telegram.js bot-views.js bot.js test/helpers/fake-telegram.js test/bot-core.test.js
git commit -m "feat: Telegram bot 核心（白名单、一次性确认令牌、实例卡片、电源/续期/自动续期、长轮询）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: bot 的危险操作与向导（删除、执行命令、新建、重装）

**Files:**
- Modify: `bot.js`
- Create: `test/bot-ops.test.js`

**Interfaces:**
- Consumes: Task 7 的 `createBot` 与令牌机制；`alice.destroy` / `exec` / `execResult` / `plans` / `planImages` / `sshKeys` / `deploy` / `rebuild`；`normalize.decodeOutput` / `RUNNING_RE` / `normPlans` / `planOptions` / `flattenImages` / `normSshKeys` / `maxHours` / `durationOptions`；`store.removeInstance`。
- Produces：`callback_data`：`dx:<id>` 删除（走确认）；`ex:<id>` 等待输入命令；`rb:<id>` 重装向导；`w:plan:<id>`、`w:g:<index>`、`w:os:<id>`、`w:h:<n>`、`w:key:<id|0>`、`w:skip`；`v:<token>` 查看启动脚本输出。命令：`/deploy`、`/exec <实例ID> <命令>`、`/cancel`。向导状态按用户保存在内存里，10 分钟无操作过期；向导最后一步创建确认令牌，用户点确认才真正调用 Alice。

- [ ] **Step 1: 写失败的测试 `test/bot-ops.test.js`**

测试夹具与 `test/bot-core.test.js` 相同（把 `makeAlice` 扩展为包含下列方法），完整测试：

```js
// 额外的 alice 方法
destroy: rec('destroy', () => null),
exec: rec('exec', () => ({ command_uid: 'u1' })),
execResult: rec('execResult', () => ({ status: 'complete', output: Buffer.from('hello <b>\n').toString('base64') })),
plans: rec('plans', () => [{ id: 38, name: 'Plan-A', cpu: 1, memory: 1, disk: 10, stock: 3 }, { id: 39, name: 'Plan-B', stock: 0 }]),
planImages: rec('planImages', () => [{ group_id: 1, group_name: 'Ubuntu', os_list: [{ id: 101, name: 'Ubuntu 24.04' }] }]),
sshKeys: rec('sshKeys', () => [{ id: 5, name: 'laptop' }]),
deploy: rec('deploy', () => ({ id: 2002, hostname: 'new-vm', ipv4: '198.51.100.9', password: 'p@ss<word>', boot_script_uid: 'bs-uid-1' })),
rebuild: rec('rebuild', () => ({ password: 'new-pass' })),
```

```js
test('删除：先确认；确认后调用 Alice 并清理自动续期设置', async () => {
  store.setAutoRenew('1001', { enabled: true, hours: 24 });
  await bot.handleUpdate(cb('dx:1001'));
  assert.equal(alice.calls.filter((c) => c[0] === 'destroy').length, 0);
  assert.match(tg.sent().at(-1).text, /永久/);
  await bot.handleUpdate(cb(tokenOf(tg.sent().at(-1), 'c')));
  assert.deepEqual(alice.calls.filter((c) => c[0] === 'destroy'), [['destroy', '1001']]);
  assert.equal(store.getAutoRenew('1001'), undefined);
});

test('/exec：确认消息完整显示命令（已转义），确认后执行并轮询，输出解码并转义', async () => {
  let n = 0;
  alice.execResult = async () => (++n < 2 ? { status: 'running' } : { status: 'complete', output: Buffer.from('hello <b>\n').toString('base64') });
  await bot.handleUpdate(msg('/exec 1001 echo "<hi>" && uptime'));
  assert.equal(alice.calls.filter((c) => c[0] === 'exec').length, 0);
  assert.match(tg.sent().at(-1).text, /<pre>echo "&lt;hi&gt;" &amp;&amp; uptime<\/pre>/);
  await bot.handleUpdate(cb(tokenOf(tg.sent().at(-1), 'c')));
  assert.deepEqual(alice.calls.filter((c) => c[0] === 'exec'), [['exec', '1001', 'echo "<hi>" && uptime']]);
  await new Promise((r) => setImmediate(r)); // 轮询在独立任务里进行
  await new Promise((r) => setImmediate(r));
  const out = tg.of('sendMessage').at(-1).text;
  assert.match(out, /hello &lt;b&gt;/);
  assert.doesNotMatch(out, /<b>/);
});

test('/exec 输出超过 3500 字符：只保留末尾并说明，整条消息不超过 4096', async () => {
  const big = `${'A'.repeat(5000)}END`;
  alice.execResult = async () => ({ status: 'complete', output: Buffer.from(big).toString('base64') });
  await bot.handleUpdate(msg('/exec 1001 cat big'));
  await bot.handleUpdate(cb(tokenOf(tg.sent().at(-1), 'c')));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const out = tg.of('sendMessage').at(-1).text;
  assert.ok(out.length <= 4096);
  assert.match(out, /已截断/);
  assert.match(out, /END<\/pre>/);
});

test('/exec 参数不合法：不调用 Alice', async () => {
  await bot.handleUpdate(msg('/exec'));
  await bot.handleUpdate(msg('/exec 1001'));
  await bot.handleUpdate(msg('/exec a/b ls'));
  assert.equal(alice.calls.filter((c) => c[0] === 'exec').length, 0);
  assert.equal(tg.of('sendMessage').length, 3); // 各回复一条用法说明
});

test('执行命令按钮：提示发送命令，下一条文字消息成为待确认的命令', async () => {
  await bot.handleUpdate(cb('ex:1001'));
  await bot.handleUpdate(msg('df -h'));
  assert.match(tg.sent().at(-1).text, /<pre>df -h<\/pre>/);
  assert.equal(alice.calls.filter((c) => c[0] === 'exec').length, 0);
});

test('新建向导：套餐 → 系统 → 时长 → SSH 密钥 → 启动脚本 → 确认；密码消息 10 分钟后删除', async () => {
  const scheduled = [];
  bot = createBot({ token: 'TKN', allowedIds: ['42'], apiBase: 'https://tg.test', alice, store, displayTimeZone: 'Asia/Shanghai', fetch: tg.fetch, log: silent, now: () => clock.now, sleep: async () => {}, schedule: (fn, ms) => scheduled.push([fn, ms]) });

  await bot.handleUpdate(msg('/deploy'));
  const planKb = tg.sent().at(-1);
  assert.ok(findButton(planKb, /^w:plan:38$/));
  assert.ok(!findButton(planKb, /^w:plan:39$/), '无库存的套餐不可选');

  await bot.handleUpdate(cb('w:plan:38'));
  assert.deepEqual(alice.calls.filter((c) => c[0] === 'planImages'), [['planImages', '38']]);
  await bot.handleUpdate(cb('w:os:101'));
  await bot.handleUpdate(cb('w:h:24'));
  await bot.handleUpdate(cb('w:key:0'));
  await bot.handleUpdate(msg('#!/bin/bash\necho hi')); // 启动脚本
  const summary = tg.sent().at(-1);
  assert.match(summary.text, /Plan-A/);
  assert.equal(alice.calls.filter((c) => c[0] === 'deploy').length, 0, '确认之前不创建');

  await bot.handleUpdate(cb(tokenOf(summary, 'c')));
  assert.deepEqual(alice.calls.filter((c) => c[0] === 'deploy'), [['deploy', { planId: '38', osId: '101', hours: 24, sshKeyId: null, bootScript: '#!/bin/bash\necho hi' }]]);
  const result = tg.of('sendMessage').at(-1);
  assert.match(result.text, /<code>p@ss&lt;word&gt;<\/code>/);
  assert.ok(findButton(result, /^v:/), '有启动脚本时提供查看输出的按钮');

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0][1], 10 * 60 * 1000);
  await scheduled[0][0]();
  assert.equal(tg.of('deleteMessage').length, 1);
});

test('新建向导：跳过启动脚本，选择 SSH 密钥', async () => {
  await bot.handleUpdate(msg('/deploy'));
  await bot.handleUpdate(cb('w:plan:38'));
  await bot.handleUpdate(cb('w:os:101'));
  await bot.handleUpdate(cb('w:h:12'));
  await bot.handleUpdate(cb('w:key:5'));
  await bot.handleUpdate(cb('w:skip'));
  await bot.handleUpdate(cb(tokenOf(tg.sent().at(-1), 'c')));
  assert.deepEqual(alice.calls.filter((c) => c[0] === 'deploy'), [['deploy', { planId: '38', osId: '101', hours: 12, sshKeyId: '5', bootScript: undefined }]]);
});

test('向导：/cancel 取消；10 分钟无操作后再点按钮无效', async () => {
  await bot.handleUpdate(msg('/deploy'));
  await bot.handleUpdate(msg('/cancel'));
  await bot.handleUpdate(cb('w:plan:38'));
  assert.equal(alice.calls.filter((c) => c[0] === 'planImages').length, 0);

  await bot.handleUpdate(msg('/deploy'));
  clock.now += 11 * 60e3;
  await bot.handleUpdate(cb('w:plan:38'));
  assert.equal(alice.calls.filter((c) => c[0] === 'planImages').length, 0);
});

test('向导按钮里的 ID 不合法：不调用 Alice', async () => {
  await bot.handleUpdate(msg('/deploy'));
  await bot.handleUpdate(cb('w:plan:../x'));
  assert.equal(alice.calls.filter((c) => c[0] === 'planImages').length, 0);
});

test('重装向导：使用实例自己的套餐查系统，确认后调用 rebuild', async () => {
  await bot.handleUpdate(cb('rb:1001'));
  assert.deepEqual(alice.calls.filter((c) => c[0] === 'planImages'), [['planImages', '38']]);
  await bot.handleUpdate(cb('w:os:101'));
  await bot.handleUpdate(cb('w:key:0'));
  await bot.handleUpdate(cb('w:skip'));
  const summary = tg.sent().at(-1);
  assert.match(summary.text, /重装|覆盖/);
  await bot.handleUpdate(cb(tokenOf(summary, 'c')));
  assert.deepEqual(alice.calls.filter((c) => c[0] === 'rebuild'), [['rebuild', '1001', { osId: '101', sshKeyId: null, bootScript: undefined }]]);
});

test('等待输入时来了命令：命令优先，不会把 /list 当成启动脚本', async () => {
  await bot.handleUpdate(msg('/deploy'));
  await bot.handleUpdate(cb('w:plan:38'));
  await bot.handleUpdate(cb('w:os:101'));
  await bot.handleUpdate(cb('w:h:24'));
  await bot.handleUpdate(cb('w:key:0'));
  await bot.handleUpdate(msg('/list'));
  assert.equal(alice.calls.filter((c) => c[0] === 'listInstances').length >= 1, true);
  await bot.handleUpdate(cb('w:skip')); // 向导仍然停在启动脚本这一步
  assert.match(tg.sent().at(-1).text, /确认/);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test test/bot-ops.test.js`
Expected: FAIL（`dx:` / `/exec` / `/deploy` 未实现）

- [ ] **Step 3: 在 `bot.js` 里实现**

- **删除**：`dx:<id>` → `createToken(userId, { kind: 'destroy', id })`，确认消息"将永久销毁「名称」及其全部数据，无法恢复"；`runOp` 里 `alice.destroy(id)` 成功后 `store.removeInstance(id)`、日志审计、回复"实例已删除"。
- **命令**：`parseExec(text)`：`/^\/exec(?:@\w+)?\s+(\S+)\s+([\s\S]+)$/`，ID 经 `reqId`，命令 `trim()` 后非空且 ≤ 16384 字符；不合法回复用法 `用法：/exec <实例ID> <命令>`。`ex:<id>` 设置 `sessions.set(userId, { kind: 'exec', id, expires })`，提示"请发送要在 #id 上以 root 执行的命令（/cancel 取消）"；`onMessage` 里非命令的文字且存在 `exec` 会话时消费它。确认消息 `<pre>${esc(command)}</pre>`（显示超过 3500 字符时在消息里注明"仅显示前 3500 字符"，实际执行完整命令）。
- **执行与轮询**：`runOp` 的 `exec` 分支：`alice.exec(id, command)` → `uid = typeof data === 'string' ? data : pick(data, 'command_uid', 'uid')`；没有 uid → 回复"已提交，但 Alice 没有返回 command_uid，无法查询结果"。有 uid → 启动独立任务 `watchCommand(chatId, id, uid)`（不 await，异常单独捕获并回复）：`await sleep(1500)`，然后循环：`execResult` → `out = firstValue(d,'output')`、`result = firstValue(d,'result')`、`text = out !== undefined ? decodeOutput(out) : ''`（`result` 为长字符串时也解码，规则同网页 `CommandDialogs.jsx`）、`running = RUNNING_RE.test(status) || (!status && !text)`；运行中且未满 5 分钟则 `await sleep(2000)` 继续；结束后发送 `执行结束：…` + `<pre>${esc(tail(text, 3500).text)}</pre>`，被截断时加"（输出过长，已截断，仅显示末尾 3500 字符）"；5 分钟仍未完成则提示稍后在网页查询。日志审计只记命令长度。
- **向导**：`sessions` 里保存 `{ kind: 'deploy'|'rebuild', step, data, expires: now + 10 分钟 }`；每次操作刷新 `expires`；过期 / 不存在时回调应答"向导已过期，请重新发起"。`/deploy`：`alice.plans()` + `alice.permissions()` → `planOptions(normPlans(...), perm)`，只列 `!disabled` 的，`w:plan:<id>`（经 `reqId`）。选套餐后 `alice.planImages(id)` → `flattenImages`；只有一个分组直接列系统，多个分组先列分组 `w:g:<index>`；系统按钮 `w:os:<id>`（每个分组最多 40 个，超出提示去网页）。时长按钮用 `durationOptions(maxHours(perm))`，`w:h:<n>`（必须在允许列表里）。SSH 密钥：`alice.sshKeys()`（失败当作没有）→ `w:key:<id>`，加一个 `w:key:0`"不使用（密码登录）"。启动脚本：提示"发送启动脚本文本（最多约 4096 字符），或点跳过"，`w:skip` 跳过；`onMessage` 里非命令文字在该步骤被消费（≤ 64KB，经 `optText`）。最后一步创建确认令牌，摘要列出套餐、系统、时长、密钥、是否带脚本。`/cancel` 清掉用户的会话。命令（以 `/` 开头）在任何情况下优先于"等待输入"。
- **重装**：`rb:<id>` → 找到该实例，用 `inst.planId` 查 `planImages`（取不到套餐 ID 时回复"无法确定该实例的套餐，请到网页重装"）；步骤：系统 → 密钥 → 脚本 → 确认（摘要强调"会覆盖该实例的全部数据"）；确认后 `alice.rebuild(id, { osId, sshKeyId, bootScript })`。
- **结果消息（含 root 密码）**：新建 / 重装成功后，把返回对象里的 `hostname`、`ipv4`、`ipv6`、`password`、`sshkey`、`id`、`expiration_at` 按顺序列出（值用 `<code>` 且转义），末尾提示"这条消息 10 分钟后自动删除，请尽快保存，并建议登录后修改密码或改用 SSH 密钥"；发送后 `schedule(() => tg.call('deleteMessage', { chat_id, message_id }), 10 * 60 * 1000)`（失败只记日志）。带启动脚本且返回 `boot_script_uid` 时附一个"查看启动脚本输出"按钮 `v:<token>`（令牌的 op 为 `{ kind: 'view_output', id, uid }`，一次性，点击后启动 `watchCommand`）。
- 所有 `runOp` 分支都写审计日志：`[bot] user=42 action=destroy instance=1001`。

- [ ] **Step 4: 运行，确认通过**

Run: `node --test`
Expected: PASS（全部）

- [ ] **Step 5: 提交**

```bash
git add bot.js test/bot-ops.test.js
git commit -m "feat: bot 支持删除、远程执行命令、新建与重装向导（均需二次确认）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 推送通知与启动接线

**Files:**
- Modify: `bot.js`, `server.js`
- Create: `test/bot-notify.test.js`

**Interfaces:**
- Consumes: scheduler 的 `notify(event)`（Task 4）；`config.telegram`（Task 4）。
- Produces: `bot.notify(event)` 把事件格式化后发给 `allowedIds` 里的每个用户；某个用户发送失败（例如还没对 bot 发过 `/start`）不影响其他人，只记日志。

- [ ] **Step 1: 写失败的测试 `test/bot-notify.test.js`**

夹具同 `bot-core.test.js`。

```js
test('自动续期成功：带时长和新的到期时间（按 DISPLAY_TIME_ZONE），发给所有白名单用户', async () => {
  await bot.notify({ type: 'renewed', inst: { id: '1001', name: 'vm-a' }, hours: 24, expires: '2026-10-02T19:38:55.000Z' });
  const sent = tg.of('sendMessage');
  assert.deepEqual(sent.map((m) => m.chat_id).sort(), [42, 43]);
  assert.match(sent[0].text, /1001/);
  assert.match(sent[0].text, /24 小时/);
  assert.match(sent[0].text, /2026-10-03 03:38/);
});

test('自动续期失败：错误信息被转义', async () => {
  await bot.notify({ type: 'renew_failed', inst: { id: '1001', name: 'vm-a' }, error: '余额不足 <credit>' });
  assert.match(tg.of('sendMessage')[0].text, /余额不足 &lt;credit&gt;/);
});

test('即将到期提醒：带续期按钮', async () => {
  await bot.notify({ type: 'expiring', inst: { id: '1001', name: 'vm-a', expiresAt: NOW + 20 * 60e3 } });
  const m = tg.of('sendMessage')[0];
  assert.ok(findButton(m, /^rn:1001$/));
  assert.match(m.text, /剩余 20 分/);
});

test('某个用户发送失败不影响其他用户', async () => {
  tg.handlers.sendMessage = (p) => {
    if (p.chat_id === 42) throw Object.assign(new Error('Forbidden: bot can\'t initiate conversation'), { code: 403 });
    return { message_id: 1 };
  };
  await bot.notify({ type: 'renewed', inst: { id: '1', name: 'x' }, hours: 1 });
  assert.deepEqual(tg.of('sendMessage').map((m) => m.chat_id), [42, 43]);
});
```

- [ ] **Step 2: 运行，确认失败，然后在 `bot.js` 实现 `notify`**

`notify(event)`：按 `event.type` 生成文字（`renewed`：`✅ 实例 <名称> #id 已自动续期 N 小时，新的到期时间 YYYY-MM-DD HH:mm`，`expires` 缺失时省略后半句；`renew_failed`：`❌ 实例 … 自动续期失败：<错误>，将每分钟重试直到到期`；`expiring`：`⚠️ 实例 … 将在 N 分钟后到期（YYYY-MM-DD HH:mm），未开启自动续期`，附 `[续期 rn:<id>]` 按钮），对 `allowedIds` 逐个 `sendMessage`，每个单独 `try/catch`。

Run: `node --test test/bot-notify.test.js` → PASS

- [ ] **Step 3: `server.js` 接线**

在 `scheduler` 创建之前：

```js
const { createBot } = require('./bot');
```

```js
let bot = null;
if (config.telegram.enabled) {
  bot = createBot({
    token: config.telegram.token,
    allowedIds: config.telegram.allowedIds,
    apiBase: config.telegram.apiBase,
    alice,
    store,
    displayTimeZone: config.displayTimeZone,
  });
} else if (config.telegram.error) {
  console.error(`[bot] ${config.telegram.error}`);
}
```

把调度器的 `notify` 改为 `(event) => (bot ? bot.notify(event) : Promise.resolve())`，`botEnabled: Boolean(bot)`；`scheduler.start()` 之后：

```js
if (bot) {
  bot.start().then((ok) => {
    if (!ok) console.error('[bot] 启动失败，bot 已停用（面板其余功能正常）');
  });
}
```

信号处理里在 `process.exit(0)` 之前调用 `bot && bot.stop()`。

- [ ] **Step 4: 集成验证（假 Telegram 不易起，用单元测试 + 手动）**

Run: `node --test`
Expected: PASS（全部）

手动：不设 `TELEGRAM_BOT_TOKEN` 启动 → 没有 `[bot]` 日志；设 token 不设 IDs → `[bot] 设置了 TELEGRAM_BOT_TOKEN，但…`；设置无效 token 和 ID → `[bot] 启动失败，bot 已停用`，面板仍能登录。

- [ ] **Step 5: 提交**

```bash
git add bot.js server.js test/bot-notify.test.js
git commit -m "feat: bot 推送自动续期结果与到期提醒，并在服务端启动

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 部署配置、文档与最终验证

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `.env.example`, `README.md`, `package.json`（版本号可选）

- [ ] **Step 1: `Dockerfile`**

把后端 `COPY` 改为包含全部模块，并创建可写数据目录：

```dockerfile
COPY package.json server.js alice.js alice-time.js validate.js normalize.js store.js config.js scheduler.js telegram.js bot-views.js bot.js ./
COPY --from=web /app/public ./public

# 自动续期设置保存在 /data（docker-compose 里挂载为命名卷）；目录必须在切换到 node 用户之前创建并授权。
RUN mkdir -p /data && chown node:node /data
ENV DATA_DIR=/data

USER node
```

- [ ] **Step 2: `docker-compose.yml`**

```yaml
    volumes:
      # 自动续期设置（state.json）。容器其余部分仍然只读。
      - alice-data:/data
```

文件末尾加：

```yaml
volumes:
  alice-data:
```

- [ ] **Step 3: `.env.example`** 在"以下为可选项"后追加（每项一行注释说明）：`ALICE_CLOCK_OFFSET`、`AUTO_RENEW_BEFORE_MINUTES`、`EXPIRY_WARN_MINUTES`、`DISPLAY_TIME_ZONE`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_ALLOWED_USER_IDS`、`TELEGRAM_API_BASE`（均注释掉，给出默认值）。

- [ ] **Step 4: `README.md`**

- 功能列表：加"自动续期（默认关闭）"、"Telegram bot 控制"。
- 配置项表格：加入 spec §3.1 的全部变量。
- 新增"自动续期"一节：怎么开启、触发时机（到期前 `AUTO_RENEW_BEFORE_MINUTES` 分钟，默认 10）、失败行为（每分钟重试直到到期，只通知一次）、需要数据卷、宿主机时钟需与 NTP 同步、每次续期会扣费。
- 新增"Telegram bot"一节：向 @BotFather 创建 bot 取 token；用 @userinfobot 之类查自己的数字 ID；`.env` 填 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_ALLOWED_USER_IDS`；先对 bot 发 `/start`；命令与按钮一览；安全说明（白名单、仅私聊、二次确认、root 密码 10 分钟后删除、重启会丢失待确认操作与未删除的密码消息）；`exec` 等于 root shell 的风险提示。
- "升级"：旧部署执行 `docker compose up -d --build`，会自动创建 `alice-data` 数据卷；没有它时自动续期设置不可用但其余功能正常。
- 时间说明：把原来"不带时区的时间…按 UTC 处理"那条改写为：后端规范化 `creation_at` / `expiration_at`；`creation_at` 的偏移标签实测有误（钟面是 UTC+8，标签写成 +01:00），所以忽略标签、按 `ALICE_CLOCK_OFFSET` 解释；`expiration_at` 按标签；不带标签的时间按 UTC 处理（未验证）；原始字段仍可在"详细信息 → 实例数据"里看到。
- 文件结构：补充新增的后端模块，并注明 `normalize.js` 与 `web/src/utils.js` 是两份实现，改行为时要同步。
- 测试：`npm test` 现在覆盖时间规范化、存储、调度器、bot、集成。

- [ ] **Step 5: 全量测试与前端打包**

```bash
npm test
npm --prefix web run build
```
Expected: 全部通过，打包成功。

- [ ] **Step 6: Docker 构建与端到端验证（使用用户已启动的 Docker）**

```bash
docker compose build
```

用假 Alice 验证镜像：

```bash
# 1. 在宿主机上起假 Alice（监听 0.0.0.0，容器通过 host.docker.internal 访问）
node -e "…启动 mock-alice，监听固定端口 18080，放一个 5 分钟后到期的实例…" &

# 2. 起容器：只读文件系统 + 命名卷 + 假 Alice
docker run -d --name alice-verify --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  -v alice-verify-data:/data -p 127.0.0.1:18081:8080 \
  -e PANEL_PASSWORD=correct-password -e ALICE_CLIENT_ID=x -e ALICE_SECRET=y \
  -e ALICE_API_BASE=http://host.docker.internal:18080 -e AUTO_RENEW_INTERVAL_SECONDS=2 \
  alice-vps-panel:latest
```

检查：`/healthz` 正常；登录后 `GET /api/instances` 里 `creation_at_utc` 正确；开启自动续期 → `/data/state.json` 在卷里生成；假 Alice 收到续期调用；`docker restart alice-verify` 后设置仍在；容器日志里没有写入只读文件系统的报错。验证完 `docker rm -f alice-verify && docker volume rm alice-verify-data`。

- [ ] **Step 7: 提交**

```bash
git add Dockerfile docker-compose.yml .env.example README.md
git commit -m "docs: 部署配置（数据卷）、环境变量与 README 更新

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec 覆盖**
- §1 时间：Task 1（`parseAliceTime`、`withUtcTimes`、`alice.js` 接入、前端读取、两条真实样本和 24 小时回归断言、`ALICE_CLOCK_OFFSET`）。
- §2.1 存储：Task 3；§2.2 调度器：Task 4；§2.3 接口与前端：Task 5、6。
- §3.1 配置：Task 4（`config.js`）、Task 10（文档）；§3.2 交互：Task 7、8；§3.3 推送：Task 9；§3.4 数据整理与 `validate.js`：Task 2。
- §4 安全措施：白名单与仅私聊（Task 7）、一次性确认令牌（Task 7、8）、启动丢弃积压（Task 7）、密码消息删除（Task 8）、审计日志（Task 7、8）、失败默认关闭（Task 4 `config.js`、Task 7 `start()`）、错误隔离与退避（Task 7）。
- §5 部署：Task 10；§6 测试：各任务内；§7 备选方案：无需实现。

**占位符检查**：Task 7 的 `bot-views.js` / `bot.js` 与 Task 8 的 `bot.js` 给出了精确的行为、签名、`callback_data` 约定和完整的测试代码，实现代码在执行时按这些测试逐步写出（行为由测试固定）；其余任务的实现代码已在计划里给全。

**类型一致性**：`normInstance` 的 `expiresAt`（毫秒数）在调度器、bot 卡片里一致使用；`store` 的方法名（`getAutoRenew` / `setAutoRenew` / `getCycle` / `updateCycle` / `touch` / `removeInstance` / `listAutoRenew`）在 Task 3、4、5、7、8 里一致；通知事件 `{ type: 'renewed'|'renew_failed'|'expiring', inst, ... }` 在 Task 4 与 Task 9 里一致（`expiring` 的 `inst` 带 `expiresAt`）；`createBot` 的依赖名（`allowedIds`、`displayTimeZone`、`schedule`、`sleep`）在 Task 7、8、9 的测试里一致。
