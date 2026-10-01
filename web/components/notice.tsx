import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, InformationCircleIcon, MultiplicationSignCircleIcon } from "@hugeicons/core-free-icons"

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

// shadcn 的 Alert 只有 default / destructive 两种变体，这里在它上面组合出 info / warning / error 三种提示。
const TONES = {
  info: { icon: InformationCircleIcon, variant: "default", className: "" },
  warning: { icon: Alert02Icon, variant: "default", className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  error: { icon: MultiplicationSignCircleIcon, variant: "destructive", className: "" },
} as const

export function Notice({
  tone = "info",
  action,
  className,
  children,
}: {
  tone?: keyof typeof TONES
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const t = TONES[tone]
  return (
    <Alert variant={t.variant} className={cn(t.className, className)}>
      <HugeiconsIcon icon={t.icon} strokeWidth={2} />
      <AlertDescription className={tone === "warning" ? "text-current" : undefined}>{children}</AlertDescription>
      {action && <AlertAction>{action}</AlertAction>}
    </Alert>
  )
}
