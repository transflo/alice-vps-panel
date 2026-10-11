"use client"

// 应用入口：先问一次会话状态，未登录显示登录页，已登录显示面板。
import * as React from "react"

import { Dashboard } from "@/components/dashboard"
import { useLang } from "@/components/lang-provider"
import { LoginPage } from "@/components/login-page"
import { Spinner } from "@/components/ui/spinner"
import { api, setUnauthorizedHandler } from "@/lib/api"
import { clearCache } from "@/lib/data"

interface Session {
  checked: boolean
  authenticated: boolean
  configured: boolean
  message: string
}

export function Panel() {
  const { t } = useLang()
  const [session, setSession] = React.useState<Session>({ checked: false, authenticated: false, configured: true, message: "" })
  // 事件回调里要读当前语言，用 ref 拿最新的 t（渲染期间不写 ref）。
  const translate = React.useRef(t)
  React.useEffect(() => {
    translate.current = t
  })

  React.useEffect(() => {
    // 任何接口返回 401（登录接口除外）都会走到这里：清缓存、退回登录页。
    setUnauthorizedHandler(() => {
      clearCache()
      setSession((s) => ({ ...s, authenticated: false, message: translate.current("common.sessionExpired") }))
    })

    let alive = true
    fetch("/api/session", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((s) => {
        if (!alive) return
        setSession({ checked: true, authenticated: Boolean(s.authenticated), configured: s.configured !== false, message: "" })
      })
      .catch(() => {
        if (alive) setSession({ checked: true, authenticated: false, configured: true, message: translate.current("common.unreachable") })
      })
    return () => {
      alive = false
    }
  }, [])

  const logout = React.useCallback(async () => {
    try {
      await api("POST", "/api/logout")
    } catch {
      /* 退出失败也照样回到登录页 */
    }
    clearCache()
    setSession((s) => ({ ...s, authenticated: false, message: "" }))
  }, [])

  if (!session.checked) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (!session.authenticated) {
    return (
      <LoginPage
        message={session.message}
        onLogin={() => setSession((s) => ({ ...s, authenticated: true, message: "" }))}
      />
    )
  }

  return <Dashboard configured={session.configured} onLogout={logout} />
}
