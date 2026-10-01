import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { statusInfo, type Tone } from "@/lib/alice"
import { cn } from "@/lib/utils"

// 状态颜色只在这里定义：运行绿、处理中琥珀、关机和未知灰、异常红。
const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  busy: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  off: "bg-muted text-muted-foreground",
  bad: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  muted: "bg-muted text-muted-foreground",
}

export function StatusBadge({ status }: { status: unknown }) {
  const st = statusInfo(status)
  return (
    <Badge variant="secondary" className={cn("flex-none gap-1.5 font-semibold", TONE_CLASS[st.tone])}>
      {st.tone === "busy" ? <Spinner /> : <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {st.label}
    </Badge>
  )
}
