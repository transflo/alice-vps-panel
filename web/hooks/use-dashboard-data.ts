"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { api, enc } from "@/lib/api"
import { asList, normInstance, pick, powerState, type Instance } from "@/lib/alice"
import { getOverview } from "@/lib/data"

const REFRESH_MS = 30000

// 网页和 Telegram bot 共用后端保存的自动续期设置；policy 是后端的规则，弹窗里的说明文字显示它。
export interface AutoRenewState {
  available: boolean
  items: Record<string, { enabled: boolean; hours: number }>
  policy?: { beforeMinutes: number; maxAttempts: number; retryMinutes: number }
}

export type WithBusy = <T>(inst: Instance, fn: () => Promise<T>) => Promise<T>

export interface Account {
  name: string
  balance?: string | number | boolean
}

// 实例列表、开关机状态、自动续期设置、账户信息的加载与定时刷新。
export function useDashboardData() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true) // 首次加载在 effect 里由定时器触发，所以一开始就是加载中
  const [error, setError] = useState("")
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [busy, setBusy] = useState<Record<string, number>>({})
  const [powerStates, setPowerStates] = useState<Record<string, string>>({})
  const [autoRenew, setAutoRenew] = useState<AutoRenewState>({ available: true, items: {} })
  const [account, setAccount] = useState<Account>({ name: "" })

  const mounted = useRef(true)
  const inFlight = useRef(false)
  const lastLoad = useRef(0)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const powerSeq = useRef(0)

  useEffect(() => {
    mounted.current = true
    const pending = timers.current
    return () => {
      mounted.current = false
      pending.forEach(clearTimeout)
      pending.clear()
    }
  }, [])

  // 实例列表只说明实例是否有效，开关机状态要逐台查询状态接口；查不到时卡片显示列表里的状态。
  const loadPower = useCallback(async (list: Instance[]) => {
    const seq = ++powerSeq.current
    const targets = list.filter((i) => i.id && !/expire/i.test(String(i.status ?? "")))
    const results = await Promise.all(
      targets.map(async (i): Promise<[string, string | undefined]> => {
        try {
          return [i.id, powerState((await api("GET", `/api/instances/${enc(i.id)}/state`)).data)]
        } catch {
          return [i.id, undefined]
        }
      })
    )
    if (mounted.current && seq === powerSeq.current) {
      setPowerStates(Object.fromEntries(results.filter((r): r is [string, string] => Boolean(r[1]))))
    }
  }, [])

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    try {
      const r = await api("GET", "/api/instances")
      if (!mounted.current) return
      const list = asList(r.data).map(normInstance)
      setInstances(list)
      void loadPower(list)
      api<AutoRenewState>("GET", "/api/auto-renew")
        .then((a) => mounted.current && a.data && setAutoRenew(a.data))
        .catch(() => {
          /* 自动续期设置读取失败不影响实例列表 */
        })
      setError("")
      setUpdatedAt(new Date())
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      inFlight.current = false
      lastLoad.current = Date.now()
      if (mounted.current) {
        setLoading(false)
        setLoaded(true)
      }
    }
  }, [loadPower])

  // 操作提交后实例状态要过一会儿才变，稍后再刷新两次。
  const refreshSoon = useCallback(() => {
    for (const ms of [2500, 10000]) {
      const t = setTimeout(() => {
        timers.current.delete(t)
        void load()
      }, ms)
      timers.current.add(t)
    }
  }, [load])

  const loadAccount = useCallback((force = false) => {
    getOverview({ force })
      .then((o) => {
        if (!mounted.current) return
        const p = o && o.profile && o.profile.ok ? o.profile.data : null
        setAccount({ name: String(pick(p, "email", "username", "fullname", "name") ?? ""), balance: pick(p, "credit", "balance") })
      })
      .catch(() => {
        /* 顶栏账户信息非必需 */
      })
  }, [])

  // 页面可见时每 30 秒自动刷新；切回页面时如果数据已经旧了也刷新一次。
  useEffect(() => {
    const first = setTimeout(() => {
      void load()
      loadAccount()
    }, 0)
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current > REFRESH_MS) void load()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearTimeout(first)
      clearInterval(t)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [load, loadAccount])

  // 同一实例可能有多个操作同时进行，用计数避免先结束的操作提前清掉忙碌状态。
  const withBusy = useCallback<WithBusy>(async (inst, fn) => {
    const id = inst.id
    setBusy((b) => ({ ...b, [id]: (b[id] || 0) + 1 }))
    try {
      return await fn()
    } finally {
      if (mounted.current) {
        setBusy((b) => {
          const next = { ...b }
          if ((next[id] || 1) > 1) next[id] -= 1
          else delete next[id]
          return next
        })
      }
    }
  }, [])

  return { instances, setInstances, loaded, loading, error, updatedAt, busy, powerStates, autoRenew, account, load, loadAccount, refreshSoon, withBusy }
}
