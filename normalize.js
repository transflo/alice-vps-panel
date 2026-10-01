'use strict';

// 后端用的 Alice 数据整理，移植自 web/src/utils.js 与 web/src/data.js。
// 运行镜像里没有 web/，两边无法共用同一份代码；修改这里的行为时请对照网页版的同名函数。

// 按顺序取第一个非空的标量字段，支持 "plan.name" 这样的路径。
function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    let v = obj;
    for (const part of key.split('.')) v = v && typeof v === 'object' ? v[part] : undefined;
    if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') return v;
  }
  return undefined;
}

// 取第一个非空字段，不限类型。
function firstValue(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  return keys.map((k) => obj[k]).find((v) => v !== undefined && v !== null && v !== '');
}

// 列表可能直接是数组，也可能包在 { list: [...] } 之类的对象里。
function asList(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    for (const k of ['list', 'items', 'instances', 'data', 'rows', 'records', 'plans', 'keys', 'images']) {
      if (Array.isArray(x[k])) return x[k];
    }
    const arr = Object.values(x).find(Array.isArray);
    if (arr) return arr;
  }
  return [];
}

// IP 可能是字符串，也可能是 [{ address, gateway, ... }] 这样的数组。
function ipText(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'object') return String(v);
  const list = (Array.isArray(v) ? v : [v])
    .map((x) => (x && typeof x === 'object' ? x.address || x.ip : x))
    .filter((x) => x !== undefined && x !== null && x !== '');
  return list.length ? list.join(', ') : undefined;
}

const STATUS_LABELS = {
  active: '正常', running: '运行中', online: '运行中', started: '运行中',
  stopped: '已关机', shutdown: '已关机', off: '已关机', offline: '已关机', poweroff: '已关机', halted: '已关机',
  pending: '等待中', creating: '创建中', deploying: '部署中', provisioning: '部署中', installing: '安装中',
  rebuilding: '重装中', reinstalling: '重装中', booting: '启动中', starting: '启动中',
  restarting: '重启中', rebooting: '重启中', stopping: '关机中',
  suspended: '已暂停', expired: '已过期', error: '异常', failed: '失败', unknown: '未知',
};

function statusLabel(s) {
  const key = String(s === undefined || s === null ? '' : s).toLowerCase();
  return STATUS_LABELS[key] || (key ? String(s) : '未知');
}

// 和 pick 一样，但跳过纯数字（套餐数据里的 region、node 是编号，不是名称）。
function pickName(obj, ...keys) {
  for (const key of keys) {
    const v = pick(obj, key);
    if (v !== undefined && !/^\d+$/.test(String(v))) return v;
  }
  return undefined;
}

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

// 实例状态接口返回 { status: 'complete', state: { state: 'running', ... }, ... }。
function powerState(data) {
  const s = data && typeof data === 'object' ? data.state : undefined;
  const v = s && typeof s === 'object' ? s.state : undefined;
  return typeof v === 'string' && v ? v : undefined;
}

// 卡片上的状态：实例有效时显示开关机状态，过期、等待中等情况显示列表里的状态。
function cardStatus(inst, power) {
  return power && /^(active|running)?$/i.test(String(inst.status ?? '')) ? power : inst.status;
}

function fmtMemory(v) {
  if (v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n >= 256 ? `${+(n / 1024).toFixed(1)} GB 内存` : `${n} GB 内存`;
}

function specText(o) {
  const cpu = pick(o, 'cpu', 'cores', 'vcpu', 'core');
  const mem = pick(o, 'memory', 'ram', 'mem');
  const disk = pick(o, 'disk', 'storage', 'ssd');
  const diskType = pick(o, 'disk_type');
  let diskText = null;
  if (disk !== undefined) {
    diskText = Number.isFinite(Number(disk)) ? `${disk} GB ${diskType || '磁盘'}` : String(disk);
  }
  return [cpu !== undefined ? `${cpu} 核` : null, fmtMemory(mem), diskText].filter(Boolean).join(' · ');
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

function flattenImages(data) {
  const out = [];
  const walk = (items, group) => {
    for (const it of asList(items)) {
      if (!it || typeof it !== 'object') continue;
      const nested = ['os_list', 'images', 'list', 'children', 'items', 'os'].map((k) => it[k]).find(Array.isArray);
      if (nested) {
        walk(nested, pick(it, 'group_name', 'group', 'name', 'title') || group);
      } else {
        const id = pick(it, 'id', 'os_id', 'image_id');
        if (id !== undefined) out.push({ id: String(id), name: pick(it, 'name', 'title', 'os_name', 'label') || `#${id}`, group });
      }
    }
  };
  // Alice 每次返回的系统分组顺序不固定，按分组编号排序。
  const groups = asList(data).slice().sort((a, b) => Number(a && a.group_id) - Number(b && b.group_id) || 0);
  walk(groups, null);
  return out;
}

// allow_packages 形如 "38|39|40"，max_time 为单次最长使用时长（小时）。
function allowedPlanIds(perm) {
  const raw = perm && perm.allow_packages;
  if (raw === undefined || raw === null || raw === '') return null;
  const ids = (Array.isArray(raw) ? raw : String(raw).split(/[|,\s]+/)).map(String).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

function maxHours(perm) {
  const n = Number(perm && perm.max_time);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

function planOptions(plans, perm) {
  const allowed = allowedPlanIds(perm);
  let list = allowed ? plans.filter((p) => allowed.has(p.id)) : plans;
  if (!list.length) list = plans; // 权限格式不认识时不要把套餐全部藏掉
  return list.map((p) => {
    const soldOut = p.stock !== undefined && Number(p.stock) <= 0;
    const extra = [p.specs, p.stock !== undefined ? (soldOut ? '无库存' : `库存 ${p.stock}`) : null].filter(Boolean).join('，');
    return { id: p.id, label: extra ? `${p.name}（${extra}）` : p.name, disabled: soldOut };
  });
}

const DURATIONS = [1, 2, 4, 8, 12, 24, 48, 72, 168];

function durationOptions(max) {
  const list = max ? DURATIONS.filter((n) => n <= max) : DURATIONS.slice();
  if (max && max < DURATIONS[DURATIONS.length - 1] && !list.includes(max)) list.push(max);
  return list.length ? list : [1];
}

function durationLabel(n) {
  return n % 24 === 0 ? `${n} 小时（${n / 24} 天）` : `${n} 小时`;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

// Alice 返回的命令输出是 Base64 编码的：能解出 UTF-8 文本就解码显示，并去掉终端颜色控制符。
function decodeOutput(text) {
  const raw = String(text);
  const s = raw.replace(/\s+/g, '');
  if (s.length >= 4 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
    try {
      const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(ANSI_RE, '');
      // eslint-disable-next-line no-control-regex
      if (!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(decoded)) return decoded;
    } catch {
      /* 不是 Base64 文本，按原样显示 */
    }
  }
  return raw.replace(ANSI_RE, '');
}

const RUNNING_RE = /^(pend|queue|run|wait|process|executing|submit|creat|start|in[_ -]?progress)/i;

module.exports = {
  pick, firstValue, asList, ipText, statusLabel, normInstance, powerState, cardStatus, specText,
  normPlans, normSshKeys, flattenImages, allowedPlanIds, maxHours, planOptions,
  durationOptions, durationLabel, decodeOutput, RUNNING_RE,
};
