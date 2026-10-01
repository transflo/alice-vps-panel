"use client"

import { useEffect, useState } from "react"

import type { Option } from "@/components/form-fields"
import { durationOptions, maxHours } from "@/lib/alice"
import { getImages, getPermissions, getSshKeys } from "@/lib/data"

// 账户里没有 SSH 密钥时 Alice 返回 400 Failed 而不是空列表，所以读取失败只作为提示，不当成错误。
export function useSshKeyOptions(): { keys: Option[] | null; note?: string } {
  const [state, setState] = useState<{ keys: Option[] | null; note?: string }>({ keys: null })
  useEffect(() => {
    let alive = true
    getSshKeys()
      .then((k) => alive && setState({ keys: k.map((x) => ({ id: x.id, label: x.name })), note: k.length ? undefined : "账户里还没有 SSH 密钥" }))
      .catch(() => alive && setState({ keys: [], note: "未读取到 SSH 密钥，可能还没有添加" }))
    return () => {
      alive = false
    }
  }, [])
  return state
}

// 按套餐加载可用的系统镜像。结果记着它属于哪个套餐，套餐换了就当作"加载中"，不需要在 effect 里重置状态。
export function useImageOptions(planId: string, setError: (message: string) => void): { loading: boolean; options: Option[] } {
  const [result, setResult] = useState<{ planId: string; options: Option[] } | null>(null)
  useEffect(() => {
    if (!planId) return undefined
    let alive = true
    getImages(planId)
      .then((list) => alive && setResult({ planId, options: list.map((o) => ({ id: o.id, label: o.name, group: o.group })) }))
      .catch((e: unknown) => {
        if (!alive) return
        setResult({ planId, options: [] })
        setError(`系统列表加载失败：${e instanceof Error ? e.message : String(e)}`)
      })
    return () => {
      alive = false
    }
  }, [planId, setError])
  const ready = planId !== "" && result !== null && result.planId === planId
  return { loading: planId !== "" && !ready, options: ready ? result.options : [] }
}

export function useMaxHours(): number | null {
  const [max, setMax] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    getPermissions().then((p) => alive && setMax(maxHours(p)))
    return () => {
      alive = false
    }
  }, [])
  return max
}

// 时长超过账户上限时按允许的最大值显示（派生值，不在 effect 里改状态）。
export function useClampedHours(initial: string, max: number | null) {
  const [time, setTime] = useState(initial)
  const allowed = durationOptions(max)
  const value = allowed.includes(Number(time)) ? time : String(allowed[allowed.length - 1])
  return [value, setTime] as const
}
