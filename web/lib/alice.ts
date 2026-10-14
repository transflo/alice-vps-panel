// 数据整理与格式化工具。Alice 文档的返回示例只显示了部分字段，这里按示例字段优先、常见写法兜底。
// 后端的 normalize.js 是这里的另一份实现（运行镜像里没有 web/，两边无法共用），改行为时要两边同步。
// 显示文案全部走字典（第一个参数永远是 lang），tone 判定只看英文原文 key。

import { t } from "@/lib/i18n"
import type { Lang } from "@/lib/i18n/lang"

export type Rec = Record<string, unknown>
export type Scalar = string | number | boolean

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)

// 按顺序取第一个非空的标量字段，支持 "plan.name" 这样的路径。
export function pick(obj: unknown, ...keys: string[]): Scalar | undefined {
  if (!obj || typeof obj !== "object") return undefined
  for (const key of keys) {
    let v: unknown = obj
    for (const part of key.split(".")) v = v && typeof v === "object" ? (v as Rec)[part] : undefined
    if (v !== undefined && v !== null && v !== "" && typeof v !== "object") return v as Scalar
  }
  return undefined
}

// 取第一个非空字段，不限类型。
export function firstValue(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined
  return keys.map((k) => (obj as Rec)[k]).find((v) => v !== undefined && v !== null && v !== "")
}

// 列表可能直接是数组，也可能包在 { list: [...] } 之类的对象里。
export function asList(x: unknown): unknown[] {
  if (Array.isArray(x)) return x
  if (isRec(x)) {
    for (const k of ["list", "items", "instances", "data", "rows", "records", "plans", "keys", "images"]) {
      if (Array.isArray(x[k])) return x[k] as unknown[]
    }
    const arr = Object.values(x).find(Array.isArray)
    if (arr) return arr as unknown[]
  }
  return []
}

// Alice 的时间有 "2025-11-23T14:25:25Z" 和 "2025-11-23 14:25:25" 两种写法，文档里同一实例两种写法数值相同，
// 所以不带时区的时间也按 UTC 解析。
// creation_at / expiration_at 已由后端规范化成带 Z 的 *_at_utc（creation_at 的偏移标签实测有误），这里只是其他字段和旧后端的兜底。
export function toDate(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    const n = Number(v)
    return new Date(n < 1e12 ? n * 1000 : n)
  }
  let s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = `${s.replace(" ", "T")}Z`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export const pad = (n: number) => String(n).padStart(2, "0")

export function fmtDate(d: Date | null | undefined, withSeconds = false): string {
  if (!d) return "—"
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base
}

export function fmtRemaining(lang: Lang, ms: number): string {
  if (ms <= 0) return t(lang, "time.expired")
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const hh = Math.floor((s % 86400) / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  if (d > 0) return t(lang, "time.days", { d, hh })
  if (hh > 0) return t(lang, "time.hours", { hh, mm })
  return t(lang, "time.seconds", { mm, ss: pad(ss) })
}

function fmtMemory(lang: Lang, v: Scalar | undefined): string | null {
  if (v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return n >= 256 ? t(lang, "unit.memory", { n: +(n / 1024).toFixed(1) }) : t(lang, "unit.memory", { n })
}

export function specText(lang: Lang, o: unknown): string {
  const cpu = pick(o, "cpu", "cores", "vcpu", "core")
  const mem = pick(o, "memory", "ram", "mem")
  const disk = pick(o, "disk", "storage", "ssd")
  const diskType = pick(o, "disk_type")
  let diskText: string | null = null
  if (disk !== undefined) {
    diskText = Number.isFinite(Number(disk)) ? t(lang, "unit.disk", { n: String(disk), type: diskType !== undefined ? String(diskType) : t(lang, "unit.diskDefault") }) : String(disk)
  }
  return [cpu !== undefined ? t(lang, "unit.core", { n: String(cpu) }) : null, fmtMemory(lang, mem), diskText].filter(Boolean).join(" · ")
}

// IP 可能是字符串，也可能是 [{ address, gateway, ... }] 这样的数组（实例状态接口就是这样返回的）。
export function ipText(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined
  if (typeof v !== "object") return String(v)
  const list = (Array.isArray(v) ? v : [v])
    .map((x) => (x && typeof x === "object" ? ((x as Rec).address as unknown) || ((x as Rec).ip as unknown) : x))
    .filter((x) => x !== undefined && x !== null && x !== "")
  return list.length ? list.join(", ") : undefined
}

// 实例状态的英文 key → 字典 key（tone 判定只看英文原文）。
const STATUS_DICT_KEY: Record<string, "active" | "running" | "stopped" | "pending" | "deploying" | "rebuilding" | "booting" | "restarting" | "suspended" | "expired" | "error" | "unknown"> = {
  active: "active",
  running: "running", online: "running", started: "running",
  stopped: "stopped", shutdown: "stopped", off: "stopped", offline: "stopped", poweroff: "stopped", halted: "stopped", stopping: "stopped",
  pending: "pending", creating: "pending",
  deploying: "deploying", provisioning: "deploying", installing: "deploying",
  rebuilding: "rebuilding", reinstalling: "rebuilding",
  booting: "booting", starting: "booting",
  restarting: "restarting", rebooting: "restarting",
  suspended: "suspended", expired: "expired",
  error: "error", failed: "error",
  unknown: "unknown",
}

// ok 运行 / busy 处理中 / off 关机 / bad 异常 / muted 未知
export type Tone = "ok" | "busy" | "off" | "bad" | "muted"

export function statusInfo(lang: Lang, s: unknown): { label: string; tone: Tone } {
  const key = String(s === undefined || s === null ? "" : s).toLowerCase()
  const dictKey = STATUS_DICT_KEY[key]
  const label = dictKey ? t(lang, `status.${dictKey}`) : key ? String(s) : t(lang, "status.unknown")
  let tone: Tone = "muted"
  if (/^(running|active|online|started|on)$/.test(key)) tone = "ok"
  else if (/pend|creat|deploy|provision|install|rebuild|reinstall|boot|start|reboot|stopping|migrat/.test(key)) tone = "busy"
  else if (/stop|shut|off|halt/.test(key)) tone = "off"
  else if (/error|fail|suspend|expire|lock/.test(key)) tone = "bad"
  return { label, tone }
}

// 和 pick 一样，但跳过纯数字（套餐数据里的 region、node 是编号，不是名称）。
function pickName(obj: unknown, ...keys: string[]): Scalar | undefined {
  for (const key of keys) {
    const v = pick(obj, key)
    if (v !== undefined && !/^\d+$/.test(String(v))) return v
  }
  return undefined
}

export interface Instance {
  raw: unknown
  id: string
  name?: Scalar
  status?: Scalar
  ipv4?: string
  ipv6?: string
  cpuName?: Scalar
  plan?: Scalar
  planId?: Scalar
  os?: Scalar
  region?: Scalar
  specs: string
  created: Date | null
  expires: Date | null
}

export function normInstance(raw: unknown, lang: Lang): Instance {
  const id = pick(raw, "id", "instance_id", "server_id")
  return {
    raw,
    id: id === undefined ? "" : String(id),
    name: pick(raw, "hostname", "name", "label"),
    status: pick(raw, "status", "state", "power_status", "power_state"),
    ipv4: ipText(firstValue(raw, "ipv4", "ip", "main_ip", "ip_address", "ipv4_address")),
    ipv6: ipText(firstValue(raw, "ipv6", "ipv6_address")),
    cpuName: pick(raw, "cpu_name"),
    plan: pick(raw, "plan.name", "product.name", "plan_name", "product_name", "plan", "product"),
    planId: pick(raw, "plan_id", "product_id", "plan.id", "product.id"),
    os: pick(raw, "os.name", "os_name", "os", "system", "image", "template"),
    region: pickName(raw, "region.name", "region", "location", "datacenter", "area"),
    specs: specText(lang, raw),
    // *_at_utc 是后端规范化后的时间（见 alice-time.js），优先使用；其余字段名是兜底。
    created: toDate(pick(raw, "creation_at_utc", "creation_at", "created_at", "create_at", "created", "create_time")),
    expires: toDate(pick(raw, "expiration_at_utc", "expiration_at", "expired_at", "expire_at", "expires_at", "expiration", "expire_time", "due_at")),
  }
}

// 实例状态接口返回 { status: 'complete', state: { state: 'running', cpu, memory: {...}, traffic: {...} }, ... }。
export function powerState(data: unknown): string | undefined {
  const s = isRec(data) ? data.state : undefined
  const v = isRec(s) ? s.state : undefined
  return typeof v === "string" && v ? v : undefined
}

// 卡片上的状态：实例有效时显示开关机状态，过期、等待中等情况显示列表里的状态。
export function cardStatus(inst: Instance, power: string | undefined): Scalar | undefined {
  return power && /^(active|running)?$/i.test(String(inst.status ?? "")) ? power : inst.status
}

const toGB = (v: unknown, unit: number, lang: Lang): string | null => {
  const n = v === null || v === undefined || v === "" ? NaN : Number(v)
  return Number.isFinite(n) ? t(lang, "unit.gb", { n: +(n / unit).toFixed(2) }) : null
}

// 状态接口的实时数据：内存单位 KB，流量单位字节（和 VSCode 插件的换算一致）。
export function stateSummary(lang: Lang, data: unknown): Record<string, string> | null {
  const s = isRec(data) && isRec(data.state) ? data.state : null
  if (!s) return null
  const rows: Record<string, string> = {}
  if (typeof s.state === "string") rows[t(lang, "state.power")] = statusInfo(lang, s.state).label
  const cpu = s.cpu === null || s.cpu === undefined || s.cpu === "" ? NaN : Number(s.cpu)
  if (Number.isFinite(cpu)) rows[t(lang, "state.cpu")] = `${+cpu.toFixed(1)}%`
  const mem = isRec(s.memory) ? s.memory : null
  if (mem) {
    const avail = toGB(mem.memavailable, 1024 * 1024, lang)
    const total = toGB(mem.memtotal, 1024 * 1024, lang)
    if (avail || total) rows[t(lang, "state.mem")] = [avail, total].filter(Boolean).join(" / ")
  }
  const tr = isRec(s.traffic) ? s.traffic : null
  if (tr) {
    const out = toGB(tr.out, 1024 ** 3, lang)
    const inn = toGB(tr.in, 1024 ** 3, lang)
    if (out || inn) rows[t(lang, "state.traffic")] = `↑ ${out || "—"} / ↓ ${inn || "—"}`
  }
  return Object.keys(rows).length ? rows : null
}

// 账户余额 credit 的单位是百万分之一美元（Alice 控制台显示为 credit ÷ 1,000,000）。
export function fmtCredit(v: unknown): string {
  const n = Number(v)
  return Number.isFinite(n) ? `$${(n / 1e6).toFixed(2)}` : String(v)
}

export interface ImageOption {
  id: string
  name: string
  group: string | null
}

export function flattenImages(data: unknown): ImageOption[] {
  const out: ImageOption[] = []
  const walk = (items: unknown, group: string | null) => {
    for (const it of asList(items)) {
      if (!isRec(it)) continue
      const nested = ["os_list", "images", "list", "children", "items", "os"].map((k) => it[k]).find(Array.isArray)
      if (nested) {
        walk(nested, (pick(it, "group_name", "group", "name", "title") as string | undefined) || group)
      } else {
        const id = pick(it, "id", "os_id", "image_id")
        if (id !== undefined) out.push({ id: String(id), name: String(pick(it, "name", "title", "os_name", "label") || `#${id}`), group })
      }
    }
  }
  // Alice 每次返回的系统分组顺序不固定，按分组编号排序。
  const groups = asList(data).slice().sort((a, b) => Number(isRec(a) && a.group_id) - Number(isRec(b) && b.group_id) || 0)
  walk(groups, null)
  return out
}

// ---------- EVO 权限与时长 ----------

// allow_packages 形如 "38|39|40"，max_time 为单次最长使用时长（小时）。
export function allowedPlanIds(perm: unknown): Set<string> | null {
  const raw = isRec(perm) ? perm.allow_packages : undefined
  if (raw === undefined || raw === null || raw === "") return null
  const ids = (Array.isArray(raw) ? raw : String(raw).split(/[|,\s]+/)).map(String).filter(Boolean)
  return ids.length ? new Set(ids) : null
}

export function maxHours(perm: unknown): number | null {
  const n = Number(isRec(perm) ? perm.max_time : undefined)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
}

export interface Plan {
  id: string
  name: string
  specs: string
  stock: Scalar | undefined
}

export interface PlanOption {
  id: string
  label: string
  disabled: boolean
}

export function planOptions(lang: Lang, plans: Plan[], perm: unknown): PlanOption[] {
  const allowed = allowedPlanIds(perm)
  let list = allowed ? plans.filter((p) => allowed.has(p.id)) : plans
  if (!list.length) list = plans // 权限格式不认识时不要把套餐全部藏掉
  return list.map((p) => {
    const soldOut = p.stock !== undefined && Number(p.stock) <= 0
    const extra = [p.specs, p.stock !== undefined ? (soldOut ? t(lang, "unit.noStock") : t(lang, "unit.stock", { n: String(p.stock) })) : null].filter(Boolean).join("，")
    return { id: p.id, label: extra ? `${p.name}（${extra}）` : p.name, disabled: soldOut }
  })
}

const DURATIONS = [1, 2, 4, 8, 12, 24, 48, 72, 168]

export function durationOptions(max: number | null): number[] {
  const list = max ? DURATIONS.filter((n) => n <= max) : DURATIONS.slice()
  if (max && max < DURATIONS[DURATIONS.length - 1] && !list.includes(max)) list.push(max)
  return list.length ? list : [1]
}

export function durationLabel(lang: Lang, n: number): string {
  if (n % 24 !== 0) return t(lang, "unit.hours", { n })
  const d = n / 24
  return d === 1 ? t(lang, "unit.hoursOneDay", { n }) : t(lang, "unit.hoursDays", { n, d })
}

// 60 的整数倍显示成小时，其他显示成分钟（自动续期弹窗的策略说明用）。
export function minutesText(lang: Lang, m: number): string {
  return m % 60 === 0 ? t(lang, "unit.hours", { n: m / 60 }) : t(lang, "unit.minutes", { n: m })
}

// Alice 实例自创建起最长存在 MAX_LIFETIME_HOURS 小时：续期只能把到期时间推到 creation + 上限以内，
// 所以单次可续 = 上限 −（当前到期 − 创建）。时间缺失时返回 null（不限制，由账户上限和 Alice 兜底）。
// 后端的 normalize.js 是这里的另一份实现，改行为时要两边同步。
export const MAX_LIFETIME_HOURS = 31

export function renewCapHours(created: Date | null | undefined, expires: Date | null | undefined): number | null {
  if (!created || !expires) return null
  const t0 = created.getTime()
  const t1 = expires.getTime()
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null
  return Math.floor(MAX_LIFETIME_HOURS - (t1 - t0) / 3600e3)
}

// 综合账户单次上限和存在时间上限，返回本次最多可续的小时数（整数；<=0 表示已达上限无法再续）。
// capped 为 true 表示存在时间上限正在起作用（调用方应提示用户）。
export function maxRenewHours(
  inst: { created?: Date | null; expires?: Date | null },
  accountMax: number | null
): { max: number | null; capped: boolean } {
  const cap = renewCapHours(inst.created, inst.expires)
  if (cap === null) return { max: accountMax, capped: false }
  if (accountMax === null || accountMax === undefined) return { max: cap, capped: true }
  return { max: Math.min(accountMax, cap), capped: cap <= accountMax }
}

// ---------- 命令输出 ----------


const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\([0-9A-Z]|\x1b[@-Z\\-_]/g

const MAX_DECODE_INPUT = 1024 * 1024
const MAX_DECODE_OUTPUT = 256 * 1024

// Alice 返回的命令输出是 Base64 编码的：能解出 UTF-8 文本就解码显示，并去掉终端颜色控制符。
export function decodeOutput(text: unknown): string {
  const raw = String(text)
  if (raw.length > MAX_DECODE_INPUT) {
    return raw.replace(ANSI_RE, "").slice(-MAX_DECODE_OUTPUT)
  }
  const s = raw.replace(/\s+/g, "")
  if (s.length >= 4 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
    try {
      const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(ANSI_RE, "")

      if (!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(decoded)) {
        return decoded.length > MAX_DECODE_OUTPUT ? decoded.slice(-MAX_DECODE_OUTPUT) : decoded
      }
    } catch {
      /* 不是 Base64 文本，按原样显示 */
    }
  }
  const plain = raw.replace(ANSI_RE, "")
  return plain.length > MAX_DECODE_OUTPUT ? plain.slice(-MAX_DECODE_OUTPUT) : plain
}

export const RUNNING_RE = /^(pend|queue|run|wait|process|executing|submit|creat|start|in[_ -]?progress)/i

// ---------- 其他 ----------

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.left = "-9999px"
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand("copy")
    ta.remove()
    return ok
  } catch {
    return false
  }
}
