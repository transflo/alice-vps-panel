'use strict';

// 调度器：每轮拉一次实例列表，对已开启自动续期的实例在到期前一段时间内续期（失败最多再试 2 次）。
// 没有专门设置过的实例默认开启（每次 7 小时）。
// 提醒（需要 bot 推送）：开启的实例在 31 小时寿命的最后 3 小时、1 小时各提醒一次；
// 明确关闭的实例在到期前最后 3 小时、1 小时各提醒一次。
// "要不要做"的判断是纯函数 decide()，不碰网络。

const { asList, normInstance } = require('./normalize');

const isoOf = (ms) => new Date(ms).toISOString();

// 每个到期点最多尝试 3 次；两次之间至少隔 cfg.retryGapMs（默认 10 分钟），把机会分散在整个续期窗口里。
const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_GAP_MS = 10 * 60e3;
const HOUR_MS = 3600e3;

function decide({ entry, inst, cycle = {}, now, cfg }) {
  if (!inst.expiresAt || /expire/i.test(String(inst.status ?? ''))) return 'none';
  const remaining = inst.expiresAt - now;
  if (remaining <= 0) return 'none'; // 已到期，实例可能已被回收
  const key = isoOf(inst.expiresAt);
  if (entry && entry.enabled) {
    if (remaining <= cfg.renewBeforeMs && cycle.renewedFrom !== key) {
      // 尝试次数属于某一个到期点：到期时间变了（续期成功或手动续期）就重新计数。
      if (cycle.attemptFor === key) {
        if ((cycle.attempts || 0) >= MAX_ATTEMPTS) return 'none';
        if (now - (cycle.lastAttemptAt || 0) < (cfg.retryGapMs ?? DEFAULT_RETRY_GAP_MS)) return 'none';
      }
      return 'renew';
    }
    // 寿命提醒（需要 bot 推送）：自创建起 31 小时将被回收，最后 3 小时和 1 小时各提醒一次。
    // 先判 1 小时：晚加入（比如面板刚恢复）的实例直接收到最紧急的一条，文字不会过期。
    if (cfg.botEnabled && Number.isFinite(inst.createdAt)) {
      const elapsed = now - inst.createdAt;
      if (elapsed >= 30 * HOUR_MS && !cycle.warnedLifetime1h) return 'warn_lifetime_1h';
      if (elapsed >= 28 * HOUR_MS && elapsed < 30 * HOUR_MS && !cycle.warnedLifetime3h) return 'warn_lifetime_3h';
    }
    return 'none';
  }
  // 明确关闭了自动续期：按到期时间提醒，最后 3 小时和 1 小时各一次（需要 bot 推送）。
  if (cfg.botEnabled) {
    if (remaining <= 1 * HOUR_MS && cycle.warnedExpiry1h !== key) return 'warn_expiry_1h';
    if (remaining <= 3 * HOUR_MS && remaining > 1 * HOUR_MS && cycle.warnedExpiry3h !== key) return 'warn_expiry_3h';
  }
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
    const prev = store.getCycle(inst.id);
    const attempt = (prev.attemptFor === key ? prev.attempts || 0 : 0) + 1;
    // 先记下这次尝试再调用 Alice：请求超时、结果不明或进程中途退出，也不会马上重复续期。
    store.updateCycle(inst.id, { attemptFor: key, attempts: attempt, lastAttemptAt: now() });
    try {
      const res = await alice.renew(inst.id, entry.hours);
      store.updateCycle(inst.id, { renewedFrom: key });
      const expires = res && typeof res === 'object' ? res.expiration_at_utc : undefined;
      log.log(`[auto-renew] 实例 ${inst.id} 已自动续期 ${entry.hours} 小时`);
      await send({ type: 'renewed', inst, hours: entry.hours, expires });
    } catch (err) {
      const final = attempt >= MAX_ATTEMPTS;
      log.warn(`[auto-renew] 实例 ${inst.id} 自动续期失败（第 ${attempt}/${MAX_ATTEMPTS} 次）：${err.message}`);
      // 只在第 1 次失败（让人知道出问题了）和最后一次失败（不会再试了）时通知，中间的重试不打扰。
      if (attempt === 1 || final) {
        await send({ type: 'renew_failed', inst, error: err.message, attempt, maxAttempts: MAX_ATTEMPTS, final });
      }
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      if (alice.configured && !alice.configured()) return;
      // 默认开启：没有专门设置的实例也视为开启，必须拉列表才能发现它们，所以这里不再提前返回。

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
        // 默认开启：没有专门设置过的实例按开启 7 小时处理。
        const entry = store.getEffectiveAutoRenew(inst.id);
        const action = decide({ entry, inst, cycle: store.getCycle(inst.id), now: now(), cfg });
        if (action === 'renew') {
          await renew(inst, entry);
        } else if (action === 'warn_expiry_3h' || action === 'warn_expiry_1h') {
          const patch = action === 'warn_expiry_3h' ? { warnedExpiry3h: isoOf(inst.expiresAt) } : { warnedExpiry1h: isoOf(inst.expiresAt) };
          store.updateCycle(inst.id, patch);
          await send({ type: 'expiring', basis: 'expiry', hoursLeft: action === 'warn_expiry_3h' ? 3 : 1, inst });
        } else if (action === 'warn_lifetime_3h' || action === 'warn_lifetime_1h') {
          const hoursLeft = action === 'warn_lifetime_3h' ? 3 : 1;
          store.updateCycle(inst.id, action === 'warn_lifetime_3h' ? { warnedLifetime3h: true } : { warnedLifetime1h: true });
          await send({
            type: 'expiring', basis: 'lifetime', hoursLeft,
            elapsedHours: Math.max(0, Math.floor((now() - inst.createdAt) / HOUR_MS)), inst,
          });
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
      setTimeout(run, Math.min(5000, cfg.intervalMs)).unref();
      timer = setInterval(run, cfg.intervalMs);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { MAX_ATTEMPTS, decide, createScheduler };
