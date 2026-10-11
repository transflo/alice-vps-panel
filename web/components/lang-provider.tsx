"use client"

// 界面语言：首次访问跟随浏览器语言，之后用 localStorage 记住，切换时同步给 API 层的错误文案。
import * as React from "react"

import { setApiLang } from "@/lib/api"
import { t as translate, type DictKey } from "@/lib/i18n"
import { DEFAULT_LANG, STORAGE_KEY, isLang, normalizeLang, type Lang } from "@/lib/i18n/lang"

type Translate = (key: DictKey, params?: Record<string, string | number>) => string

interface LangContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: Translate
}

const LangContext = React.createContext<LangContextValue | null>(null)

const noopSubscribe = () => () => {}

// 读本地偏好：隐私模式下读不到就跟随浏览器语言。返回值是字符串，快照天然稳定。
function readStoredLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isLang(stored)) return stored
  } catch {
    /* 读不到就按浏览器语言来 */
  }
  return normalizeLang(navigator.language)
}

function readServerLang(): Lang {
  return DEFAULT_LANG
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  // 服务端和首屏用默认语言，客户端读本地偏好；useSyncExternalStore 保证两边水合一致。
  const stored = React.useSyncExternalStore(noopSubscribe, readStoredLang, readServerLang)
  const [override, setOverride] = React.useState<Lang | null>(null)
  const lang = override ?? stored

  React.useEffect(() => {
    setApiLang(lang)
    document.documentElement.lang = lang
  }, [lang])

  const setLang = React.useCallback((next: Lang) => {
    setOverride(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* 存不下也不影响本次会话 */
    }
  }, [])

  const value = React.useMemo<LangContextValue>(
    () => ({ lang, setLang, t: (key, params) => translate(lang, key, params) }),
    [lang, setLang]
  )

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): LangContextValue {
  const ctx = React.useContext(LangContext)
  if (!ctx) throw new Error("useLang 必须在 LangProvider 内使用")
  return ctx
}
