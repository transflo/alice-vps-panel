"use client"

import * as React from "react"

import { FormDialog, type DialogBase } from "@/components/dialogs/shell"
import { BootScriptField, SelectField } from "@/components/form-fields"
import { Notice } from "@/components/notice"
import { useLang } from "@/components/lang-provider"
import { FieldGroup } from "@/components/ui/field"
import { useImageOptions, useMaxHours, usePlanOptions, useSshKeyOptions } from "@/hooks/use-dialog-data"
import { api } from "@/lib/api"
import { durationLabel, durationOptions } from "@/lib/alice"
import { notify } from "@/lib/notify"

// 新建实例：套餐 → 系统 → 时长 → SSH 密钥 → 启动脚本。
export function DeployDialog({
  open,
  onClose,
  onExited,
  onDeployed,
}: DialogBase & {
  onDeployed: (result: unknown, hadScript: boolean) => void
}) {
  const { t, lang } = useLang()
  const { options: plans, loading: plansLoading, error: plansError } = usePlanOptions()
  const max = useMaxHours()
  const [planId, setPlanId] = React.useState("")
  const [osId, setOsId] = React.useState("")
  const [time, setTime] = React.useState("24")
  const [keyId, setKeyId] = React.useState("")
  const [script, setScript] = React.useState("")
  const [loadError, setLoadError] = React.useState("")

  // 账户只有一个可用套餐时直接选中，省一步；不改 state，纯派生。
  const selectedPlan = React.useMemo(() => {
    if (planId) return planId
    const usable = plans.filter((p) => !p.disabled)
    return usable.length === 1 ? usable[0].id : ""
  }, [planId, plans])

  const { options: images, loading: imagesLoading } = useImageOptions(selectedPlan, setLoadError)
  const { keys, note: keyNote } = useSshKeyOptions()

  const durations = durationOptions(max)
  const hours = durations.includes(Number(time)) ? time : String(durations[durations.length - 1])
  const warning = plansError || loadError

  async function onSubmit() {
    if (!selectedPlan) throw new Error(t("deploy.needPlan"))
    if (!osId) throw new Error(t("deploy.needOs"))
    const r = await api("POST", "/api/instances", {
      plan_id: selectedPlan,
      os_id: osId,
      time: Number(hours),
      ssh_key_id: keyId || null,
      boot_script: script || undefined,
    })
    notify(t("deploy.submitted"), "success")
    onDeployed(r.data, Boolean(script))
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={t("deploy.title")}
      submitText={t("deploy.submit")}
      size="md"
      onSubmit={onSubmit}
    >
      <FieldGroup>
        {warning ? <Notice tone="warning">{warning}</Notice> : null}

        <SelectField
          id="deploy-plan"
          label={t("deploy.plan")}
          value={selectedPlan}
          onChange={(next) => {
            setPlanId(next)
            setOsId("")
          }}
          options={plans}
          loading={plansLoading}
        />

        <SelectField
          id="deploy-os"
          label={t("deploy.os")}
          value={osId}
          onChange={setOsId}
          options={images.map((image) => ({
            id: image.id,
            label: image.group ? `${image.group} · ${image.name}` : image.name,
          }))}
          loading={imagesLoading}
          disabled={!selectedPlan}
          placeholder={selectedPlan ? undefined : t("deploy.selectFirst")}
        />

        <SelectField
          id="deploy-time"
          label={t("deploy.duration")}
          value={hours}
          onChange={setTime}
          options={durations.map((n) => ({ id: String(n), label: durationLabel(lang, n) }))}
          description={max !== null ? t("fields.maxSingle", { max }) : undefined}
        />

        <SelectField
          id="deploy-key"
          label={t("deploy.sshKey")}
          value={keyId}
          onChange={setKeyId}
          options={keys.map((key) => ({ id: key.id, label: key.name }))}
          placeholder={t("deploy.noKey")}
          description={keyNote || undefined}
        />

        <BootScriptField value={script} onChange={setScript} />
      </FieldGroup>
    </FormDialog>
  )
}
