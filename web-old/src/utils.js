// 数据整理与格式化工具。Alice 文档的返回示例只显示了部分字段，这里按示例字段优先、常见写法兜底。

// 按顺序取第一个非空的标量字段，支持 "plan.name" 这样的路径。
export function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    let v = obj;
    for (const part of key.split('.')) v = v && typeof v === 'object' ? v[part] : undefined;
    if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') return v;
  }
  return undefined;
}

// 取第一个非空字段，不限类型。
export function firstValue(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  return keys.map((k) => obj[k]).find((v) => v !== undefined && v !== null && v !== '');
}

// 列表可能直接是数组，也可能包在 { list: [...] } 之类的对象里。
export function asList(x) {
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

// Alice 的时间有 "2025-11-23T14:25:25Z" 和 "2025-11-23 14:25:25" 两种写法，文档里同一实例两种写法数值相同，
// 所以不带时区的时间也按 UTC 解析。
// creation_at / expiration_at 已由后端规范化成带 Z 的 *_at_utc（creation_at 的偏移标签实测有误），这里只是其他字段和旧后端的兜底。
export function toDate(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = `${s.replace(' ', 'T')}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const pad = (n) => String(n).padStart(2, '0');

export function fmtDate(d, withSeconds = false) {
  if (!d) return '—';
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base;
}

export function fmtRemaining(ms) {
  if (ms <= 0) return '已到期';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `剩余 ${d} 天 ${hh} 小时`;
  if (hh > 0) return `剩余 ${hh} 小时 ${mm} 分`;
  return `剩余 ${mm} 分 ${pad(ss)} 秒`;
}

function fmtMemory(v) {
  if (v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n >= 256 ? `${+(n / 1024).toFixed(1)} GB 内存` : `${n} GB 内存`;
}

export function specText(o) {
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

// IP 可能是字符串，也可能是 [{ address, gateway, ... }] 这样的数组（实例状态接口就是这样返回的）。
export function ipText(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'object') return String(v);
  const list = (Array.isArray(v) ? v : [v])
    .map((x) => (x && typeof x === 'object' ? x.address || x.ip : x))
    .filter((x) => x !== undefined && x !== null && x !== '');
  return list.length ? list.join(', ') : undefined;
}

// 实例列表的 status 是 active / expired / pending，只表示实例是否有效；开关机状态（running / stopped）要从状态接口取。
const STATUS_LABELS = {
  active: '正常', running: '运行中', online: '运行中', started: '运行中',
  stopped: '已关机', shutdown: '已关机', off: '已关机', offline: '已关机', poweroff: '已关机', halted: '已关机',
  pending: '等待中', creating: '创建中', deploying: '部署中', provisioning: '部署中', installing: '安装中',
  rebuilding: '重装中', reinstalling: '重装中', booting: '启动中', starting: '启动中',
  restarting: '重启中', rebooting: '重启中', stopping: '关机中',
  suspended: '已暂停', expired: '已过期', error: '异常', failed: '失败', unknown: '未知',
};

// tone：ok 运行 / busy 处理中 / off 关机 / bad 异常 / muted 未知
export function statusInfo(s) {
  const key = String(s === undefined || s === null ? '' : s).toLowerCase();
  const label = STATUS_LABELS[key] || (key ? String(s) : '未知');
  let tone = 'muted';
  if (/^(running|active|online|started|on)$|运行/.test(key)) tone = 'ok';
  else if (/pend|creat|deploy|provision|install|rebuild|reinstall|boot|start|reboot|stopping|migrat|中$/.test(key)) tone = 'busy';
  else if (/stop|shut|off|halt|关机/.test(key)) tone = 'off';
  else if (/error|fail|suspend|expire|lock|异常|失败/.test(key)) tone = 'bad';
  return { label, tone };
}

// 和 pick 一样，但跳过纯数字（套餐数据里的 region、node 是编号，不是名称）。
function pickName(obj, ...keys) {
  for (const key of keys) {
    const v = pick(obj, key);
    if (v !== undefined && !/^\d+$/.test(String(v))) return v;
  }
  return undefined;
}

export function normInstance(raw) {
  const id = pick(raw, 'id', 'instance_id', 'server_id');
  return {
    raw,
    id: id === undefined ? '' : String(id),
    name: pick(raw, 'hostname', 'name', 'label'),
    status: pick(raw, 'status', 'state', 'power_status', 'power_state'),
    ipv4: ipText(firstValue(raw, 'ipv4', 'ip', 'main_ip', 'ip_address', 'ipv4_address')),
    ipv6: ipText(firstValue(raw, 'ipv6', 'ipv6_address')),
    cpuName: pick(raw, 'cpu_name'),
    plan: pick(raw, 'plan.name', 'product.name', 'plan_name', 'product_name', 'plan', 'product'),
    planId: pick(raw, 'plan_id', 'product_id', 'plan.id', 'product.id'),
    os: pick(raw, 'os.name', 'os_name', 'os', 'system', 'image', 'template'),
    region: pickName(raw, 'region.name', 'region', 'location', 'datacenter', 'area'),
    specs: specText(raw),
    // *_at_utc 是后端规范化后的时间（见 alice-time.js），优先使用；其余字段名是兜底。
    created: toDate(pick(raw, 'creation_at_utc', 'creation_at', 'created_at', 'create_at', 'created', 'create_time')),
    expires: toDate(pick(raw, 'expiration_at_utc', 'expiration_at', 'expired_at', 'expire_at', 'expires_at', 'expiration', 'expire_time', 'due_at')),
  };
}

// 实例状态接口返回 { status: 'complete', state: { state: 'running', cpu, memory: {...}, traffic: {...} }, ... }。
export function powerState(data) {
  const s = data && typeof data === 'object' ? data.state : undefined;
  const v = s && typeof s === 'object' ? s.state : undefined;
  return typeof v === 'string' && v ? v : undefined;
}

// 卡片上的状态：实例有效时显示开关机状态，过期、等待中等情况显示列表里的状态。
export function cardStatus(inst, power) {
  return power && /^(active|running)?$/i.test(String(inst.status ?? '')) ? power : inst.status;
}

const toGB = (v, unit) => {
  const n = v === null || v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? `${+(n / unit).toFixed(2)} GB` : null;
};

// 状态接口的实时数据：内存单位 KB，流量单位字节（和 VSCode 插件的换算一致）。
export function stateSummary(data) {
  const s = data && typeof data === 'object' && data.state && typeof data.state === 'object' ? data.state : null;
  if (!s) return null;
  const rows = {};
  if (typeof s.state === 'string') rows['电源状态'] = statusInfo(s.state).label;
  const cpu = s.cpu === null || s.cpu === undefined || s.cpu === '' ? NaN : Number(s.cpu);
  if (Number.isFinite(cpu)) rows['CPU 使用率'] = `${+cpu.toFixed(1)}%`;
  const mem = s.memory && typeof s.memory === 'object' ? s.memory : null;
  if (mem) {
    const avail = toGB(mem.memavailable, 1024 * 1024);
    const total = toGB(mem.memtotal, 1024 * 1024);
    if (avail || total) rows['可用内存'] = [avail, total].filter(Boolean).join(' / ');
  }
  const t = s.traffic && typeof s.traffic === 'object' ? s.traffic : null;
  if (t) {
    const out = toGB(t.out, 1024 ** 3);
    const inn = toGB(t.in, 1024 ** 3);
    if (out || inn) rows['已用流量'] = `↑ ${out || '—'} / ↓ ${inn || '—'}`;
  }
  return Object.keys(rows).length ? rows : null;
}

// 账户余额 credit 的单位是百万分之一美元（Alice 控制台显示为 credit ÷ 1,000,000）。
export function fmtCredit(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `$${(n / 1e6).toFixed(2)}` : String(v);
}

export function flattenImages(data) {
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

// ---------- EVO 权限与时长 ----------

// allow_packages 形如 "38|39|40"，max_time 为单次最长使用时长（小时）。
export function allowedPlanIds(perm) {
  const raw = perm && perm.allow_packages;
  if (raw === undefined || raw === null || raw === '') return null;
  const ids = (Array.isArray(raw) ? raw : String(raw).split(/[|,\s]+/)).map(String).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

export function maxHours(perm) {
  const n = Number(perm && perm.max_time);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

export function planOptions(plans, perm) {
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

export function durationOptions(max) {
  let list = max ? DURATIONS.filter((n) => n <= max) : DURATIONS.slice();
  if (max && max < DURATIONS[DURATIONS.length - 1] && !list.includes(max)) list.push(max);
  return list.length ? list : [1];
}

export function durationLabel(n) {
  return n % 24 === 0 ? `${n} 小时（${n / 24} 天）` : `${n} 小时`;
}

// ---------- 命令输出 ----------

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

// Alice 返回的命令输出是 Base64 编码的：能解出 UTF-8 文本就解码显示，并去掉终端颜色控制符。
export function decodeOutput(text) {
  const raw = String(text);
  const s = raw.replace(/\s+/g, '');
  if (s.length >= 4 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
    try {
      const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(ANSI_RE, '');
      if (!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(decoded)) return decoded;
    } catch {
      /* 不是 Base64 文本，按原样显示 */
    }
  }
  return raw.replace(ANSI_RE, '');
}

export const RUNNING_RE = /^(pend|queue|run|wait|process|executing|submit|creat|start|in[_ -]?progress)/i;

// ---------- 其他 ----------

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
