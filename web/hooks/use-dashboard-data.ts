"use client"

// 实例列表与账户信息：进页面拉一次，之后每 30 秒刷新（只在本页可见时），
// 变更操作后用 refreshSoon 补两次，因为 Alice 的状态更新有延迟。
import * as React from "react"

import { useLang } from "@/components/lang-provider"
import { api, enc } from "@/lib/api"
import { asList, normInstance, pick, powerState, type Instance } from "@/lib/alice"
import { getOverview } from "@/lib/data"
import { errText } from "@/lib/utils"

const REFRESH_MS = 30000

export interface AutoRenewItem {
  enabled: boolean
  hours: number
}

export interface AutoRenewPolicy {
  beforeMinutes: number
  maxAttempts: number
  retryMinutes: number
  defaultEnabled?: boolean
  defaultHours?: number
}

export interface AutoRenewState {
  available: boolean
  items: Record<string, AutoRenewItem>
  policy?: AutoRenewPolicy
}

export interface Account {
  name: string
  balance?: unknown
}

const EMPTY_AUTO_RENEW: AutoRenewState = { available: false, items: {} }

// 把一次变更操作标记成「该实例忙」，弹窗里直接用。
export type WithBusy = <T>(inst: Instance, fn: () => Promise<T>) => Promise<T>

// 没单独设置过的实例按策略的默认值处理（默认开启、每次 7 小时）。
export function effectiveAutoRenew(state: AutoRenewState, id: string): AutoRenewItem | undefined {
  if (state.items[id]) return state.items[id]
  if (state.policy && state.policy.defaultEnabled === false) return undefined
  return { enabled: true, hours: state.policy?.defaultHours ?? 7 }
}

export function useDashboardData() {
  const { lang } = useLang()
  const [instances, setInstances] = React.useState<Instance[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [updatedAt, setUpdatedAt] = React.useState<Date | null>(null)
  const [busy, setBusy] = React.useState<Record<string, number>>({})
  const [powerStates, setPowerStates] = React.useState<Record<string, string>>({})
  const [autoRenew, setAutoRenew] = React.useState<AutoRenewState>(EMPTY_AUTO_RENEW)
  const [account, setAccount] = React.useState<Account>({ name: "" })

  const mounted = React.useRef(false)
  const inFlight = React.useRef(false)
  const lastLoad = React.useRef(0)
  const timers = React.useRef(new Set<ReturnType<typeof setTimeout>>())
  const powerSeq = React.useRef(0)

  React.useEffect(() => {
    mounted.current = true
    const pending = timers.current
    return () => {
      mounted.current = false
      for (const id of pending) clearTimeout(id)
      pending.clear()
    }
  }, [])

  // 每台实例的实时开关机状态。过期和没有 id 的跳过；只认最新一轮的结果，避免旧响应覆盖新数据。
  const loadPower = React.useCallback(async (list: Instance[]) => {
    const seq = ++powerSeq.current
    const targets = list.filter((i) => i.id && !/expire/i.test(String(i.status ?? "")))
    const results = await Promise.all(
      targets.map(async (i): Promise<[string, string | undefined]> => {
        try {
          const r = await api("GET", `/api/instances/${enc(i.id)}/state`)
          return [i.id, powerState(r.data)]
        } catch {
          return [i.id, undefined]
        }
      })
    )
    if (!mounted.current || seq !== powerSeq.current) return
    setPowerStates(Object.fromEntries(results.filter(([, v]) => Boolean(v)) as [string, string][]))
  }, [])

  const load = React.useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    try {
      const r = await api("GET", "/api/instances")
      if (!mounted.current) return
      const list = asList(r.data).map((raw) => normInstance(raw, lang))
      setInstances(list)
      void loadPower(list)
      // 自动续期读不到不影响列表本身。
      void api("GET", "/api/auto-renew")
        .then((a) => {
          if (mounted.current && a.data) setAutoRenew(a.data as AutoRenewState)
        })
        .catch(() => {})
      setError("")
      setUpdatedAt(new Date())
    } catch (e) {
      if (mounted.current) setError(errText(e))
    } finally {
      inFlight.current = false
      lastLoad.current = Date.now()
      if (mounted.current) {
        setLoading(false)
        setLoaded(true)
      }
    }
  }, [lang, loadPower])

  const refreshSoon = React.useCallback(() => {
    for (const delay of [2500, 10000]) {
      const id = setTimeout(() => {
        timers.current.delete(id)
        void load()
      }, delay)
      timers.current.add(id)
    }
  }, [load])

  const loadAccount = React.useCallback(async (force = false) => {
    try {
      const o = await getOverview({ force })
      if (!mounted.current || !o.profile || !o.profile.ok) return
      const p = o.profile.data
      setAccount({ name: String(pick(p, "email", "username", "fullname", "name") ?? ""), balance: pick(p, "credit", "balance") })
    } catch {
      /* 账户信息拿不到不影响主界面 */
    }
  }, [])

  React.useEffect(() => {
    const first = setTimeout(() => {
      void load()
      void loadAccount()
    }, 0)
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, REFRESH_MS)
    // 从后台切回来时，如果距上次加载超过一个周期就立刻刷一次。
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current > REFRESH_MS) void load()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearTimeout(first)
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [load, loadAccount])

  // 同一实例上的操作可以重叠，用计数保证都结束才解除卡片禁用。
  const withBusy = React.useCallback(async <T,>(inst: Instance, fn: () => Promise<T>): Promise<T> => {
    setBusy((b) => ({ ...b, [inst.id]: (b[inst.id] ?? 0) + 1 }))
    try {
      return await fn()
    } finally {
      setBusy((b) => {
        const next = { ...b }
        const left = (next[inst.id] ?? 1) - 1
        if (left <= 0) delete next[inst.id]
        else next[inst.id] = left
        return next
      })
    }
  }, [])

  return {
    instances,
    setInstances,
    loaded,
    loading,
    error,
    updatedAt,
    busy,
    powerStates,
    autoRenew,
    account,
    load,
    loadAccount,
    refreshSoon,
    withBusy,
  }
}
