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

module.exports = { decide, createScheduler };
