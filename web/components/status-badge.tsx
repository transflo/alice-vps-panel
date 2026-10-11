"use client"

import { useLang } from "@/components/lang-provider"
import { Badge } from "@/components/ui/badge"
import { statusInfo, type Tone } from "@/lib/alice"

// 实例状态：正常 / 处理中 / 已关机 / 异常 / 未知，用语义色区分。
const TONE_VARIANT = {
  ok: "success",
  busy: "warning",
  off: "secondary",
  bad: "destructive",
  muted: "outline",
} as const satisfies Record<Tone, string>

export function StatusBadge({ status }: { status: unknown }) {
  const { lang } = useLang()
  const { label, tone } = statusInfo(lang, status)
  return <Badge variant={TONE_VARIANT[tone]}>{label}</Badge>
}
