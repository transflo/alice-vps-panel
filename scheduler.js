'use strict';

// 调度器：每轮拉一次实例列表，对已开启自动续期的实例在到期前一段时间内续期（失败最多再试 2 次），
// 对没开自动续期的实例（bot 启用时）在到期前提醒一次。
// "要不要做"的判断是纯函数 decide()，不碰网络。

const { asList, normInstance } = require('./normalize');

const isoOf = (ms) => new Date(ms).toISOString();

// 每个到期点最多尝试 3 次；两次之间至少隔 cfg.retryGapMs（默认 10 分钟），把机会分散在整个续期窗口里。
const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_GAP_MS = 10 * 60e3;

function decide({ entry, inst, cycle = {}, now, cfg }) {
  if (!inst.expiresAt || /expire/i.test(String(inst.status ?? ''))) return 'none';
  const remaining = inst.expiresAt - now;
  if (remaining <= 0) return 'none'; // 已到期，实例可能已被回收
  const key = isoOf(inst.expiresAt);
  if (entry && entry.enabled) {
    if (remaining > cfg.renewBeforeMs || cycle.renewedFrom === key) return 'none';
    // 尝试次数属于某一个到期点：到期时间变了（续期成功或手动续期）就重新计数。
    if (cycle.attemptFor === key) {
      if ((cycle.attempts || 0) >= MAX_ATTEMPTS) return 'none';
      if (now - (cycle.lastAttemptAt || 0) < (cfg.retryGapMs ?? DEFAULT_RETRY_GAP_MS)) return 'none';
    }
    return 'renew';
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
