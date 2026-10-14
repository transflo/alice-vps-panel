"use client"

import * as React from "react"

import { CommandResult } from "@/components/dialogs/command-result"
import { FormDialog, type DialogBase } from "@/components/dialogs/shell"
import { useLang } from "@/components/lang-provider"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useCommandWatcher } from "@/hooks/use-command-watcher"
import type { WithBusy } from "@/hooks/use-dashboard-data"
import { api, enc } from "@/lib/api"
import { pick, type Instance } from "@/lib/alice"

// 远程执行命令：提交后轮询结果，输出自动做 Base64 解码。
export function ExecDialog({
  open,
  onClose,
  onExited,
  inst,
  withBusy,
}: DialogBase & {
  inst: Instance
  withBusy: WithBusy
}) {
  const { t } = useLang()
  const [command, setCommand] = React.useState("")
  const { state, watch, finish } = useCommandWatcher()

  async function run() {
    if (!command.trim()) return
    const r = await withBusy(inst, () => api<unknown>("POST", `/api/instances/${enc(inst.id)}/exec`, { command }))
    const uid = typeof r.data === "string" ? r.data : pick(r.data, "command_uid", "uid")
    if (uid === undefined || uid === "") finish(t("exec.noUid"))
    else watch(inst.id, String(uid))
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={t("exec.title", { name: inst.name ? String(inst.name) : inst.id })}
      submitText={t("exec.run")}
      submitDisabled={state.phase === "running"}
      size="md"
      onSubmit={run}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="exec-command">{t("exec.command")}</FieldLabel>
          <Textarea
            id="exec-command"
            rows={4}
            spellCheck={false}
            className="font-mono"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            // Ctrl / Cmd + Enter 提交，走表单提交以复用错误处理。
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <FieldDescription>{t("exec.hint")}</FieldDescription>
        </Field>
      </FieldGroup>
      <CommandResult state={state} />
    </FormDialog>
  )
}
