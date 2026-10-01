'use strict';

// Telegram bot：用 getUpdates 长轮询对接 Bot API，提供与网页等价的实例控制能力。
// 安全要点（设计文档 §4）：只认白名单里的数字用户 ID 且只响应私聊，其余一律静默忽略；
// 危险操作走服务端内存里的一次性确认令牌（绑定发起人、60 秒过期）；启动时丢弃积压的 update。

const crypto = require('node:crypto');
const { createTelegram } = require('./telegram');
const N = require('./normalize');
const V = require('./bot-views');
const { HttpError, POWER_ACTIONS, hours, reqId } = require('./validate');

const { esc } = V;

const TOKEN_TTL_MS = 60e3;
const LIST_LIMIT = 10;
const POWER_TEXT = { boot: '开机', shutdown: '关机', restart: '重启', poweroff: '强制关机' };

const HELP = [
  '<b>Alice 面板 bot</b>',
  '/list — 查看实例并操作（开关机、重启、续期、自动续期……）',
  '/account — 账户余额与权限',
  '/help — 显示这份帮助',
].join('\n');

function createBot({
  token,
  allowedIds,
  apiBase = 'https://api.telegram.org',
  alice,
  store,
  displayTimeZone = 'Asia/Shanghai',
  renewBeforeMinutes = 10,
  fetch = globalThis.fetch,
  log = console,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const tg = createTelegram({ token, apiBase, fetch });
  const allowed = new Set(allowedIds.map(String));
  const pending = new Map(); // 确认令牌 → { userId, op, expires }
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

  // ---------- 一次性确认令牌 ----------

  function createToken(userId, op) {
    const t = now();
    for (const [k, v] of pending) if (v.expires < t) pending.delete(k);
    const id = crypto.randomBytes(6).toString('base64url');
    pending.set(id, { userId, op, expires: t + TOKEN_TTL_MS });
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

  const cardOf = (inst, power) => V.instanceCard({ inst, power, auto: store.getAutoRenew(inst.id), tz, now: now() });

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

  async function showRenewMenu(chatId, id) {
    const max = await maxAllowedHours();
    await send(chatId, `选择续期时长（实例 #${esc(id)}）：`, {
      reply_markup: { inline_keyboard: V.hoursKeyboard(`rn:${id}`, N.durationOptions(max), `i:${id}`) },
    });
  }

  async function doRenew(chatId, userId, id, h) {
    const max = await maxAllowedHours();
    if (max && h > max) throw new HttpError(400, `超过账户单次最长时长 ${max} 小时`);
    const res = await alice.renew(id, h);
    audit(userId, 'renew', id);
    const next = res && typeof res === 'object' && res.expiration_at_utc ? Date.parse(res.expiration_at_utc) : NaN;
    await send(chatId, `✅ 已续期 ${h} 小时${Number.isNaN(next) ? '' : `，新的到期时间 ${V.fmtTime(next, tz)}`}`);
  }

  async function showAutoMenu(chatId, id) {
    const cur = store.getAutoRenew(id);
    const max = await maxAllowedHours();
    const keyboard = V.hoursKeyboard(`ar:${id}`, N.durationOptions(max), null);
    keyboard.push([V.btn('关闭自动续期', `ar:${id}:0`)], [V.btn('返回', `i:${id}`)]);
    await send(
      chatId,
      `<b>自动续期</b>（实例 #${esc(id)}）\n当前：${cur && cur.enabled ? `开，每次 ${cur.hours} 小时` : '关'}\n`
        + `开启后会在到期前约 ${renewBeforeMinutes} 分钟自动续期（每次续期都会扣费）。选择每次续期的时长，或关闭：`,
      { reply_markup: { inline_keyboard: keyboard } },
    );
  }

  async function doAutoRenew(chatId, userId, id, value) {
    const prev = store.getAutoRenew(id);
    if (value === '0') {
      store.setAutoRenew(id, { enabled: false, hours: prev ? prev.hours : 24 });
      audit(userId, 'auto-renew-off', id);
      await send(chatId, `已关闭实例 #${esc(id)} 的自动续期。`);
      return;
    }
    const h = hours(value);
    const max = await maxAllowedHours();
    if (max && h > max) throw new HttpError(400, `超过账户单次最长时长 ${max} 小时`);
    store.setAutoRenew(id, { enabled: true, hours: h });
    audit(userId, 'auto-renew-on', id);
    await send(chatId, `✅ 已开启实例 #${esc(id)} 的自动续期：到期前约 ${renewBeforeMinutes} 分钟自动续 ${h} 小时。`);
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
      default:
        throw new Error(`未知操作 ${op.kind}`);
    }
  }

  // ---------- 路由 ----------

  async function onMessage(m) {
    const chatId = m.chat.id;
    const text = String(m.text || '').trim();
    const cmd = /^\/([A-Za-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
    if (!cmd) {
      await send(chatId, '发送 /help 查看可用命令。');
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
          if (a === 'boot') {
            await runOp({ kind: 'power', id, action: 'boot' }, who);
          } else {
            const label = await labelOf(id);
            const warn = a === 'poweroff' ? '\n强制关机相当于直接断电，未保存的数据可能丢失。' : '';
            await askConfirm(chatId, who.userId, { kind: 'power', id, action: a, confirmText: POWER_TEXT[a] }, `确定${POWER_TEXT[a]}「${esc(label)}」吗？${warn}`);
          }
          break;
        }
        case 'rn': {
          const id = reqId(a, '实例');
          if (b === undefined) await showRenewMenu(chatId, id);
          else await doRenew(chatId, who.userId, id, hours(b));
          break;
        }
        case 'ar': {
          const id = reqId(a, '实例');
          if (b === undefined) await showAutoMenu(chatId, id);
          else await doAutoRenew(chatId, who.userId, id, b);
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
      if (m) await onMessage(m);
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

  async function start() {
    try {
      const me = await tg.call('getMe');
      log.log(`[bot] 已连接 @${me.username}`);
      // 丢弃离线期间积压的 update，避免重启后重放旧指令（尤其是删除类）。
      const backlog = await tg.call('getUpdates', { offset: -1, limit: 1, timeout: 0 });
      if (backlog && backlog.length) offset = backlog[backlog.length - 1].update_id + 1;
    } catch (err) {
      log.error(`[bot] 启动失败：${err.message}`);
      return false;
    }
    loop().catch((err) => log.error(`[bot] 轮询异常退出：${err.message}`));
    return true;
  }

  function stop() {
    stopped = true;
    if (pollAbort) pollAbort.abort();
  }

  return { start, stop, handleUpdate };
}

module.exports = { createBot };
