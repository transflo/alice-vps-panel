"use client"

import * as React from "react"

import { FormDialog, type DialogBase } from "@/components/dialogs/shell"
import { Notice } from "@/components/notice"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { Instance } from "@/lib/alice"
import { api, enc } from "@/lib/api"
import { notify } from "@/lib/notify"
import type { WithBusy } from "@/hooks/use-dashboard-data"

// 删除要求输入实例 ID 确认，防止误点。
export function DestroyDialog({
  inst,
  withBusy,
  onDestroyed,
  ...base
}: DialogBase & { inst: Instance; withBusy: WithBusy; onDestroyed: () => void }) {
  const id = React.useId()
  const [confirm, setConfirm] = React.useState("")

  const submit = async () => {
    if (confirm.trim() !== inst.id) throw new Error("输入的实例 ID 不匹配")
    await withBusy(inst, () => api("DELETE", `/api/instances/${enc(inst.id)}`))
    notify("实例已删除", "success")
    onDestroyed()
  }

  return (
    <FormDialog
      {...base}
      title="删除实例"
      submitText="永久删除"
      danger
      size="xs"
      onSubmit={submit}
      notice={<Notice tone="error">将永久销毁「{inst.name || inst.id}」及其全部数据，无法恢复。</Notice>}
    >
      <Field>
        <FieldLabel htmlFor={id}>输入实例 ID「{inst.id}」确认</FieldLabel>
        <Input id={id} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" placeholder={inst.id} />
      </Field>
    </FormDialog>
  )
}
