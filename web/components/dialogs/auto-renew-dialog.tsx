"use client"

import * as React from "react"

import { FormDialog, type DialogBase } from "@/components/dialogs/shell"
import { Notice } from "@/components/notice"
import { useLang } from "@/components/lang-provider"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { useMaxHours } from "@/hooks/use-dialog-data"
import { effectiveAutoRenew, type AutoRenewState, type WithBusy } from "@/hooks/use-dashboard-data"
import { api, enc } from "@/lib/api"
import { MAX_LIFETIME_HOURS, maxRenewHours, minutesText, type Instance } from "@/lib/alice"
import { notify } from "@/lib/notify"

// 每次续期固定 7 小时，用户只决定开不开；策略参数由后端下发，拿不到时用这套默认值。
const FIXED_HOURS = 7
const DEFAULT_POLICY = { beforeMinutes: 60, maxAttempts: 3, retryMinutes: 10 }

export function AutoRenewDialog({
  open,
  onClose,
  onExited,
  inst,
  state,
  withBusy,
  onChanged,
}: DialogBase & {
  inst: Instance
  state: AutoRenewState
  withBusy: WithBusy
  onChanged: () => void
}) {
  const { t, lang } = useLang()
  const policy = { ...DEFAULT_POLICY, ...state.policy }
  const max = useMaxHours()
  const cap = maxRenewHours(inst, max)
  // 用户没动过开关时跟随当前生效的设置（没单独设置过的实例按策略默认值显示为开启）。
  const [draft, setDraft] = React.useState<boolean | null>(null)
  const enabled = draft ?? Boolean(effectiveAutoRenew(state, inst.id)?.enabled)

  const overCap = enabled && cap.max !== null && FIXED_HOURS > cap.max

  async function onSubmit() {
    await withBusy(inst, () =>
      api("POST", `/api/instances/${enc(inst.id)}/auto-renew`, enabled ? { enabled: true, hours: FIXED_HOURS } : { enabled: false })
    )
    notify(
      enabled
        ? t("autorenew.enabledMsg", {
            before: minutesText(lang, policy.beforeMinutes),
            hours: FIXED_HOURS,
            attempts: policy.maxAttempts,
          })
        : t("autorenew.disabledMsg"),
      "success"
    )
    onChanged()
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={t("autorenew.title", { name: inst.name ? String(inst.name) : inst.id })}
      submitText={t("autorenew.save")}
      size="md"
      onSubmit={onSubmit}
    >
      <FieldGroup>
        {!state.available ? <Notice tone="warning">{t("autorenew.noDataDir")}</Notice> : null}

        <Field orientation="horizontal">
          <FieldLabel htmlFor="autorenew-enabled">{t("autorenew.enable")}</FieldLabel>
          <Switch id="autorenew-enabled" checked={enabled} disabled={!state.available} onCheckedChange={setDraft} />
        </Field>

        {enabled ? (
          <Field>
            <FieldDescription>{t("autorenew.fixed", { hours: FIXED_HOURS })}</FieldDescription>
          </Field>
        ) : null}

        <Field>
          <FieldDescription>
            {t("autorenew.intro", {
              before: minutesText(lang, policy.beforeMinutes),
              retry: policy.retryMinutes,
              attempts: policy.maxAttempts,
              lifetime: MAX_LIFETIME_HOURS,
            })}
          </FieldDescription>
        </Field>

        {overCap ? (
          <Notice tone="warning">
            {t("autorenew.overCap", { hours: Math.max(0, cap.max ?? 0), lifetime: MAX_LIFETIME_HOURS })}
          </Notice>
        ) : null}
      </FieldGroup>
    </FormDialog>
  )
}
