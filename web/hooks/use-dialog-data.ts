"use client"

// 弹窗里用到的下拉数据：套餐（按 EVO 权限过滤）、系统镜像、SSH 密钥、账户时长上限。
import * as React from "react"

import { useLang } from "@/components/lang-provider"
import { maxHours, planOptions, type ImageOption, type PlanOption } from "@/lib/alice"
import { getImages, getPermissions, getPlans, getSshKeys, type SshKey } from "@/lib/data"
import { errText } from "@/lib/utils"

export function usePlanOptions(enabled = true) {
  const { lang, t } = useLang()
  const [options, setOptions] = React.useState<PlanOption[]>([])
  const [error, setError] = React.useState("")
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    if (!enabled) return
    let alive = true
    void (async () => {
      try {
        const [plans, perm] = await Promise.all([getPlans(lang), getPermissions()])
        if (alive) setOptions(planOptions(lang, plans, perm))
      } catch (e) {
        if (!alive) return
        setOptions([])
        setError(t("deploy.loadFailed", { error: errText(e) }))
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [enabled, lang, t])

  return { options, loading: enabled && !loaded, error }
}

// 账户单次最长时长（EVO 权限的 max_time），拿不到就是 null（不设上限提示）。
export function useMaxHours(): number | null {
  const [max, setMax] = React.useState<number | null>(null)

  React.useEffect(() => {
    let alive = true
    getPermissions()
      .then((perm) => {
        if (alive) setMax(maxHours(perm))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  return max
}

// 某个套餐可用的系统镜像。按 planId 记录结果，切换套餐时不会先闪一下旧列表。
// onError 传进来的都是 setState，引用稳定，直接进依赖即可。
export function useImageOptions(planId: string, onError: (message: string) => void) {
  const { t } = useLang()
  const [result, setResult] = React.useState<{ planId: string; options: ImageOption[] }>({ planId: "", options: [] })

  React.useEffect(() => {
    if (!planId) return
    let alive = true
    getImages(planId)
      .then((options) => {
        if (alive) setResult({ planId, options })
      })
      .catch((e) => {
        if (!alive) return
        setResult({ planId, options: [] })
        // 字典里没有专门的镜像加载失败文案，用通用的「获取失败：{error}」。
        onError(t("details.failed", { error: errText(e) }))
      })
    return () => {
      alive = false
    }
  }, [planId, t, onError])

  const ready = result.planId === planId
  return { options: ready ? result.options : [], loading: planId !== "" && !ready }
}

// SSH 密钥读不到时只提示，不报错：账户里没有密钥时 Alice 也会返回失败。
export function useSshKeyOptions(): { keys: SshKey[]; note: string } {
  const { lang, t } = useLang()
  const [state, setState] = React.useState<{ keys: SshKey[]; note: string }>({ keys: [], note: "" })

  React.useEffect(() => {
    let alive = true
    getSshKeys(lang)
      .then((keys) => {
        if (alive) setState({ keys, note: keys.length ? "" : t("deploy.emptyKeyNote") })
      })
      .catch(() => {
        if (alive) setState({ keys: [], note: t("deploy.noKeyNote") })
      })
    return () => {
      alive = false
    }
  }, [lang, t])

  return state
}
