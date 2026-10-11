"use client"

import { Terminal } from "@/components/data-display"
import { Notice } from "@/components/notice"
import { Spinner } from "@/components/ui/spinner"
import type { CommandState } from "@/hooks/use-command-watcher"

// 命令执行状态 + 输出。执行中显示转圈，失败显示提示，有输出就显示等宽文本块。
export function CommandResult({ state }: { state: CommandState }) {
  if (state.phase === "idle") return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {state.phase === "running" ? <Spinner className="size-3" /> : null}
        <span>{state.status}</span>
      </div>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.output ? <Terminal text={state.output} /> : null}
    </div>
  )
}
