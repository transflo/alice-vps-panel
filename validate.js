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
