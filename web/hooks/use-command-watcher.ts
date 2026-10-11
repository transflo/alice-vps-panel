"use client"

// 远程命令的结果轮询：提交后 1.5 秒起查，之后每 2 秒一次，最多盯 5 分钟。
import * as React from "react"

import { useLang } from "@/components/lang-provider"
import { api, enc } from "@/lib/api"
import { decodeOutput, firstValue, RUNNING_RE } from "@/lib/alice"
import { errText } from "@/lib/utils"

const TIMEOUT_MS = 5 * 60 * 1000
const FIRST_DELAY_MS = 1500
const POLL_DELAY_MS = 2000

export interface CommandState {
  phase: "idle" | "running" | "done"
  status: string
  output: string
  error: string
}

export const COMMAND_IDLE: CommandState = { phase: "idle", status: "", output: "", error: "" }

export function useCommandWatcher(initial: CommandState = COMMAND_IDLE) {
  const { t } = useLang()
  const [state, setState] = React.useState<CommandState>(initial)
  const token = React.useRef(0)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const translate = React.useRef(t)
  // 轮询回调里要读最新语言，渲染期间不能写 ref，放到每次渲染后的 effect 里同步。
  React.useEffect(() => {
    translate.current = t
  })

  const stop = React.useCallback(() => {
    token.current += 1
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  // 卸载时停掉轮询。
  React.useEffect(() => stop, [stop])

  const watch = React.useCallback(
    (instId: string, uid: string, { resetState = true }: { resetState?: boolean } = {}) => {
      stop()
      const mine = token.current
      const started = Date.now()
      if (resetState) {
        setState({ phase: "running", status: translate.current("exec.submitted"), output: "", error: "" })
      }

      function poll() {
        api("GET", `/api/instances/${enc(instId)}/exec/${enc(uid)}`)
          .then((r) => {
            if (mine !== token.current) return
            const d = (typeof r.data === "object" && r.data !== null ? r.data : {}) as Record<string, unknown>
            const out = firstValue(d, "output")
            const result = firstValue(d, "result")
            let text = out !== undefined ? decodeOutput(out) : ""
            // 有些响应把文本放在 result 里。
            if (!text && typeof result === "string" && result.length > 60) text = decodeOutput(result)
            const status = String(firstValue(d, "status") ?? "")

            if (RUNNING_RE.test(status) || (!status && !text)) {
              if (Date.now() - started < TIMEOUT_MS) {
                setState({
                  phase: "running",
                  status: translate.current("exec.running", { status: status ? `（${status}）` : "" }),
                  output: text,
                  error: "",
                })
                timer.current = setTimeout(poll, POLL_DELAY_MS)
                return
              }
              setState({
                phase: "done",
                status: translate.current("exec.timeout", { status: status || "—" }),
                output: text,
                error: "",
              })
              return
            }

            const extra = result === undefined ? "" : typeof result === "object" ? JSON.stringify(result) : String(result)
            setState({
              phase: "done",
              status: translate.current("exec.done", {
                status: status || translate.current("common.done"),
                result: extra && extra.length <= 60 ? `（${extra}）` : "",
              }),
              output: text,
              error: "",
            })
          })
          .catch((e) => {
            if (mine !== token.current) return
            setState({ phase: "done", status: "", output: "", error: translate.current("exec.failed", { error: errText(e) }) })
          })
      }

      timer.current = setTimeout(poll, FIRST_DELAY_MS)
    },
    [stop]
  )

  // 提交成功但拿不到 command_uid 时，直接把结果标成结束。
  const finish = React.useCallback(
    (status: string) => {
      stop()
      setState({ phase: "done", status, output: "", error: "" })
    },
    [stop]
  )

  return { state, watch, stop, finish }
}
