"use client"

import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"

export type NoticeTone = "info" | "success" | "warning" | "error"

const TONES = {
  info: { variant: "default", Icon: InfoIcon },
  success: { variant: "success", Icon: CircleCheckIcon },
  warning: { variant: "warning", Icon: TriangleAlertIcon },
  error: { variant: "destructive", Icon: CircleAlertIcon },
} as const

// 页面内的提示条（成功 / 提示 / 警告 / 错误），比 toast 更适合放在表单里当校验反馈。
export function Notice({
  tone = "info",
  title,
  action,
  children,
}: {
  tone?: NoticeTone
  title?: React.ReactNode
  action?: React.ReactNode
  children?: React.ReactNode
}) {
  const { variant, Icon } = TONES[tone]
  return (
    <Alert variant={variant}>
      <Icon />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {children ? <AlertDescription>{children}</AlertDescription> : null}
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  )
}
