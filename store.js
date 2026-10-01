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
        // 重新保存设置视为"请再试一次"（比如充值后）：清掉失败重试的计数；renewedFrom 要保留，避免同一个到期点重复续期。
        const cycle = state.cycle[id];
        if (cycle) {
          delete cycle.attemptFor;
          delete cycle.attempts;
          delete cycle.lastAttemptAt;
        }
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
      const { renewedFrom, warnedFor, attemptFor, attempts, lastAttemptAt } = state.cycle[id] || {};
      return Object.fromEntries(Object.entries({ renewedFrom, warnedFor, attemptFor, attempts, lastAttemptAt }).filter(([, v]) => v !== undefined));
    },
    updateCycle(id, patch) {
      const change = () => {
        // 创建时就记下 lastSeen，7 天清理的计时从这一刻开始。
        state.cycle[id] = { lastSeen: new Date(now()).toISOString(), ...state.cycle[id], ...patch };
      };
      if (!available) {
        change();
        return;
      }
      try {
        commit(change);
      } catch (err) {
        log.error(`[store] 保存状态失败：${err.message}`);
        change(); // 去重记录至少保留在内存里，避免重复续期 / 重复提醒
      }
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
