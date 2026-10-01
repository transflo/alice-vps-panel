"use client"

import * as React from "react"

import { DurationField } from "@/components/form-fields"
import { FormDialog, type DialogBase } from "@/components/dialogs/shell"
import { Notice } from "@/components/notice"
import { Field, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import type { Instance } from "@/lib/alice"
import { api, enc } from "@/lib/api"
import { notify } from "@/lib/notify"
import type { AutoRenewState, WithBusy } from "@/hooks/use-dashboard-data"
import { useClampedHours, useMaxHours } from "@/hooks/use-dialog-data"

// 后端没有返回 policy（旧后端）时的默认值，和后端的默认配置一致。
const DEFAULT_POLICY = { beforeMinutes: 60, maxAttempts: 3, retryMinutes: 10 }

// 60 的整数倍显示成小时：60 → "1 小时"，30 → "30 分钟"。
const minutesText = (m: number) => (m % 60 === 0 ? `${m / 60} 小时` : `${m} 分钟`)

export function AutoRenewDialog({
  inst,
  state,
  withBusy,
  onChanged,
  ...base
}: DialogBase & { inst: Instance; state: AutoRenewState; withBusy: WithBusy; onChanged: () => void }) {
  const switchId = React.useId()
  const max = useMaxHours()
  const current = state.items[inst.id]
  const policy = { ...DEFAULT_POLICY, ...state.policy }
  const [enabled, setEnabled] = React.useState(Boolean(current && current.enabled))
  const [time, setTime] = useClampedHours(String((current && current.hours) || 24), max)

  const submit = async () => {
    await withBusy(inst, () =>
      api("POST", `/api/instances/${enc(inst.id)}/auto-renew`, enabled ? { enabled: true, hours: Number(time) } : { enabled: false })
    )
    notify(
      enabled ? `已开启自动续期：到期前 ${minutesText(policy.beforeMinutes)}起自动续 ${time} 小时（失败最多试 ${policy.maxAttempts} 次）` : "已关闭自动续期",
      "success"
    )
    onChanged()
  }

  return (
    <FormDialog {...base} title={`自动续期 · ${inst.name || `#${inst.id}`}`} submitText="保存" size="xs" onSubmit={submit}>
      {!state.available && (
        <Notice tone="warning">服务器没有可写的数据目录（DATA_DIR），暂时无法保存自动续期设置。请按 README 挂载数据卷后重试。</Notice>
      )}
      <p className="text-sm text-muted-foreground">
        开启后，面板会在实例到期前约 {minutesText(policy.beforeMinutes)}开始自动续期，不需要保持页面打开。续期失败时每隔 {policy.retryMinutes} 分钟重试，最多尝试{" "}
        {policy.maxAttempts} 次，都失败就不再尝试（开了 Telegram bot 会收到通知）。每次续期会扣费，余额不足时续期会失败；充值后重新保存一次设置，就会再次尝试。
      </p>
      <Field orientation="horizontal">
        <Switch id={switchId} checked={enabled} disabled={!state.available} onCheckedChange={setEnabled} />
        <FieldLabel htmlFor={switchId}>启用自动续期</FieldLabel>
      </Field>
      {enabled && <DurationField label="每次续期时长" value={time} onChange={setTime} max={max} />}
    </FormDialog>
  )
}
