'use strict';

// Telegram bot：用 getUpdates 长轮询对接 Bot API，提供与网页等价的实例控制能力。
// 安全要点（设计文档 §4）：只认白名单里的数字用户 ID 且只响应私聊，其余一律静默忽略；
// 危险操作走服务端内存里的一次性确认令牌（绑定发起人、60 秒过期）；启动时丢弃积压的 update。

const crypto = require('node:crypto');
const { createTelegram } = require('./telegram');
const N = require('./normalize');
const V = require('./bot-views');
const { parseAliceTime } = require('./alice-time');
const { MAX_ATTEMPTS } = require('./scheduler');
const { HttpError, POWER_ACTIONS, hours, optText, reqId } = require('./validate');

const { esc } = V;

const TOKEN_TTL_MS = 60e3;
const VIEW_TOKEN_TTL_MS = 10 * 60e3; // 「查看启动脚本输出」按钮：脚本可能要跑一阵，给得比确认令牌久
const SESSION_TTL_MS = 10 * 60e3; // 向导 / 等待输入命令：10 分钟无操作过期
const RESULT_DELETE_MS = 10 * 60e3; // 含 root 密码的消息：10 分钟后删除
const WATCH_MAX_MS = 5 * 60e3;
const SHOW_LIMIT = 3500; // 命令 / 输出在消息里最多显示的字符数
const CMD_PART_MAX = 3000; // 长命令分段发送时每段（转义后）的最大长度，留出头部与 <pre> 的余量
const EXEC_MAX = 16384;
const SCRIPT_MAX = 64 * 1024;
const OS_LIMIT = 40;
const LIST_LIMIT = 10;
const POWER_TEXT = { boot: '开机', shutdown: '关机', restart: '重启', poweroff: '强制关机' };

const HELP = [
  '<b>Alice 面板 bot</b>',
  '/list — 查看实例并操作（开关机、重启、自动续期……）',
  '/account — 账户余额与权限',
  '/deploy — 新建实例（向导）',
  '/exec &lt;实例ID&gt; &lt;命令&gt; — 以 root 在实例上执行命令',
  '/cancel — 取消正在进行的向导或等待输入',
  '/help — 显示这份帮助',
].join('\n');

function createBot({
  token,
  allowedIds,
  apiBase = 'https://api.telegram.org',
  alice,
  store,
  displayTimeZone = 'Asia/Shanghai',
  renewBeforeMinutes = 60,
  renewRetryMinutes = 10,
  renewMaxAttempts = MAX_ATTEMPTS,
  fetch = globalThis.fetch,
  log = console,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  schedule = (fn, ms) => setTimeout(fn, ms).unref(),
}) {
  const tg = createTelegram({ token, apiBase, fetch });
  const allowed = new Set(allowedIds.map(String));
  const pending = new Map(); // 确认令牌 → { userId, op, expires }
  const sessions = new Map(); // 用户 ID → { kind, step, data, expires }：向导 / 等待输入命令
  const MAX_PENDING = 200;
  let activeWatches = 0;
  const MAX_WATCHES = 3;
  const tz = displayTimeZone;
  let offset = 0;
  let stopped = false;
  let pollAbort = null;

  // ---------- Telegram 调用 ----------

  const send = (chatId, text, extra = {}) =>
    tg.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

  async function edit(chatId, messageId, text, extra = {}) {
    try {
      await tg.call('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
    } catch (err) {
      if (!/not modified/i.test(err.message)) throw err;
    }
  }

  async function clearKeyboard(chatId, messageId) {
    if (!messageId) return;
    try {
      await tg.call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    } catch {
      /* 消息可能已被删除或没有按钮 */
    }
  }

  const audit = (userId, action, instance) =>
    log.log(`[bot] user=${userId} action=${action}${instance ? ` instance=${instance}` : ''}`);

  // ---------- 会话（向导 / 等待输入）----------

  function getSession(userId) {
    const s = sessions.get(userId);
    if (!s) return null;
    if (s.expires < now()) {
      sessions.delete(userId);
      return null;
    }
    return s;
  }

  function startSession(userId, kind, step, data) {
    const s = { userId, kind, step, data, expires: now() + SESSION_TTL_MS };
    sessions.set(userId, s);
    return s;
  }

  const refresh = (s) => {
    s.expires = now() + SESSION_TTL_MS;
  };

  // ---------- 一次性确认令牌 ----------

  function createToken(userId, op, ttl = TOKEN_TTL_MS) {
    const t = now();
    for (const [k, v] of pending) if (v.expires < t) pending.delete(k);
    // 防内存 DoS：条目过多时淘汰最早的。
    while (pending.size >= MAX_PENDING) {
      const oldest = pending.keys().next().value;
      pending.delete(oldest);
    }
    const id = crypto.randomBytes(16).toString('base64url');
    pending.set(id, { userId, op, expires: t + ttl });
    return id;
  }

  // 不存在、已过期、不是发起人 → null；成功则立即作废（一次性）。
  function takeToken(id, userId) {
    const entry = pending.get(id);
    if (!entry) return null;
    if (entry.expires < now()) {
      pending.delete(id);
      return null;
    }
    if (entry.userId !== userId) return null;
    pending.delete(id);
    return entry;
  }

  async function askConfirm(chatId, userId, op, text) {
    const t = createToken(userId, op);
    await send(chatId, text, {
      reply_markup: { inline_keyboard: V.rows([V.btn(op.confirmText || '确认', `c:${t}`), V.btn('取消', `n:${t}`)]) },
    });
  }

  // ---------- 数据 ----------

  const loadInstances = async () => N.asList(await alice.listInstances()).map(N.normInstance).filter((i) => i.id);
  const powerOf = (id) => alice.state(id).then(N.powerState, () => undefined);

  async function labelOf(id) {
    try {
      const inst = (await loadInstances()).find((i) => i.id === id);
      return inst && inst.name ? `${inst.name} #${id}` : `#${id}`;
    } catch {
      return `#${id}`;
    }
  }

  async function maxAllowedHours() {
    try {
      return N.maxHours(await alice.permissions());
    } catch {
      return null;
    }
  }

  const cardOf = (inst, power) => V.instanceCard({ inst, power, auto: store.getEffectiveAutoRenew(inst.id), tz, now: now() });

  // ---------- 命令 ----------

  async function cmdList(chatId) {
    const list = await loadInstances();
    if (!list.length) {
      await send(chatId, '目前没有实例。');
      return;
    }
    const shown = list.slice(0, LIST_LIMIT);
    const powers = await Promise.all(shown.map((i) => powerOf(i.id)));
    for (let i = 0; i < shown.length; i++) {
      const card = cardOf(shown[i], powers[i]);
      await send(chatId, card.text, { reply_markup: { inline_keyboard: card.keyboard } });
    }
    if (list.length > LIST_LIMIT) await send(chatId, `还有 ${list.length - LIST_LIMIT} 台未显示，请在网页查看。`);
  }

  async function refreshCard(chatId, messageId, id) {
    const inst = (await loadInstances()).find((i) => i.id === id);
    if (!inst) {
      await edit(chatId, messageId, '实例已不存在。');
      return;
    }
    const card = cardOf(inst, await powerOf(id));
    await edit(chatId, messageId, card.text, { reply_markup: { inline_keyboard: card.keyboard } });
  }

  async function cmdAccount(chatId) {
    const [profile, perm] = await Promise.allSettled([alice.profile(), alice.permissions()]);
    const lines = ['<b>账户</b>'];
    if (profile.status === 'fulfilled') {
      const who = N.pick(profile.value, 'email', 'username', 'name');
      const credit = Number(N.pick(profile.value, 'credit', 'balance'));
      if (who) lines.push(`账户：${esc(who)}`);
      if (Number.isFinite(credit)) lines.push(`余额：$${(credit / 1e6).toFixed(2)}`);
    } else {
      lines.push(`账户信息读取失败：${esc(profile.reason.message)}`);
    }
    if (perm.status === 'fulfilled') {
      const max = N.maxHours(perm.value);
      if (max) lines.push(`单次最长时长：${max} 小时`);
    }
    await send(chatId, lines.join('\n'));
  }

  // ---------- 操作 ----------

  async function showAutoMenu(chatId, id) {
    const cur = store.getEffectiveAutoRenew(id);
    // 自动续期时长固定 7 小时，只保留开关。
    const keyboard = V.rows([V.btn('开启自动续期（7 小时）', `ar:${id}:7`)], [V.btn('关闭自动续期', `ar:${id}:0`)], [V.btn('返回', `i:${id}`)]);
    // 存在时间上限的提示：剩余可续约不多时告诉用户，避免自动续期失败才发现。
    let lifetimeNote = '';
    const inst = (await loadInstances()).find((i) => i.id === id);
    if (inst) {
      const { max: capMax, capped } = N.maxRenewHours(inst, await maxAllowedHours());
      if (capped && capMax !== null && capMax <= 24) {
        lifetimeNote = `\n该实例自创建起最长存在 ${N.MAX_LIFETIME_HOURS} 小时，按当前到期时间剩余可续约约 ${Math.max(0, capMax)} 小时。`;
      }
    }
    await send(
      chatId,
      `<b>自动续期</b>（实例 #${esc(id)}）\n当前：${cur && cur.enabled ? `开，每次 ${cur.hours} 小时` : '关'}\n`
        + `开启后会在到期前约 ${V.minutesText(renewBeforeMinutes)}开始自动续期，每次 7 小时；失败时每隔 ${renewRetryMinutes} 分钟重试，最多尝试 ${renewMaxAttempts} 次。${lifetimeNote}`,
      { reply_markup: { inline_keyboard: keyboard } },
    );
  }

  async function doAutoRenew(chatId, userId, id, value) {
    const prev = store.getAutoRenew(id);
    if (value === '0') {
      store.setAutoRenew(id, { enabled: false, hours: prev ? prev.hours : 7 });
      audit(userId, 'auto-renew-off', id);
      await send(chatId, `已关闭实例 #${esc(id)} 的自动续期。`);
      return;
    }
    const h = hours(value);
    const max = await maxAllowedHours();
    if (max && h > max) throw new HttpError(400, `超过账户单次最长时长 ${max} 小时`);
    store.setAutoRenew(id, { enabled: true, hours: h });
    audit(userId, 'auto-renew-on', id);
    await send(chatId, `✅ 已开启实例 #${esc(id)} 的自动续期：到期前约 ${V.minutesText(renewBeforeMinutes)}起自动续 ${h} 小时（失败最多试 ${renewMaxAttempts} 次）。`);
  }

  // ---------- 远程执行命令 ----------

  const execUsage = (chatId) => send(chatId, '用法：/exec &lt;实例ID&gt; &lt;命令&gt;');

  // 把长文本按「转义后长度」切段：Telegram 单条消息上限 4096，按转义后算才不会超。
  function splitEscaped(text, max) {
    const parts = [];
    let current = '';
    let used = 0;
    for (const ch of text) {
      const cost = esc(ch).length;
      if (used + cost > max) {
        parts.push(current);
        current = '';
        used = 0;
      }
      current += ch;
      used += cost;
    }
    if (current) parts.push(current);
    return parts;
  }

  // 转发来的消息不是本人打的字：危险操作都要二次确认，但确认框得让人知道内容是从别处转来的，
  // 否则「帮别人点一下确认」就成了绕过确认的通道。只提示、不阻断（有人习惯转发自己收藏的命令）。
  function forwardNote(m) {
    const o = m.forward_origin;
    const forwarded = Boolean(o || m.forward_from || m.forward_from_chat || m.forward_sender_name || m.forward_date);
    if (!forwarded) return '';
    const from = (o ? o.sender_user || o.sender_chat || o.chat : m.forward_from || m.forward_from_chat) || {};
    const name = N.pick(from, 'first_name', 'title', 'username') || (o && o.sender_user_name) || m.forward_sender_name;
    return `⚠️ 这条消息是<b>转发</b>来的${name ? `（来源：${esc(name)}）` : ''}：请确认内容确实是你自己想在实例上执行的。`;
  }

  // 命令要在确认消息里**完整**显示：看不全就等于闭着眼睛点「执行」（执行的是 root 命令）。
  // 太长时分段把全文发完，再发确认按钮——不做「只显示开头结尾」的截断。
  async function askExec(chatId, userId, id, rawCommand) {
    const command = String(rawCommand).trim();
    if (!command || command.length > EXEC_MAX) {
      await send(chatId, `命令不能为空，且最长 ${EXEC_MAX} 个字符。`);
      return;
    }
    const label = await labelOf(id);
    const digest = crypto.createHash('sha256').update(command, 'utf8').digest('hex').slice(0, 16);
    const escaped = esc(command);
    if (escaped.length <= SHOW_LIMIT) {
      await askConfirm(
        chatId,
        userId,
        { kind: 'exec', id, command, confirmText: '执行' },
        `将以 root 在「${esc(label)}」上执行：\n<pre>${escaped}</pre>`,
      );
      return;
    }
    const parts = splitEscaped(command, CMD_PART_MAX);
    await send(chatId, `命令较长（${command.length} 个字符，sha256:${digest}），完整命令分 ${parts.length} 条发送，请逐段核对：`);
    for (let i = 0; i < parts.length; i += 1) {
      await send(chatId, `<b>第 ${i + 1}/${parts.length} 段</b>\n<pre>${esc(parts[i])}</pre>`);
    }
    await askConfirm(
      chatId,
      userId,
      { kind: 'exec', id, command, confirmText: '执行' },
      `以上 ${parts.length} 段就是要在「${esc(label)}」上执行的完整命令（sha256:${digest}）。确认执行？`,
    );
  }

  // 在独立任务里轮询命令结果（与网页 web/components/dialogs/command-dialogs.tsx 同一套规则）。
  // 这个函数**绝不向外抛**：调用方是 fire-and-forget，抛出去就是未处理的 Promise 拒绝，
  // Node 默认会让整个面板进程退出（面板、会话、自动续期调度器一起没）。
  async function watchCommand(chatId, id, uid) {
    if (activeWatches >= MAX_WATCHES) {
      try {
        await send(chatId, '同时查询的命令太多，请稍后再试（最多同时查 3 个）。');
      } catch (err) {
        log.warn(`[bot] 提示发送失败：${err.message}`);
      }
      return;
    }
    activeWatches += 1;
    try {
      const started = now();
      let waited = 1500;
      await sleep(1500);
      for (;;) {
        const d = await alice.execResult(id, uid);
        const out = N.firstValue(d, 'output');
        const result = N.firstValue(d, 'result');
        const status = String(N.firstValue(d, 'status') ?? '');
        let text = out !== undefined ? N.decodeOutput(out) : '';
        if (!text && typeof result === 'string' && result.length > 60) text = N.decodeOutput(result);
        const running = N.RUNNING_RE.test(status) || (!status && !text);
        if (!running) {
          const shown = V.clipEscaped(text || '（无输出）', SHOW_LIMIT, 'tail');
          const note = shown.truncated ? `（输出过长，已截断，仅显示末尾 ${SHOW_LIMIT} 个字符）` : '';
          await send(chatId, `执行结束：实例 #${esc(id)}${status ? `（${esc(status)}）` : ''}${note}\n<pre>${esc(shown.text)}</pre>`);
          return;
        }
        if (Math.max(now() - started, waited) >= WATCH_MAX_MS) {
          await send(chatId, `命令在 5 分钟内仍未完成（${esc(status || '无状态')}），请稍后到网页查询结果（实例 #${esc(id)}）。`);
          return;
        }
        await sleep(2000);
        waited += 2000;
      }
    } catch (err) {
      log.warn(`[bot] 读取命令结果失败：${err.message}`);
      try {
        await send(chatId, `读取命令结果失败：${esc(err.message)}`);
      } catch {
        /* 发不出去只能忽略 */
      }
    } finally {
      activeWatches = Math.max(0, activeWatches - 1);
    }
  }

  // ---------- 向导（新建 / 重装）----------

  async function cmdDeploy(chatId, userId) {
    const [plans, perm] = await Promise.all([alice.plans(), alice.permissions().catch(() => null)]);
    const normalized = N.normPlans(plans);
    const options = N.planOptions(normalized, perm).filter((o) => !o.disabled);
    if (!options.length) {
      await send(chatId, '目前没有可新建的套餐（可能没有库存，或账户没有权限）。');
      return;
    }
    const names = Object.fromEntries(normalized.map((p) => [p.id, p.name]));
    startSession(userId, 'deploy', 'plan', { planIds: options.map((o) => o.id), names });
    await send(chatId, '<b>新建实例</b>\n选择套餐（/cancel 取消）：', {
      reply_markup: { inline_keyboard: V.rows(...options.map((o) => [V.btn(o.label, `w:plan:${o.id}`)])) },
    });
  }

  async function startRebuild(chatId, userId, id) {
    const inst = (await loadInstances()).find((i) => i.id === id);
    if (!inst) {
      await send(chatId, '实例已不存在。');
      return;
    }
    if (!inst.planId) {
      await send(chatId, '无法确定该实例的套餐，请到网页重装。');
      return;
    }
    const label = inst.name ? `${inst.name} #${id}` : `#${id}`;
    const s = startSession(userId, 'rebuild', 'os', { id, label });
    await showImages(chatId, s, inst.planId, `<b>重装「${esc(label)}」</b>\n重装会覆盖该实例的全部数据。`);
  }

  // 套餐的系统镜像：只有一个分组时直接列系统，多个分组先选分组。
  async function showImages(chatId, s, planId, header) {
    const images = N.flattenImages(await alice.planImages(planId));
    if (!images.length) {
      sessions.delete(s.userId);
      await send(chatId, '该套餐没有可用的系统镜像。');
      return;
    }
    s.data.images = images;
    s.data.groups = [...new Set(images.map((i) => i.group))];
    s.data.header = header;
    if (s.data.groups.length > 1) {
      s.step = 'group';
      await send(chatId, `${header}\n选择系统分组（/cancel 取消）：`, {
        reply_markup: { inline_keyboard: V.rows(...s.data.groups.map((g, i) => [V.btn(g || '其他', `w:g:${i}`)])) },
      });
    } else {
      await showOsList(chatId, s, s.data.groups[0]);
    }
  }

  async function showOsList(chatId, s, group) {
    const list = s.data.images.filter((i) => i.group === group);
    s.step = 'os';
    s.data.osIds = list.slice(0, OS_LIMIT).map((i) => i.id);
    const more = list.length > OS_LIMIT ? `\n（只列出前 ${OS_LIMIT} 个，更多系统请到网页选择）` : '';
    await send(chatId, `${s.data.header}\n选择系统（/cancel 取消）：${more}`, {
      reply_markup: { inline_keyboard: V.rows(...list.slice(0, OS_LIMIT).map((i) => [V.btn(i.name, `w:os:${i.id}`)])) },
    });
  }

  async function showHours(chatId, s) {
    const options = N.durationOptions(await maxAllowedHours());
    s.step = 'hours';
    s.data.hourOptions = options;
    await send(chatId, '选择时长：', { reply_markup: { inline_keyboard: V.hoursKeyboard('w:h', options, null) } });
  }

  async function showKeys(chatId, s) {
    let keys = [];
    try {
      keys = N.normSshKeys(await alice.sshKeys());
    } catch {
      /* 读不到密钥列表就当作没有，仍可用密码登录 */
    }
    s.step = 'key';
    s.data.keys = keys;
    await send(chatId, '选择 SSH 密钥：', {
      reply_markup: { inline_keyboard: V.rows(...keys.map((k) => [V.btn(k.name, `w:key:${k.id}`)]), [V.btn('不使用（密码登录）', 'w:key:0')]) },
    });
  }

  async function showScriptPrompt(chatId, s) {
    s.step = 'script';
    await send(chatId, '发送启动脚本文本（最多约 4096 字符），或点「跳过」。（/cancel 取消）', {
      reply_markup: { inline_keyboard: V.rows([V.btn('跳过', 'w:skip')]) },
    });
  }

  // 最后一步：把选择固化进一次性确认令牌，用户点确认才真正调用 Alice。
  async function finishWizard(chatId, userId, s, bootScript) {
    const d = s.data;
    sessions.delete(userId);
    const osName = d.images.find((i) => i.id === d.osId).name;
    const key = d.sshKeyId ? d.keys.find((k) => k.id === d.sshKeyId).name : '不使用（密码登录）';
    const script = bootScript ? `有（${bootScript.length} 字符）` : '无';
    if (s.kind === 'deploy') {
      await askConfirm(
        chatId,
        userId,
        { kind: 'deploy', planId: d.planId, osId: d.osId, hours: d.hours, sshKeyId: d.sshKeyId, bootScript, confirmText: '确认创建' },
        `<b>请确认新建实例</b>\n套餐：${esc(d.names[d.planId] || d.planId)}\n系统：${esc(osName)}\n时长：${esc(N.durationLabel(d.hours))}\nSSH 密钥：${esc(key)}\n启动脚本：${script}`,
      );
    } else {
      await askConfirm(
        chatId,
        userId,
        { kind: 'rebuild', id: d.id, osId: d.osId, sshKeyId: d.sshKeyId, bootScript, confirmText: '确认重装' },
        `<b>请确认重装「${esc(d.label)}」</b>\n⚠️ 重装会覆盖该实例的全部数据，无法恢复。\n系统：${esc(osName)}\nSSH 密钥：${esc(key)}\n启动脚本：${script}`,
      );
    }
  }

  async function onWizard(chatId, userId, answer, a, b) {
    const s = getSession(userId);
    if (!s || (s.kind !== 'deploy' && s.kind !== 'rebuild')) {
      await answer('向导已过期，请重新发起');
      return;
    }
    const stale = () => answer('这一步已失效，请按最新的消息操作');
    refresh(s);
    switch (a) {
      case 'plan': {
        const id = reqId(b, '套餐');
        if (s.kind !== 'deploy' || s.step !== 'plan' || !s.data.planIds.includes(id)) return stale();
        s.data.planId = id;
        return showImages(chatId, s, id, `<b>新建实例</b>：${esc(s.data.names[id] || id)}`);
      }
      case 'g': {
        const group = s.data.groups && s.data.groups[Number(b)];
        if (s.step !== 'group' || group === undefined) return stale();
        return showOsList(chatId, s, group);
      }
      case 'os': {
        const id = reqId(b, '系统');
        if (s.step !== 'os' || !s.data.osIds.includes(id)) return stale();
        s.data.osId = id;
        return s.kind === 'deploy' ? showHours(chatId, s) : showKeys(chatId, s);
      }
      case 'h': {
        const n = hours(b);
        if (s.step !== 'hours' || !s.data.hourOptions.includes(n)) return stale();
        s.data.hours = n;
        return showKeys(chatId, s);
      }
      case 'key': {
        if (s.step !== 'key') return stale();
        if (b === '0') {
          s.data.sshKeyId = null;
        } else {
          const id = reqId(b, '密钥');
          if (!s.data.keys.some((k) => k.id === id)) return stale();
          s.data.sshKeyId = id;
        }
        return showScriptPrompt(chatId, s);
      }
      case 'skip':
        if (s.step !== 'script') return stale();
        return finishWizard(chatId, userId, s, undefined);
      default:
        return undefined;
    }
  }

  // ---------- 新建 / 重装结果（含 root 密码）----------

  const RESULT_FIELDS = [
    ['主机名', 'hostname'],
    ['IPv4', 'ipv4'],
    ['IPv6', 'ipv6'],
    ['root 密码', 'password'],
    ['SSH 密钥', 'sshkey'],
    ['实例 ID', 'id'],
  ];

  async function sendProvisionResult(chatId, userId, res, { title, id, hasScript }) {
    const lines = [`✅ ${title}`];
    for (const [label, key] of RESULT_FIELDS) {
      const v = N.pick(res, key);
      if (v !== undefined && v !== '') {
        const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
        // 防超长字段导致 sendMessage 400：单字段截断，整体仍受 Telegram 4096 限制。
        const shown = text.length > 500 ? `${text.slice(0, 500)}…` : text;
        lines.push(`${label}：<code>${esc(shown)}</code>`);
      }
    }
    const exp = N.pick(res, 'expiration_at');
    if (exp !== undefined) {
      const utc = parseAliceTime(exp);
      lines.push(`到期时间：<code>${esc(utc ? V.fmtTime(Date.parse(utc), tz) : exp)}</code>`);
    }
    lines.push('', '这条消息 10 分钟后自动删除，请尽快保存，并建议登录后修改密码或改用 SSH 密钥。');

    const uid = N.pick(res, 'boot_script_uid');
    const instId = id || (N.pick(res, 'id') !== undefined ? String(N.pick(res, 'id')) : '');
    const extra = { protect_content: true };
    if (hasScript && uid !== undefined && instId) {
      const t = createToken(userId, { kind: 'view_output', id: instId, uid: String(uid) }, VIEW_TOKEN_TTL_MS);
      extra.reply_markup = { inline_keyboard: V.rows([V.btn('查看启动脚本输出', `v:${t}`)]) };
    }
    const sent = await send(chatId, lines.join('\n'), extra);
    schedule(async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await tg.call('deleteMessage', { chat_id: chatId, message_id: sent.message_id });
          return;
        } catch (err) {
          if (i === 2) log.warn(`[bot] 删除含密码的消息失败：${err.message}`);
          else await sleep(5000);
        }
      }
    }, RESULT_DELETE_MS);
  }

  // 确认后执行的操作。
  async function runOp(op, who) {
    const chatId = who.chat.id;
    switch (op.kind) {
      case 'power':
        await alice.power(op.id, op.action);
        audit(who.userId, `power-${op.action}`, op.id);
        await send(chatId, `✅ 已发送${POWER_TEXT[op.action]}指令（实例 #${esc(op.id)}），状态稍后可点「刷新」查看。`);
        break;
      case 'auto-renew':
        await doAutoRenew(chatId, who.userId, op.id, op.value);
        break;
      case 'destroy':
        await alice.destroy(op.id);
        audit(who.userId, 'destroy', op.id);
        try {
          store.removeInstance(op.id);
        } catch (err) {
          log.warn(`[bot] 清理自动续期设置失败：${err.message}`);
        }
        await send(chatId, `✅ 实例 #${esc(op.id)} 已删除。`);
        break;
      case 'exec': {
        const data = await alice.exec(op.id, op.command);
        audit(who.userId, `exec(len=${op.command.length})`, op.id);
        const uid = typeof data === 'string' ? data : N.pick(data, 'command_uid', 'uid');
        if (!uid) {
          await send(chatId, '已提交，但 Alice 没有返回 command_uid，无法查询结果。');
          break;
        }
        await send(chatId, `⏳ 命令已提交（实例 #${esc(op.id)}），执行完会把输出发给你。`);
        // 不 await：独立任务。但仍要挂 .catch——watchCommand 里任何漏网的拒绝都会变成
        // 未处理的 Promise 拒绝，Node 默认直接结束进程（面板和自动续期调度器一起陪葬）。
        watchCommand(chatId, op.id, String(uid)).catch((err) => log.error(`[bot] 查询命令结果异常：${err.message}`));
        break;
      }
      case 'deploy': {
        const res = await alice.deploy({ planId: op.planId, osId: op.osId, hours: op.hours, sshKeyId: op.sshKeyId, bootScript: op.bootScript });
        audit(who.userId, 'deploy');
        await sendProvisionResult(chatId, who.userId, res, { title: '实例已创建', hasScript: Boolean(op.bootScript) });
        break;
      }
      case 'rebuild': {
        const res = await alice.rebuild(op.id, { osId: op.osId, sshKeyId: op.sshKeyId, bootScript: op.bootScript });
        audit(who.userId, 'rebuild', op.id);
        await sendProvisionResult(chatId, who.userId, res, { title: `实例 #${esc(op.id)} 已开始重装`, id: op.id, hasScript: Boolean(op.bootScript) });
        break;
      }
      case 'view_output':
        audit(who.userId, 'view-boot-output', op.id);
        await send(chatId, '正在读取启动脚本输出…');
        watchCommand(chatId, op.id, op.uid).catch((err) => log.error(`[bot] 查询启动脚本输出异常：${err.message}`));
        break;
      default:
        throw new Error(`未知操作 ${op.kind}`);
    }
  }

  // ---------- 路由 ----------

  // 非命令的文字：如果这个用户正在等待输入（命令 / 启动脚本）就消费掉。
  async function onPlainText(chatId, userId, text) {
    const s = getSession(userId);
    if (s && s.kind === 'exec') {
      sessions.delete(userId);
      await askExec(chatId, userId, s.data.id, text);
    } else if (s && s.step === 'script') {
      const script = optText(text, '启动脚本', SCRIPT_MAX);
      await finishWizard(chatId, userId, s, script);
    } else if (s) {
      await send(chatId, '请用上面的按钮选择，或发送 /cancel 取消。');
    } else {
      await send(chatId, '发送 /help 查看可用命令。');
    }
  }

  async function onMessage(m, who) {
    const chatId = m.chat.id;
    const text = String(m.text || '').trim();
    const note = forwardNote(m);
    if (note) await send(chatId, note);
    // 以 / 开头的命令在任何情况下优先于"等待输入"。
    const cmd = /^\/([A-Za-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
    if (!cmd) {
      await onPlainText(chatId, who.userId, text);
      return;
    }
    switch (cmd[1].toLowerCase()) {
      case 'start':
      case 'help':
        await send(chatId, HELP);
        break;
      case 'list':
        await cmdList(chatId);
        break;
      case 'account':
        await cmdAccount(chatId);
        break;
      case 'deploy':
        await cmdDeploy(chatId, who.userId);
        break;
      case 'exec': {
        const p = /^\/exec(?:@\w+)?\s+(\S+)\s+([\s\S]+)$/.exec(text);
        let id = null;
        try {
          id = p ? reqId(p[1], '实例') : null;
        } catch {
          /* 实例 ID 不合法，按用法说明处理 */
        }
        if (id) await askExec(chatId, who.userId, id, p[2]);
        else await execUsage(chatId);
        break;
      }
      case 'cancel':
        await send(chatId, sessions.delete(who.userId) ? '已取消。' : '当前没有进行中的操作。');
        break;
      default:
        await send(chatId, '未知命令，发送 /help 查看可用命令。');
    }
  }

  async function onCallback(q, who) {
    const chatId = who.chat.id;
    const messageId = q.message && q.message.message_id;
    let answered = false;
    const answer = async (text) => {
      answered = true;
      try {
        await tg.call('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text } : {}) });
      } catch (err) {
        log.warn(`[bot] 应答回调失败：${err.message}`);
      }
    };

    try {
      const [verb, a, b] = String(q.data || '').split(':');
      switch (verb) {
        case 'i':
          await refreshCard(chatId, messageId, reqId(a, '实例'));
          break;
        case 'p': {
          if (!POWER_ACTIONS.includes(a)) throw new HttpError(400, '无效的电源操作');
          const id = reqId(b, '实例');
          const label = await labelOf(id);
          const warn = a === 'poweroff' ? '\n强制关机相当于直接断电，未保存的数据可能丢失。' : '';
          await askConfirm(chatId, who.userId, { kind: 'power', id, action: a, confirmText: POWER_TEXT[a] }, `确定${POWER_TEXT[a]}「${esc(label)}」吗？${warn}`);
          break;
        }
        case 'ar': {
          const id = reqId(a, '实例');
          if (b === undefined) await showAutoMenu(chatId, id);
          else {
            // 开关自动续期改变计费行为，必须二次确认。
            if (b !== '0') hours(b);
            const label = await labelOf(id);
            const text = b === '0'
              ? `确定关闭「${esc(label)}」的自动续期吗？`
              : `确定为「${esc(label)}」开启自动续期（每次 ${b} 小时）吗？`;
            await askConfirm(chatId, who.userId, { kind: 'auto-renew', id, value: b, confirmText: b === '0' ? '确认关闭' : '确认开启' }, text);
          }
          break;
        }
        case 'dx': {
          const id = reqId(a, '实例');
          const label = await labelOf(id);
          await askConfirm(chatId, who.userId, { kind: 'destroy', id, confirmText: '确认删除' }, `⚠️ 将永久销毁「${esc(label)}」及其全部数据，无法恢复。确定吗？`);
          break;
        }
        case 'ex': {
          const id = reqId(a, '实例');
          startSession(who.userId, 'exec', 'command', { id });
          await send(chatId, `请发送要在 #${esc(id)} 上以 root 执行的命令（/cancel 取消）：`);
          break;
        }
        case 'rb':
          await startRebuild(chatId, who.userId, reqId(a, '实例'));
          break;
        case 'w':
          await onWizard(chatId, who.userId, answer, a, b);
          break;
        case 'v': {
          const entry = takeToken(a, who.userId);
          if (!entry || entry.op.kind !== 'view_output') {
            await answer('该按钮已失效或已过期');
            break;
          }
          await runOp(entry.op, who);
          break;
        }
        case 'c': {
          const entry = takeToken(a, who.userId);
          if (!entry) {
            await answer('该操作已失效或已过期，请重新发起');
            break;
          }
          await clearKeyboard(chatId, messageId);
          await runOp(entry.op, who);
          break;
        }
        case 'n':
          takeToken(a, who.userId); // 作废
          await clearKeyboard(chatId, messageId);
          await answer('已取消');
          break;
        default:
          break;
      }
    } finally {
      if (!answered) await answer();
    }
  }

  async function handleUpdate(update) {
    const m = update.message;
    const q = update.callback_query;
    const from = (m || q || {}).from;
    const chat = m ? m.chat : q && q.message && q.message.chat;
    const userId = from ? String(from.id) : '';
    if (!allowed.has(userId) || !chat || chat.type !== 'private') {
      if (from) log.warn(`[bot] 忽略未授权 id=${userId}`);
      return;
    }
    const who = { userId, chat };
    try {
      if (m) await onMessage(m, who);
      else if (q) await onCallback(q, who);
    } catch (err) {
      log.warn(`[bot] 处理失败：${err.message}`);
      try {
        await send(chat.id, `操作失败：${esc(err.message)}`);
      } catch {
        /* 连错误都发不出去，只能忽略 */
      }
    }
  }

  // ---------- 推送（调度器的事件）----------

  // 返回 { text, keyboard? }；不认识的事件类型返回 null。
  function notifyMessage(event) {
    const inst = event.inst || {};
    const who = `实例「${esc(inst.name || `#${inst.id}`)}」#${esc(inst.id)}`;
    const autoButton = V.rows([V.btn('自动续期', `ar:${inst.id}`)]);
    switch (event.type) {
      case 'renewed': {
        const t = event.expires ? Date.parse(event.expires) : NaN;
        return { text: `✅ ${who} 已自动续期 ${event.hours} 小时${Number.isNaN(t) ? '' : `，新的到期时间 ${V.fmtTime(t, tz)}`}` };
      }
      case 'renew_failed': {
        const max = event.maxAttempts || renewMaxAttempts;
        const head = event.final
          ? `❌ ${who} 自动续期连续 ${event.attempt || max} 次都失败：${esc(event.error)}\n不会再自动尝试了，请尽快手动处理；重新开启自动续期，会再试一轮。`
          : `❌ ${who} 自动续期失败${event.attempt ? `（第 ${event.attempt}/${max} 次）` : ''}：${esc(event.error)}\n将每隔 ${renewRetryMinutes} 分钟重试，最多尝试 ${max} 次。`;
        return { text: head, keyboard: autoButton };
      }
      case 'expiring': {
        if (event.basis === 'lifetime') {
          return { text: `⚠️ ${who}已运行约 ${event.elapsedHours} 小时，31 小时后将被自动回收，请尽快保存机器数据，机器将被删除。` };
        }
        return {
          text: `⚠️ ${who}还有约 ${event.hoursLeft} 小时到期（未开启自动续期），到期后将被删除，请尽快保存机器数据。`,
          keyboard: autoButton,
        };
      }
      default:
        return null;
    }
  }

  // 发给白名单里的每个用户；某个用户发送失败（比如还没对 bot 发过 /start）只记日志，不影响其他人。
  async function notify(event) {
    const msg = notifyMessage(event);
    if (!msg) return;
    for (const id of allowed) {
      try {
        await send(Number(id), msg.text, msg.keyboard ? { reply_markup: { inline_keyboard: msg.keyboard } } : {});
      } catch (err) {
        log.warn(`[bot] 推送给 ${id} 失败：${err.message}`);
      }
    }
  }

  // ---------- 长轮询 ----------

  async function loop() {
    let backoff = 1000;
    while (!stopped) {
      pollAbort = new AbortController();
      try {
        const updates = await tg.call(
          'getUpdates',
          { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] },
          { timeoutMs: 65000, signal: pollAbort.signal },
        );
        backoff = 1000;
        for (const u of updates) {
          if (u.update_id < offset) continue; // 重复投递的 update 只处理一次
          offset = u.update_id + 1;
          await handleUpdate(u);
        }
      } catch (err) {
        if (stopped) break;
        if (err.code === 401) {
          log.error('[bot] token 无效，bot 已停用');
          break;
        }
        log.warn(`[bot] 轮询失败：${err.message}，${backoff / 1000} 秒后重试`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }

  // token 无效（401）或格式错误（404）才停用；网络暂时不通、Telegram 5xx 这类瞬时错误按指数退避一直重试，
  // 否则 VPS 重启后 Docker 先于网络就绪时，bot 会一直是停用状态。stop() 可以打断重试。
  async function start() {
    let backoff = 1000;
    while (!stopped) {
      try {
        const me = await tg.call('getMe');
        log.log(`[bot] 已连接 @${me.username}`);
        // 丢弃离线期间积压的 update，避免重启后重放旧指令（尤其是删除类）。
        const backlog = await tg.call('getUpdates', { offset: -1, limit: 1, timeout: 0 });
        if (backlog && backlog.length) offset = backlog[backlog.length - 1].update_id + 1;
        loop().catch((err) => log.error(`[bot] 轮询异常退出：${err.message}`));
        return true;
      } catch (err) {
        if (err.code === 401 || err.code === 404) {
          log.error(`[bot] 启动失败：${err.message}（token 无效）`);
          return false;
        }
        log.warn(`[bot] 启动失败：${err.message}，${backoff / 1000} 秒后重试`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
    return false;
  }

  function stop() {
    stopped = true;
    if (pollAbort) pollAbort.abort();
  }

  return { start, stop, handleUpdate, notify };
}

module.exports = { createBot };
