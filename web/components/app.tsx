"use client"

import * as React from "react"

import { Dashboard } from "@/components/dashboard"
import { LoginPage } from "@/components/login-page"
import { Spinner } from "@/components/ui/spinner"
import { setUnauthorizedHandler } from "@/lib/api"
import { clearCache } from "@/lib/data"

interface Session {
  checked: boolean
  authenticated: boolean
  configured: boolean
  message: string
}

// 整个面板是一个客户端页面：先问后端有没有登录，再决定显示登录页还是实例面板。
export function App() {
  const [session, setSession] = React.useState<Session>({ checked: false, authenticated: false, configured: true, message: "" })

  React.useEffect(() => {
    setUnauthorizedHandler(() => {
      clearCache()
      setSession((s) => ({ ...s, authenticated: false, message: "登录已失效，请重新登录" }))
    })
    fetch("/api/session", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((s: { authenticated?: boolean; configured?: boolean }) =>
        setSession({ checked: true, authenticated: Boolean(s.authenticated), configured: s.configured !== false, message: "" })
      )
      .catch(() => setSession({ checked: true, authenticated: false, configured: true, message: "无法连接面板服务" }))
  }, [])

  if (!session.checked) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (!session.authenticated) {
    return <LoginPage message={session.message} onLogin={() => setSession((s) => ({ ...s, authenticated: true, message: "" }))} />
  }

  return (
    <Dashboard
      configured={session.configured}
      onLogout={() => {
        clearCache()
        setSession((s) => ({ ...s, authenticated: false, message: "" }))
      }}
    />
  )
}
