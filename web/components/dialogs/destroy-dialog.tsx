"use client"

import * as React from "react"

import { FormDialog, type DialogBase } from "@/components/dialogs/shell"
import { Notice } from "@/components/notice"
import { useLang } from "@/components/lang-provider"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { WithBusy } from "@/hooks/use-dashboard-data"
import { api, enc } from "@/lib/api"
import type { Instance } from "@/lib/alice"
import { notify } from "@/lib/notify"

// 删除实例：必须手动输入实例 ID 才能确认。
export function DestroyDialog({
  open,
  onClose,
  onExited,
  inst,
  withBusy,
  onDestroyed,
}: DialogBase & {
  inst: Instance
  withBusy: WithBusy
  onDestroyed: () => void
}) {
  const { t } = useLang()
  const [confirm, setConfirm] = React.useState("")
  const name = inst.name ? String(inst.name) : inst.id

  async function onSubmit() {
    if (confirm.trim() !== inst.id) throw new Error(t("destroy.mismatch"))
    await withBusy(inst, () => api("DELETE", `/api/instances/${enc(inst.id)}`))
    notify(t("destroy.done"), "success")
    onDestroyed()
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={t("destroy.title")}
      submitText={t("destroy.submit")}
      size="xs"
      danger
      onSubmit={onSubmit}
    >
      <FieldGroup>
        <Notice tone="error">{t("destroy.message", { name, id: inst.id })}</Notice>
        <Field>
          <FieldLabel htmlFor="destroy-confirm">{t("card.instanceId", { id: inst.id })}</FieldLabel>
          <Input
            id="destroy-confirm"
            value={confirm}
            placeholder={inst.id}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
      </FieldGroup>
    </FormDialog>
  )
}
