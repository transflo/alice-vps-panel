"use client"

import * as React from "react"

import { Terminal } from "@/components/data-display"
import { SimpleDialog, type DialogBase } from "@/components/dialogs/shell"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { decodeOutput, firstValue, pick, RUNNING_RE, type Instance } from "@/lib/alice"
import { api, enc } from "@/lib/api"

interface CommandState {
  phase: "idle" | "running" | "done"
  status: string
  output: string
  error: string
}

const IDLE: CommandState = { phase: "idle", status: "", output: "", error: "" }
const SUBMITTED: CommandState = { phase: "running", status: "已提交，等待结果…", output: "", error: "" }
const TIMEOUT_MS = 5 * 60 * 1000

// 轮询命令执行结果（最长 5 分钟）。initial 让"打开就在等结果"的弹窗不必在 effect 里先改状态。
function useCommandWatcher(initial: CommandState = IDLE) {
  const [state, setState] = React.useState<CommandState>(initial)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const token = React.useRef(0)

  const stop = React.useCallback(() => {
    token.current += 1
    if (timer.current) clearTimeout(timer.current)
  }, [])

  React.useEffect(() => stop, [stop])

  const watch = React.useCallback(
    (instId: string, uid: string, { resetState = true } = {}) => {
      stop()
      const mine = token.current
      const started = Date.now()
      if (resetState) setState(SUBMITTED)

      const poll = async () => {
        try {
          const r = await api("GET", `/api/instances/${enc(instId)}/exec/${enc(uid)}`)
          if (mine !== token.current) return
          const d = r.data && typeof r.data === "object" ? r.data : {}
          const out = firstValue(d, "output")
          const result = firstValue(d, "result")
          let text = out !== undefined ? decodeOutput(out) : ""
          if (!text && typeof result === "string" && result.length > 60) text = decodeOutput(result)
          const st = String(firstValue(d, "status") ?? "")
          const running = RUNNING_RE.test(st) || (!st && !text)

          if (running && Date.now() - started < TIMEOUT_MS) {
            setState({ phase: "running", status: `执行中${st ? `（${st}）` : ""}…`, output: text, error: "" })
            timer.current = setTimeout(poll, 2000)
            return
          }
          let status: string
          if (running) {
            status = `5 分钟内仍未完成（${st || "无状态"}），可以稍后重新查询。`
          } else {
            const resText = result === undefined ? "" : typeof result === "object" ? JSON.stringify(result) : String(result)
            status = `执行结束：${st || "完成"}${resText && resText.length <= 60 ? `，结果：${resText}` : ""}`
          }
          setState({ phase: "done", status, output: text, error: "" })
        } catch (e) {
          if (mine !== token.current) return
          setState({ phase: "done", status: "", output: "", error: `查询结果失败：${e instanceof Error ? e.message : String(e)}` })
        }
      }
      timer.current = setTimeout(poll, 1500)
    },
    [stop]
  )

  return { ...state, watch, stop, setState }
}

function CommandResult({ watcher }: { watcher: CommandState }) {
  return (
    <>
      {watcher.status && <p className="text-sm text-muted-foreground">{watcher.status}</p>}
      {watcher.error && <Notice tone="error">{watcher.error}</Notice>}
      {watcher.output && <Terminal>{watcher.output}</Terminal>}
    </>
  )
}

export function ExecDialog({ inst, ...base }: DialogBase & { inst: Instance }) {
  const id = React.useId()
  const [command, setCommand] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const watcher = useCommandWatcher()
  const busy = submitting || watcher.phase === "running"

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!command.trim() || busy) return
    setSubmitting(true)
    watcher.setState({ phase: "running", status: "正在提交…", output: "", error: "" })
    try {
      const r = await api("POST", `/api/instances/${enc(inst.id)}/exec`, { command })
      const uid = typeof r.data === "string" ? r.data : pick(r.data, "command_uid", "uid")
      if (uid) watcher.watch(inst.id, String(uid))
      else watcher.setState({ phase: "done", status: "已提交，但 Alice 没有返回 command_uid，无法查询结果。", output: "", error: "" })
    } catch (ex) {
      watcher.setState({ phase: "done", status: "", output: "", error: ex instanceof Error ? ex.message : String(ex) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SimpleDialog {...base} title={`执行命令 · ${inst.name || `#${inst.id}`}`} size="md">
      <form onSubmit={run} className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor={id}>命令</FieldLabel>
          <Textarea
            id={id}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            rows={3}
            placeholder="uptime && df -h"
            spellCheck={false}
            className="min-h-20 font-mono text-[13px] leading-relaxed"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void run()
            }}
          />
          <FieldDescription>以 root 身份在实例上异步执行，面板会自动做 Base64 编码。按 Ctrl + Enter 执行。</FieldDescription>
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !command.trim()}>
            {busy && <Spinner data-icon="inline-start" />}
            执行
          </Button>
        </div>
      </form>
      <CommandResult watcher={watcher} />
    </SimpleDialog>
  )
}

// 查看某个命令（比如启动脚本）的执行输出。
export function CommandOutputDialog({
  instId,
  uid,
  title = "命令输出",
  ...base
}: DialogBase & { instId: string; uid: string; title?: string }) {
  const watcher = useCommandWatcher(SUBMITTED)
  const { watch } = watcher

  React.useEffect(() => {
    watch(instId, uid, { resetState: false })
  }, [watch, instId, uid])

  return (
    <SimpleDialog
      {...base}
      title={title}
      size="md"
      actions={
        <Button variant="outline" onClick={() => watch(instId, uid)} disabled={watcher.phase === "running"}>
          重新查询
        </Button>
      }
    >
      <p className="text-xs text-muted-foreground">
        实例 #{instId} · 命令 {uid}
      </p>
      <CommandResult watcher={watcher} />
    </SimpleDialog>
  )
}
