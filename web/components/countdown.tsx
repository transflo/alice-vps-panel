"use client"

import * as React from "react"
import { cn } from "cn"

import { useLang } from "@/components/lang-provider"
import { fmtRemaining } from "@/lib/alice"

// 每秒刷新一次的剩余时间。只剩不到一小时变警告色，到期变错误色。
export function Countdown({ to, className }: { to: Date | null | undefined; className?: string }) {
  const { lang } = useLang()
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!to) return null
  const left = to.getTime() - now
  return (
    <span
      className={cn(
        "tabular-nums",
        left <= 0 ? "text-destructive" : left < 3_600_000 ? "text-warning" : "text-muted-foreground",
        className
      )}
    >
      {fmtRemaining(lang, left)}
    </span>
  )
}
